import type { FantasyPlayerEnriched, ScoringFormat } from '@/lib/fantasy-types'
import { getPositionMultipliers, formatPoints } from './steal-engine'
import { resolveInjuryTier, type InjuryTier } from './injury-gate'
import { SCORING_FORMATS } from '@/lib/providers/fantasy-constants'

/**
 * Auction valuation.
 *
 * A dollar value only means something relative to a specific league: the same player is
 * worth roughly twice as much in a $400 league as a $200 one, and less in a 10-team
 * league than a 14-team one because replacement level is shallower. So every number here
 * is derived from the settings the user supplies rather than published as an absolute.
 *
 * The method is value over replacement (VORP), which is the standard approach:
 *   1. Replacement level per position = the projection of the last starter the league
 *      will actually draft at that position.
 *   2. A player's VORP is their projection above that line. Points below it are worth
 *      nothing, because a free waiver-wire player supplies them.
 *   3. Every drafted player costs at least $1, so only the money above that floor is
 *      actually being bid with. That surplus is divided across total league VORP to get
 *      a dollars-per-point rate.
 *   4. value = $1 + VORP x rate.
 *
 * This is a model, not a quote. The assumptions it rests on are returned alongside the
 * numbers in `AuctionBoard.assumptions` so the UI can state them rather than implying
 * the figures are market fact.
 */

export interface AuctionSettings {
  /** Per-team budget, in whole dollars. */
  budget: number
  teams: number
  /** Roster spots per team, including bench. Drives how many players hold value. */
  rosterSize: number
  /** Scoring format; reception bonuses are added to ESPN's Standard projection. */
  scoringFormat: ScoringFormat
}

export interface StarterSlots {
  QB: number
  RB: number
  WR: number
  TE: number
  K: number
  'D/ST': number
  /** Flex spots that RB/WR/TE compete for. */
  FLEX: number
}

export const DEFAULT_AUCTION_SETTINGS: AuctionSettings = {
  budget: 200,
  teams: 12,
  rosterSize: 16,
  scoringFormat: 'ppr',
}

export const DEFAULT_STARTERS: StarterSlots = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  K: 1,
  'D/ST': 1,
  FLEX: 1,
}

/**
 * How a flex spot splits across the positions eligible for it. Derived from which
 * positions actually get flexed rather than an even split: RB and WR take nearly all
 * flex snaps in practice, TE rarely.
 */
const FLEX_SHARE: Record<string, number> = { RB: 0.4, WR: 0.5, TE: 0.1 }

/** Per-position projection reliability, shared with the steals board. */
const POSITION_WEIGHT = getPositionMultipliers()

export const AUCTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const

export interface AuctionRow {
  playerId: number
  name: string
  pos: string
  team: string
  projectedPoints: number
  /** Projection above the last startable player at the position. */
  vorp: number
  /** What this league's money says the player is worth. */
  value: number
  /** ESPN's average winning bid, rescaled to this league's total money. */
  market: number | null
  /** value - market. Positive means the model thinks they go cheap. */
  surplus: number | null
  /** Rank by surplus within position. */
  posRank: number
  injuryTier: InjuryTier
  injuryDetail?: string
  suspended?: boolean
}

export interface AuctionAssumptions {
  budget: number
  teams: number
  rosterSize: number
  totalMoney: number
  /** Money above the $1-per-slot floor, which is what is actually bid with. */
  discretionary: number
  dollarsPerPoint: number
  replacementLevels: Record<string, number>
  /** Set when ESPN market prices could not be rescaled, so `market` is null throughout. */
  marketUnavailable: boolean
}

export interface AuctionBoard {
  rows: AuctionRow[]
  /** Severe/long-term injuries, priced but held out of the bargain ranking. */
  injuryWatch: AuctionRow[]
  assumptions: AuctionAssumptions
}

/** Query-string values arrive as strings, so every field is parsed defensively. */
export type AuctionSettingsInput = {
  [K in keyof AuctionSettings]?: number | string | undefined
}

