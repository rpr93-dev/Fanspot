import { fitPositionCurve, formatPointsFromStats, getPositionMultipliers } from '@/lib/fantasy/steal-engine'
import { withBackoff } from '@/lib/backoff'
import type { StarterSlots, AuctionSettings, AuctionAssumptions } from '@/lib/fantasy/auction-engine'
import type { FantasyPlayerEnriched, ScoringFormat } from '@/lib/fantasy-types'

/**
 * FantasyPros pricing.
 *
 * FantasyPros only publishes two things publicly and in full: expert consensus
 * rankings (ECR) and ADP, embedded as a JSON blob in the cheatsheet page. Auction
 * values and full projections sit behind the Draft Wizard login, so we can't use
 * them. Instead we turn the consensus RANKS into dollars with the same value-over-
 * replacement math the rest of the bot uses:
 *
 *   1. Build a rank -> points curve per position from REAL prior-season scoring
 *      (the one number FantasyPros does not publish better than anyone else).
 *   2. Replacement level at a position = curve points at the last rank this league
 *      will actually start there.
 *   3. A player's VORP = (curve points at their FantasyPros ECR rank - replacement)
 *      x per-position reliability weight.
 *   4. value = $1 + VORP x (league money above the $1-per-slot floor / total VORP).
 *
 * The result is a complete, self-consistent dollar value for all 503 consensus-
 * ranked players, driven by what 100+ experts think rather than one platform's
 * projections.
 */

const FP_CHEATSHEET_URL = 'https://www.fantasypros.com/nfl/rankings/consensus-cheatsheets.php'
const FP_TTL_MS = 6 * 60 * 60 * 1000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const AUCTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const

export interface FpPlayer {
  playerId: number
  name: string
  team: string
  pos: (typeof AUCTION_POSITIONS)[number]
  /** Rank within position from FantasyPros (RB1 -> 1, DST3 -> 3). */
  posEcr: number
  /** Overall expert consensus rank. */
  ecr: number
  tier: number | null
  owned: number
  bye: string
}

let cache: { data: FpPlayer[]; expiresAt: number } | null = null

/** Extracts and normalizes the `ecrData` JSON blob from the cheatsheet HTML. */
export function parseFantasyProsHtml(html: string): FpPlayer[] {
  const m = html.match(/var ecrData = (\{[\s\S]*?\});/)
  if (!m) return []
  let data: {
    players?: Array<Record<string, unknown>>
  }
  try {
    data = JSON.parse(m[1] ?? '') as { players?: Array<Record<string, unknown>> }
  } catch {
    return []
  }
  if (!Array.isArray(data.players)) return []

  // FantasyPros reports defenses as "DST"; the bot's positions use "D/ST".
  const auctionSet = new Set<string>([...AUCTION_POSITIONS, 'DST'])
  const out: FpPlayer[] = []
  for (const p of data.players) {
    const posRaw = String(p.player_position_id ?? '').toUpperCase()
    if (!auctionSet.has(posRaw)) continue
    const pos = (posRaw === 'DST' ? 'D/ST' : posRaw) as FpPlayer['pos']

    const posRank = String(p.pos_rank ?? '')
    const posEcr = Number.parseInt(posRank.replace(/[^0-9]/g, ''), 10)
    const ecr = Number(p.rank_ecr ?? 0)
    if (!Number.isFinite(posEcr) || posEcr <= 0 || !Number.isFinite(ecr) || ecr <= 0) continue

    out.push({
      playerId: Number(p.player_id ?? 0),
      name: String(p.player_name ?? '').trim(),
      team: String(p.player_team_id ?? 'FA').trim(),
      pos,
      posEcr,
      ecr,
      tier: Number.isFinite(Number(p.tier)) ? Number(p.tier) : null,
      owned: Number.isFinite(Number(p.player_owned_avg)) ? Number(p.player_owned_avg) : 0,
      bye: String(p.player_bye_week ?? ''),
    })
  }
  return out.filter((p) => p.name.length > 0)
}

