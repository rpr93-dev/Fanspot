/**
 * NBA fantasy scoring — pure, client-safe helpers shared by the NBA steals and auction
 * boards. Nothing here knows about football: no PPR, no FLEX, no positional VORP. NBA
 * positions are fluid, so value is computed league-wide and positions only filter.
 *
 * ESPN `fba` stat lines (kona_player_info `stats[].stats`) are SEASON TOTALS — e.g.
 * Jokic's 2027 projection carries PTS 2034 over GP 72 (28.2/g; stat 29 is the per-game
 * figure ESPN derives). Every per-game number below is total / GP.
 */

import { NBA_TEAM_MAP } from '@/lib/fantasy-types'

/** ESPN fba stat ids. */
export const NBA_STAT = {
  PTS: '0',
  BLK: '1',
  STL: '2',
  AST: '3',
  OREB: '4',
  DREB: '5',
  REB: '6',
  TO: '11',
  FGM: '13',
  FGA: '14',
  FTM: '15',
  FTA: '16',
  TPM: '17',
  TPA: '18',
  FG_PCT: '19',
  FT_PCT: '20',
  TP_PCT: '21',
  MIN: '40',
  GS: '41',
  GP: '42',
} as const

export const NBA_SEASON_GAMES = 82

/** Fallback games-played when a projection omits GP (ESPN always sends it in practice). */
const DEFAULT_PROJECTED_GP = 70

export const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
export type NbaPosition = (typeof NBA_POSITIONS)[number]

export const NBA_SCORING_FORMATS = ['points', 'category'] as const
export type NbaScoring = (typeof NBA_SCORING_FORMATS)[number]

export function isNbaScoring(v: string): v is NbaScoring {
  return (NBA_SCORING_FORMATS as readonly string[]).includes(v)
}

