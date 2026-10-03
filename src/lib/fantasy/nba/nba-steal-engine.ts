/**
 * NBA steals board.
 *
 * Basketball positions are fluid (a PF/C and a C draft off the same pool), so the board
 * ranks league-wide: projected overall rank vs. ADP overall rank, with PG/SG/SF/PF/C as
 * an eligibility filter on top. The rank -> value curve is fit to last season's REAL
 * values in the requested scoring (falling back to projections), smoothed and clamped at
 * startable depth (12 teams × ~13 roster ≈ top 150), so deep-bench movement is cheap.
 *
 *   valueGap   = curve(projected rank) - curve(ADP rank)
 *   valueGapPct = valueGap / (curve(1) - curve(depth))   — share of the startable spread
 *   stealScore = valueGapPct × conf/100 × min(1, |rank gap| / 15)
 *
 * Rows use the shared StealRow shape so the existing UI and injury gate apply unchanged.
 */

import type { StealRow } from '../steal-engine'
import { fitPositionCurve } from '../steal-engine'
import { composeNote, resolveInjuryTier, type ResolvedInjury } from '../injury-gate'
import type { NbaPlayer } from './nba-db'
import {
  NBA_SEASON_GAMES,
  NBA_STAT,
  computeCategoryValues,
  nbaFantasyPoints,
  nbaStatLineText,
  perGame,
  type NbaScoring,
  type NbaStatLine,
} from './nba-scoring'

/** 12 teams × 13 roster spots, rounded to the depth leagues actually start/roster. */
export const NBA_STARTABLE_DEPTH = 150

/**
 * Players under this roster share are deep-waiver bodies in 12-team leagues. Lower than
 * the NFL's 5% because NBA rosters are 13 deep with no positional caps.
 */
const NBA_ROSTER_RELEVANCE_PCT = 2

/** Rank gaps below ~15 spots in a 150-deep overall pool are market noise. */
const NBA_GAP_WEIGHT_SPAN = 15

export interface NbaBoardConfig {
  scoring: NbaScoring
  startableDepth?: number
}

export interface NbaValues {
  /** Projected season value (points: fantasy points; category: z-sum × GP/82). */
  value: Map<number, number>
  /** Last season's value in the same units, absent when the player has no prior line. */
  prior: Map<number, number>
}

/** Value in the requested scoring for every player with a projection (and prior line). */
export function computeNbaValues(players: NbaPlayer[], scoring: NbaScoring): NbaValues {
  const value = new Map<number, number>()
  const prior = new Map<number, number>()
  if (scoring === 'points') {
    for (const p of players) {
      if (p.projection) value.set(p.id, nbaFantasyPoints(p.projection))
      if (p.prior) prior.set(p.id, nbaFantasyPoints(p.prior))
    }
    return { value, prior }
  }
  const lines = (pick: (p: NbaPlayer) => NbaStatLine | undefined) =>
    players.flatMap((p) => {
      const line = pick(p)
      return line ? [{ id: p.id, line }] : []
    })
  for (const [id, v] of computeCategoryValues(lines((p) => p.projection))) value.set(id, v.value)
  for (const [id, v] of computeCategoryValues(lines((p) => p.prior))) prior.set(id, v.value)
  return { value, prior }
}

/** ADP for the format: STANDARD rank for points, ROTO for categories, else live ADP. */
export function nbaAdpFor(p: NbaPlayer, scoring: NbaScoring): number | undefined {
  const rank = scoring === 'points' ? p.standardRank : p.rotoRank
  return rank != null && rank > 0 ? rank : p.adp
}

