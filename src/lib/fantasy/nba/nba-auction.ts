/**
 * NBA auction values — value over replacement, priced to the user's league.
 *
 * No positional replacement levels: NBA lineups are mostly flexible (G/F/UT slots), so
 * replacement is league-wide — the value of the last player the league will roster
 * (teams × roster size, ≈ top 150 by default). Every drafted player costs at least $1;
 * the money above that floor is split across total value over replacement.
 *
 *   value = $1 + (playerValue - replacementValue) × (money - $1·slots) / Σ VORP
 *
 * Market = ESPN's average winning bid, rescaled to this league's total money.
 */

import type { AuctionAssumptions, AuctionRow } from '../auction-engine'
import type { NbaPlayer } from './nba-db'
import { computeNbaValues, nbaInjury } from './nba-steal-engine'
import { isNbaScoring, nbaStatLineText, type NbaScoring } from './nba-scoring'

export interface NbaAuctionSettings {
  budget: number
  teams: number
  rosterSize: number
  scoring: NbaScoring
}

export const DEFAULT_NBA_AUCTION_SETTINGS: NbaAuctionSettings = {
  budget: 200,
  teams: 12,
  rosterSize: 13,
  scoring: 'points',
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function clampNbaAuctionSettings(s: {
  budget?: unknown
  teams?: unknown
  rosterSize?: unknown
  scoring?: unknown
}): NbaAuctionSettings {
  const d = DEFAULT_NBA_AUCTION_SETTINGS
  return {
    budget: clampInt(s.budget, 10, 1000, d.budget),
    teams: clampInt(s.teams, 2, 20, d.teams),
    rosterSize: clampInt(s.rosterSize, 1, 25, d.rosterSize),
    scoring: typeof s.scoring === 'string' && isNbaScoring(s.scoring) ? s.scoring : d.scoring,
  }
}

export interface NbaAuctionBoard {
  rows: AuctionRow[]
  injuryWatch: AuctionRow[]
  assumptions: AuctionAssumptions & { replacementRank: number; scoring: NbaScoring }
}

export function buildNbaAuctionBoard(players: NbaPlayer[], settings: NbaAuctionSettings): NbaAuctionBoard {
  const pool = players.filter((p) => p.active && p.projection != null && p.projection.gp > 0)
  const { value } = computeNbaValues(pool, settings.scoring)

  const ranked = pool
    .map((p) => ({ p, v: value.get(p.id) ?? 0 }))
    .sort((a, b) => b.v - a.v)

  const slots = settings.teams * settings.rosterSize
  const replacementRank = Math.min(slots, ranked.length)
  const replacement = replacementRank > 0 ? ranked[replacementRank - 1].v : 0
  const drafted = ranked.slice(0, replacementRank).map((e) => ({ ...e, vorp: Math.max(0, e.v - replacement) }))

  const totalMoney = settings.budget * settings.teams
  const discretionary = Math.max(0, totalMoney - slots)
  const totalVorp = drafted.reduce((s, e) => s + e.vorp, 0)
  const dollarsPerPoint = totalVorp > 0 ? discretionary / totalVorp : 0

  const publishedTotal = pool.reduce((s, p) => s + Math.max(0, p.auctionValueAverage), 0)
  const scale = publishedTotal > 0 ? totalMoney / publishedTotal : null
  const z = settings.scoring === 'category'
  const round = (n: number) => (z ? Math.round(n * 10) / 10 : Math.round(n))

  const rows: AuctionRow[] = drafted.map(({ p, v, vorp }) => {
    const worth = Math.max(1, Math.round((1 + vorp * dollarsPerPoint) * 10) / 10)
    const market = scale != null && p.auctionValueAverage > 0 ? Math.round(p.auctionValueAverage * scale * 10) / 10 : null
    const injury = nbaInjury(p)
    return {
      playerId: p.id,
      name: p.name,
      pos: p.eligible.join('/') || p.pos,
      team: p.team,
      projectedPoints: round(v),
      vorp: Math.round(vorp * 10) / 10,
      value: worth,
      market,
      surplus: market != null ? Math.round((worth - market) * 10) / 10 : null,
      posRank: 0,
      injuryTier: injury.tier,
      injuryDetail: injury.detail,
      suspended: injury.suspended,
      eligible: p.eligible,
      valueUnit: z ? 'z' : 'pts',
      statLine: nbaStatLineText(p.projection),
    }
  })

  const unavailable = (r: AuctionRow) => r.suspended || r.injuryTier === 'severe' || r.injuryTier === 'out'
  const healthy = rows.filter((r) => !unavailable(r))
  const injuryWatch = rows.filter(unavailable)

  // League-wide rank by surplus (positions are an eligibility filter, not a pool).
  ;[...healthy]
    .sort((a, b) => (b.surplus ?? -Infinity) - (a.surplus ?? -Infinity))
    .forEach((r, i) => {
      r.posRank = i + 1
    })

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
      replacementLevels: { ALL: round(replacement) },
      marketUnavailable: scale == null,
      replacementRank,
      scoring: settings.scoring,
    },
  }
}