/** ESPN defaultPositionId -> position. */
const DEFAULT_POSITION: Record<number, NbaPosition> = { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' }

/**
 * ESPN eligibleSlots -> the base positions they grant. Combo slots (5 G, 6 F, 9 PF/C,
 * 10 F/C) and UT/BE/IR add nothing a base slot doesn't already say, so only 0-4 count.
 */
const SLOT_POSITION: Record<number, NbaPosition> = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' }

export function nbaPrimaryPosition(defaultPositionId: number): NbaPosition | undefined {
  return DEFAULT_POSITION[defaultPositionId]
}

/** Multi-position eligibility in PG→C order; always includes the primary position. */
export function nbaEligiblePositions(defaultPositionId: number, eligibleSlots: number[] | undefined): NbaPosition[] {
  const set = new Set<NbaPosition>()
  const primary = nbaPrimaryPosition(defaultPositionId)
  if (primary) set.add(primary)
  for (const slot of eligibleSlots ?? []) {
    const p = SLOT_POSITION[slot]
    if (p) set.add(p)
  }
  return NBA_POSITIONS.filter((p) => set.has(p))
}

/** ESPN fba proTeamId -> Fanspot abbr. 0 / unknown -> 'FA'. */
export function nbaTeamAbbr(proTeamId: number): string {
  return NBA_TEAM_MAP[proTeamId] ?? 'FA'
}

/**
 * ESPN keys an NBA season by the calendar year it ENDS in (2026-27 = 2027). ESPN rolls
 * the fantasy game over in the summer, so from July on the upcoming season is current.
 */
export function nbaSeasonId(now: Date = new Date()): number {
  const y = now.getFullYear()
  return now.getMonth() >= 6 ? y + 1 : y
}

export interface NbaStatLine {
  /** Season totals keyed by ESPN stat id. */
  totals: Record<string, number>
  gp: number
}

export function makeStatLine(totals: Record<string, number> | undefined, fallbackGp = DEFAULT_PROJECTED_GP): NbaStatLine | undefined {
  if (!totals || Object.keys(totals).length === 0) return undefined
  const gp = Number(totals[NBA_STAT.GP])
  return { totals, gp: Number.isFinite(gp) && gp > 0 ? gp : fallbackGp }
}

export function total(line: NbaStatLine | undefined, id: string): number {
  const v = line?.totals[id]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function perGame(line: NbaStatLine | undefined, id: string): number {
  if (!line || line.gp <= 0) return 0
  return total(line, id) / line.gp
}

/**
 * ESPN's default points-league scoring. `appliedTotal` is absent on fba lines, so this
 * is the only source of fantasy points for NBA.
 */
export const NBA_POINTS_WEIGHTS: Record<string, number> = {
  [NBA_STAT.PTS]: 1,
  [NBA_STAT.TPM]: 1,
  [NBA_STAT.FGA]: -1,
  [NBA_STAT.FGM]: 2,
  [NBA_STAT.FTA]: -1,
  [NBA_STAT.FTM]: 1,
  [NBA_STAT.REB]: 1,
  [NBA_STAT.AST]: 2,
  [NBA_STAT.STL]: 4,
  [NBA_STAT.BLK]: 4,
  [NBA_STAT.TO]: -2,
}

/** Season fantasy points under ESPN default points scoring (totals already span GP). */
export function nbaFantasyPoints(line: NbaStatLine | undefined): number {
  if (!line) return 0
  let pts = 0
  for (const [id, w] of Object.entries(NBA_POINTS_WEIGHTS)) pts += w * total(line, id)
  return pts
}

export function nbaFantasyPointsPerGame(line: NbaStatLine | undefined): number {
  if (!line || line.gp <= 0) return 0
  return nbaFantasyPoints(line) / line.gp
}

// ---------------------------------------------------------------------------
// 9-category z-score value
// ---------------------------------------------------------------------------

export const NBA_CATEGORIES = ['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO'] as const
export type NbaCategory = (typeof NBA_CATEGORIES)[number]

const COUNTING: Record<Exclude<NbaCategory, 'FG%' | 'FT%'>, string> = {
  PTS: NBA_STAT.PTS,
  REB: NBA_STAT.REB,
  AST: NBA_STAT.AST,
  STL: NBA_STAT.STL,
  BLK: NBA_STAT.BLK,
  '3PM': NBA_STAT.TPM,
  TO: NBA_STAT.TO,
}

/** Default 12-team × 13-roster draftable pool the z-score means/SDs are measured over. */
export const NBA_CATEGORY_POOL = 156

export interface CategoryInput {
  id: number
  line: NbaStatLine
}

export interface CategoryValue {
  /** Per-category per-game z-score (TO already sign-flipped so higher is better). */
  z: Record<NbaCategory, number>
  /** Sum of the nine per-game z-scores. */
  zPerGame: number
  /** zPerGame × GP / 82 — per-game quality scaled by how much of the season it covers. */
  value: number
}

interface Raw {
  id: number
  gp: number
  cats: Record<NbaCategory, number>
  fgm: number
  fga: number
  ftm: number
  fta: number
}

function rawFor(i: CategoryInput): Raw {
  const l = i.line
  const cats = {} as Record<NbaCategory, number>
  for (const [cat, id] of Object.entries(COUNTING)) cats[cat as NbaCategory] = perGame(l, id)
  cats['FG%'] = 0
  cats['FT%'] = 0
  return {
    id: i.id,
    gp: l.gp,
    cats,
    fgm: perGame(l, NBA_STAT.FGM),
    fga: perGame(l, NBA_STAT.FGA),
    ftm: perGame(l, NBA_STAT.FTM),
    fta: perGame(l, NBA_STAT.FTA),
  }
}

function meanSd(xs: number[]): { mean: number; sd: number } {
  if (xs.length === 0) return { mean: 0, sd: 1 }
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
  const sd = Math.sqrt(variance)
  return { mean, sd: sd > 1e-9 ? sd : 1 }
}

function scorePool(raws: Raw[], pool: Raw[]): Map<number, CategoryValue> {
  // Percentages are volume-weighted: a 60% shooter on 3 attempts helps far less than a
  // 52% shooter on 18. Impact = makes above what a league-average shooter would hit on
  // the same attempts, then z-scored like any counting stat.
  const lgFg = pool.reduce((s, r) => s + r.fgm, 0) / Math.max(1e-9, pool.reduce((s, r) => s + r.fga, 0))
  const lgFt = pool.reduce((s, r) => s + r.ftm, 0) / Math.max(1e-9, pool.reduce((s, r) => s + r.fta, 0))
  const withPct = (r: Raw): Record<NbaCategory, number> => ({
    ...r.cats,
    'FG%': r.fgm - lgFg * r.fga,
    'FT%': r.ftm - lgFt * r.fta,
  })

  const poolCats = pool.map(withPct)
  const stats = {} as Record<NbaCategory, { mean: number; sd: number }>
  for (const cat of NBA_CATEGORIES) stats[cat] = meanSd(poolCats.map((c) => c[cat]))

  const out = new Map<number, CategoryValue>()
  for (const r of raws) {
    const c = withPct(r)
    const z = {} as Record<NbaCategory, number>
    let sum = 0
    for (const cat of NBA_CATEGORIES) {
      let v = (c[cat] - stats[cat].mean) / stats[cat].sd
      if (cat === 'TO') v = -v
      z[cat] = v
      sum += v
    }
    out.set(r.id, { z, zPerGame: sum, value: sum * (r.gp / NBA_SEASON_GAMES) })
  }
  return out
}

/**
 * 9-cat z-scores. Means/SDs are measured over the draftable pool, not every body with a
 * stat line, otherwise deep-bench noise flattens the SDs. The pool is seeded by
 * points-league value per game, then re-selected once by the z-sum itself so it settles
 * on the players a categories league would actually roster.
 */
export function computeCategoryValues(
  inputs: CategoryInput[],
  poolSize = NBA_CATEGORY_POOL,
): Map<number, CategoryValue> {
  const raws = inputs.filter((i) => i.line.gp > 0).map(rawFor)
  if (raws.length === 0) return new Map()
  const byId = new Map(inputs.map((i) => [i.id, i.line]))

  const seed = [...raws]
    .sort((a, b) => nbaFantasyPointsPerGame(byId.get(b.id)) - nbaFantasyPointsPerGame(byId.get(a.id)))
    .slice(0, Math.min(poolSize, raws.length))
  let values = scorePool(raws, seed)

  const refined = [...raws]
    .sort((a, b) => (values.get(b.id)?.value ?? 0) - (values.get(a.id)?.value ?? 0))
    .slice(0, Math.min(poolSize, raws.length))
  values = scorePool(raws, refined)
  return values
}

/** "26.3 PTS · 11.5 REB · 3.1 AST · 1.0 STL · 3.1 BLK · 1.9 3PM" per game. */
export function nbaStatLineText(line: NbaStatLine | undefined): string {
  if (!line || line.gp <= 0) return ''
  const f = (id: string) => perGame(line, id).toFixed(1)
  return `${f(NBA_STAT.PTS)} PTS · ${f(NBA_STAT.REB)} REB · ${f(NBA_STAT.AST)} AST · ${f(NBA_STAT.STL)} STL · ${f(NBA_STAT.BLK)} BLK · ${f(NBA_STAT.TPM)} 3PM`
}

/** Strips accents, punctuation and generational suffixes for exact (non-fuzzy) name joins. */
export function normalizeNbaName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'`\u2019-]/g, ' ')
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((t) => t && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(t))
    .join(' ')
}

/** Sleeper NBA team codes -> Fanspot/ESPN abbrs. */
export function sleeperNbaTeam(team: string | null | undefined): string | undefined {
  if (!team) return undefined
  const t = team.toUpperCase()
  if (t === 'NOP') return 'NO'
  if (t === 'WAS') return 'WSH'
  return t
}