export async function fetchFantasyProsRankings(): Promise<FpPlayer[]> {
  if (cache && Date.now() < cache.expiresAt) return cache.data

  const html = await withBackoff(async () => {
    const res = await fetch(FP_CHEATSHEET_URL, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`FantasyPros returned ${res.status}`)
    return res.text()
  })

  const players = parseFantasyProsHtml(html)
  if (players.length === 0) {
    throw new Error('FantasyPros: could not parse consensus rankings (page format changed?)')
  }
  cache = { data: players, expiresAt: Date.now() + FP_TTL_MS }
  return players
}

/** Per-position rank -> points curve from real prior-season scoring (with projection fallback). */
export function perPositionCurves(
  enriched: FantasyPlayerEnriched[],
  fmt: ScoringFormat,
): Record<string, (rank: number) => number> {
  const curves: Record<string, (rank: number) => number> = {}
  for (const pos of AUCTION_POSITIONS) {
    const withActuals = enriched
      .filter((p) => p.normalizedPosition === pos && (p.seasonActuals?.points ?? 0) > 0)
      .map((p) => formatPointsFromStats(p.seasonActuals?.points ?? 0, p.seasonActuals?.stats, fmt))
      .sort((a, b) => b - a)

    const points =
      withActuals.length >= 12
        ? withActuals
        : enriched
            .filter((p) => p.normalizedPosition === pos && (p.projection?.points ?? 0) > 0)
            .map((p) => formatPointsFromStats(p.projection?.points ?? 0, p.projection?.stats, fmt))
            .sort((a, b) => b - a)

    curves[pos] = fitPositionCurve(points, 24)
  }
  return curves
}

/** Flex slots split across the positions that can fill them — mirrors the auction engine. */
const FLEX_SHARE: Record<string, number> = { QB: 0, RB: 0.4, WR: 0.5, TE: 0.1, K: 0, 'D/ST': 0 }
const POSITION_WEIGHT = getPositionMultipliers()

export interface FpValueEntry {
  player: FpPlayer
  value: number
  vorp: number
}

export interface FpPricing {
  entries: FpValueEntry[]
  assumptions: AuctionAssumptions
}

/**
 * Pure pricing: FantasyPros consensus ranks + league settings -> dollars. No
 * network, deterministic given the inputs, so it is unit-testable.
 */
export function computeFantasyProsValues(
  players: FpPlayer[],
  settings: AuctionSettings,
  starters: StarterSlots,
  curves: Record<string, (rank: number) => number>,
): FpPricing {
  const replacementLevels: Record<string, number> = {}
  for (const pos of AUCTION_POSITIONS) {
    const flex = (FLEX_SHARE[pos] ?? 0) * starters.FLEX
    const depth = Math.max(1, Math.round((starters[pos] + flex) * settings.teams))
    const curve = curves[pos]
    replacementLevels[pos] = curve ? curve(depth) : 0
  }

  const eligible = players.filter((p) => AUCTION_POSITIONS.includes(p.pos))
  const vorps = eligible.map((p) => {
    const curve = curves[p.pos]
    const points = curve ? curve(p.posEcr) : 0
    const vorp = Math.max(0, (points - (replacementLevels[p.pos] ?? 0)) * (POSITION_WEIGHT[p.pos] ?? 1))
    return { p, vorp }
  })

  const totalMoney = settings.budget * settings.teams
  const slots = settings.teams * settings.rosterSize
  const topVorp = [...vorps].sort((a, b) => b.vorp - a.vorp).slice(0, slots)
  const totalVorp = topVorp.reduce((s, e) => s + e.vorp, 0)
  const discretionary = Math.max(0, totalMoney - slots)
  const dollarsPerPoint = totalVorp > 0 ? discretionary / totalVorp : 0

  const entries: FpValueEntry[] = vorps.map(({ p, vorp }) => ({
    player: p,
    vorp: Math.round(vorp * 10) / 10,
    value: Math.max(1, Math.round((1 + vorp * dollarsPerPoint) * 10) / 10),
  }))

  return {
    entries,
    assumptions: {
      budget: settings.budget,
      teams: settings.teams,
      rosterSize: settings.rosterSize,
      totalMoney,
      discretionary,
      dollarsPerPoint: Math.round(dollarsPerPoint * 1000) / 1000,
      replacementLevels,
      marketUnavailable: true,
    },
  }
}