export function nbaInjury(p: NbaPlayer): ResolvedInjury {
  return resolveInjuryTier({
    espnStatus: p.injuryStatus,
    espnInjured: p.injured,
    sleeperStatus: p.sleeper?.injuryStatus,
    bodyPart: p.sleeper?.injuryBodyPart,
    notes: p.sleeper?.injuryNotes,
  })
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * 0-100 trust in the projection: durability (last season's GP / 82), minutes stability
 * (projected vs. last season's MPG, plus the size of the role), injury designation,
 * roster share and experience.
 */
export function nbaConfidence(p: NbaPlayer, injury: ResolvedInjury = nbaInjury(p)): number {
  const exp = p.sleeper?.yearsExp
  const priorGp = p.prior?.gp ?? 0
  const durability = p.prior ? clamp((priorGp / NBA_SEASON_GAMES) * 100) : exp === 0 ? 35 : 25

  const projMpg = perGame(p.projection, NBA_STAT.MIN)
  const priorMpg = perGame(p.prior, NBA_STAT.MIN)
  const role = clamp((projMpg / 34) * 100)
  let minutes: number
  if (priorMpg > 0 && projMpg > 0) {
    const drift = Math.abs(projMpg - priorMpg) / Math.max(projMpg, priorMpg)
    minutes = 0.5 * clamp(100 - drift * 200) + 0.5 * role
  } else {
    minutes = role * 0.6
  }

  const injuryScore =
    injury.suspended ? 10
    : injury.tier === 'severe' ? 5
    : injury.tier === 'out' ? 15
    : injury.tier === 'doubtful' ? 30
    : injury.tier === 'questionable' ? 55
    : injury.tier === 'probable' ? 70
    : injury.designationKnown ? 90 : 78

  const owned = p.percentOwned
  const market = owned > 80 ? 95 : owned > 50 ? 70 : owned > 20 ? 50 : owned > 5 ? 30 : 10

  const experience = exp != null ? clamp(20 + exp * 16) : p.prior ? 60 : 25

  return Math.round(clamp(durability * 0.3 + minutes * 0.25 + injuryScore * 0.15 + market * 0.15 + experience * 0.15))
}

export function nbaConfidenceDriver(p: NbaPlayer): string {
  if (!p.prior) {
    return p.sleeper?.yearsExp === 0 ? 'Rookie with no NBA track record' : 'No NBA stat line last season'
  }
  const mpg = perGame(p.prior, NBA_STAT.MIN)
  return `${p.prior.gp} GP, ${mpg.toFixed(1)} MPG in ${p.priorSeason - 1}-${String(p.priorSeason).slice(2)}`
}

function roundValue(v: number, scoring: NbaScoring): number {
  return scoring === 'points' ? Math.round(v) : Math.round(v * 10) / 10
}

export function buildNbaStealBoard(players: NbaPlayer[], config: NbaBoardConfig): StealRow[] {
  const { scoring } = config
  const depth = config.startableDepth ?? NBA_STARTABLE_DEPTH

  const pool = players.filter(
    (p) =>
      p.active &&
      p.projection != null &&
      p.projection.gp > 0 &&
      p.percentOwned >= NBA_ROSTER_RELEVANCE_PCT &&
      (nbaAdpFor(p, scoring) ?? 0) > 0,
  )
  if (pool.length === 0) return []

  const { value, prior } = computeNbaValues(pool, scoring)
  const val = (p: NbaPlayer) => value.get(p.id) ?? 0

  const priorValues = pool
    .map((p) => prior.get(p.id))
    .filter((v): v is number => v != null)
    .sort((a, b) => b - a)
  const curveSource =
    priorValues.length >= depth ? priorValues : pool.map(val).sort((a, b) => b - a)
  const curve = fitPositionCurve(curveSource, depth)
  const spread = Math.max(1e-6, curve(1) - curve(depth))

  const projRank = new Map<number, number>()
  ;[...pool].sort((a, b) => val(b) - val(a)).forEach((p, i) => projRank.set(p.id, i + 1))
  const adpRank = new Map<number, number>()
  ;[...pool]
    .sort((a, b) => (nbaAdpFor(a, scoring) ?? Infinity) - (nbaAdpFor(b, scoring) ?? Infinity))
    .forEach((p, i) => adpRank.set(p.id, i + 1))

  const rows: StealRow[] = pool.map((p) => {
    const posRank = projRank.get(p.id) as number
    const aRank = adpRank.get(p.id) as number
    const projSlotValue = curve(posRank)
    const adpSlotValue = curve(aRank)
    const valueGap = projSlotValue - adpSlotValue
    const valueGapPct = valueGap / spread
    const injury = nbaInjury(p)
    const conf = nbaConfidence(p, injury)
    const gapWeight = Math.min(1, Math.abs(aRank - posRank) / NBA_GAP_WEIGHT_SPAN)
    const stealScore = valueGapPct * (conf / 100) * gapWeight

    const row: StealRow = {
      playerId: p.id,
      name: p.name,
      pos: p.eligible.join('/') || p.pos,
      team: p.team,
      posRank,
      adpRank: aRank,
      gap: aRank - posRank,
      projSlotValue: roundValue(projSlotValue, scoring),
      adpSlotValue: roundValue(adpSlotValue, scoring),
      valueGap: roundValue(valueGap, scoring),
      valueGapPct,
      stealScore,
      adpSource: 'espn',
      conf,
      ownedPct: Math.round(p.percentOwned),
      note: '',
      posPoolSize: pool.length,
      projectedPoints: roundValue(val(p), scoring),
      overallAdp: nbaAdpFor(p, scoring) as number,
      envScore: 50,
      envSignal: 'average',
      injuryTier: injury.tier,
      injuryStatus: p.injuryStatus || 'UNKNOWN',
      injuryDetail: injury.detail || undefined,
      injurySource: injury.source,
      injuryDesignationKnown: injury.designationKnown,
      injuryChecked: false,
      suspended: injury.suspended,
      gateApplied: false,
      confidenceDriver: nbaConfidenceDriver(p),
      rankScope: 'overall',
      eligible: p.eligible,
      valueUnit: scoring === 'points' ? 'pts' : 'z',
      statLine: nbaStatLineText(p.projection),
    }
    row.note = composeNote(row)
    return row
  })

  rows.sort((a, b) => b.stealScore - a.stealScore || b.valueGap - a.valueGap || a.posRank - b.posRank)
  return rows
}

/** Row matches a PG/SG/SF/PF/C filter when the player is eligible there. */
export function nbaRowMatchesPos(row: Pick<StealRow, 'eligible' | 'pos'>, pos: string): boolean {
  if (pos === 'ALL') return true
  return (row.eligible ?? row.pos.split('/')).includes(pos)
}