export function clampSettings(s: AuctionSettingsInput): AuctionSettings {
  const d = DEFAULT_AUCTION_SETTINGS
  const fmt = typeof s.scoringFormat === 'string' ? s.scoringFormat : d.scoringFormat
  return {
    budget: clampInt(s.budget, 10, 1000, d.budget),
    teams: clampInt(s.teams, 2, 20, d.teams),
    rosterSize: clampInt(s.rosterSize, 1, 40, d.rosterSize),
    scoringFormat: (SCORING_FORMATS as readonly string[]).includes(fmt) ? (fmt as ScoringFormat) : d.scoringFormat,
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function posOf(p: FantasyPlayerEnriched): string {
  return p.normalizedPosition ?? ''
}

function projOf(p: FantasyPlayerEnriched, fmt: ScoringFormat): number {
  return formatPoints(p, fmt)
}

/**
 * The projection of the last player at each position who is worth a roster spot.
 * Anything at or below this is replaceable for free, so it earns no auction dollars.
 */
export function computeReplacementLevels(
  players: FantasyPlayerEnriched[],
  settings: AuctionSettings,
  starters: StarterSlots = DEFAULT_STARTERS,
): Record<string, number> {
  const levels: Record<string, number> = {}

  for (const pos of AUCTION_POSITIONS) {
    const pool = players
      .filter((p) => posOf(p) === pos && projOf(p, settings.scoringFormat) > 0)
      .map((p) => projOf(p, settings.scoringFormat))
      .sort((a, b) => b - a)

    if (pool.length === 0) {
      levels[pos] = 0
      continue
    }

    const flex = (FLEX_SHARE[pos] ?? 0) * starters.FLEX
    const startersAtPos = (starters[pos as keyof StarterSlots] as number) + flex
    const depth = Math.max(1, Math.round(startersAtPos * settings.teams))

    // Shallower pool than the league would draft: the last real player is replacement.
    levels[pos] = pool[Math.min(depth, pool.length) - 1]
  }

  return levels
}

/**
 * Rescales ESPN's published auction averages onto this league's money supply. ESPN does
 * not state the budget or team count behind its averages, so rather than assuming one,
 * the whole published set is treated as a distribution and scaled by total money. That
 * keeps the comparison proportional without inventing a baseline.
 */
function marketScale(players: FantasyPlayerEnriched[], totalMoney: number): number | null {
  const publishedTotal = players.reduce(
    (sum, p) => sum + Math.max(0, p.player.ownership?.auctionValueAverage ?? 0),
    0,
  )
  if (publishedTotal <= 0) return null
  return totalMoney / publishedTotal
}

export function buildAuctionBoard(
  players: FantasyPlayerEnriched[],
  settings: AuctionSettings,
  starters: StarterSlots = DEFAULT_STARTERS,
): AuctionBoard {
  const replacementLevels = computeReplacementLevels(players, settings, starters)

  const eligible = players.filter(
    (p) =>
      AUCTION_POSITIONS.includes(posOf(p) as (typeof AUCTION_POSITIONS)[number]) &&
      projOf(p, settings.scoringFormat) > 0,
  )

  const withVorp = eligible
    .map((p) => {
      const raw = projOf(p, settings.scoringFormat) - (replacementLevels[posOf(p)] ?? 0)
      // Kickers and defenses swing as widely as skill players in raw points, but that
      // spread is far less predictable, so pricing it at face value would bid a defense
      // up to WR money. The board already carries a per-position reliability weight;
      // reusing it keeps one stance instead of inventing a second here.
      const weight = POSITION_WEIGHT[posOf(p)] ?? 1
      return { p, vorp: raw * weight }
    })
    .filter((e) => e.vorp > 0)
    .sort((a, b) => b.vorp - a.vorp)

  const totalMoney = settings.budget * settings.teams
  const slots = settings.teams * settings.rosterSize
  // Only players who will actually be drafted absorb the money.
  const drafted = withVorp.slice(0, slots)
  const totalVorp = drafted.reduce((s, e) => s + e.vorp, 0)
  const discretionary = Math.max(0, totalMoney - slots)
  const dollarsPerPoint = totalVorp > 0 ? discretionary / totalVorp : 0

  const scale = marketScale(players, totalMoney)

  const rows: AuctionRow[] = drafted.map(({ p, vorp }) => {
    const value = Math.max(1, Math.round((1 + vorp * dollarsPerPoint) * 10) / 10)
    const published = p.player.ownership?.auctionValueAverage ?? 0
    const market = scale != null && published > 0 ? Math.round(published * scale * 10) / 10 : null
    const injury = resolveInjuryTier({
      espnStatus: p.player.injuryStatus,
      espnInjured: p.player.injured,
      sleeperStatus: (p.sleeper as Record<string, unknown> | undefined)?.injury_status as string | undefined,
      rosterStatus: (p.sleeper as Record<string, unknown> | undefined)?.status as string | undefined,
      bodyPart: (p.sleeper as Record<string, unknown> | undefined)?.injury_body_part as string | undefined,
      notes: (p.sleeper as Record<string, unknown> | undefined)?.injury_notes as string | undefined,
    })
    return {
      playerId: p.id,
      name: p.player.fullName,
      pos: posOf(p),
      team: p.proTeamAbbr || 'FA',
      projectedPoints: Math.round(projOf(p, settings.scoringFormat)),
      vorp: Math.round(vorp * 10) / 10,
      value,
      market,
      surplus: market != null ? Math.round((value - market) * 10) / 10 : null,
      posRank: 0,
      injuryTier: injury.tier,
      injuryDetail: injury.detail,
      suspended: injury.suspended,
    }
  })

  // A severe injury is exactly why the market price collapsed, so leaving these in
  // would rank the worst available buys as the best bargains. A suspension does the same
  // to a perfectly healthy player. They keep their numbers but move to a separate list
  // instead of being silently dropped.
  const unavailable = (r: AuctionRow) =>
    r.suspended || r.injuryTier === 'severe' || r.injuryTier === 'out'
  const healthy = rows.filter((r) => !unavailable(r))
  const injuryWatch = rows.filter(unavailable)

  // Rank within position by surplus, so a $3 bargain kicker is not compared to a $40 RB.
  const byPos = new Map<string, AuctionRow[]>()
  for (const r of healthy) {
    const list = byPos.get(r.pos) ?? []
    list.push(r)
    byPos.set(r.pos, list)
  }
  for (const list of byPos.values()) {
    list
      .sort((a, b) => (b.surplus ?? -Infinity) - (a.surplus ?? -Infinity))
      .forEach((r, i) => {
        r.posRank = i + 1
      })
  }

  return {
    rows: healthy,
    injuryWatch,
    assumptions: {
      budget: settings.budget,
      teams: settings.teams,
      rosterSize: settings.rosterSize,
      totalMoney,
      discretionary,
      dollarsPerPoint: Math.round(dollarsPerPoint * 1000) / 1000,
      replacementLevels,
      marketUnavailable: scale == null,
    },
  }
}
