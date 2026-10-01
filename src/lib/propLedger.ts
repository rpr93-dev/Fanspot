/**
 * Shared helpers for the game-day prop ledger (see prop-model/propmodel/ledger.py):
 * parsing live per-player stats out of the /api/box-score payload.
 *
 * The box-score route flattens ESPN's categories to
 * { label, athletes: [{ displayName, stats }] } where stats is keyed by ESPN's
 * short column LABELS (verified against real summary payloads):
 *   NFL:  Passing (C/ATT, YDS, AVG, TD, …), Rushing (CAR, YDS, AVG, TD, LONG),
 *         Receiving (REC, YDS, AVG, TD, LONG, TGTS)
 *   NBA:  Stats (MIN, PTS, FG, 3PT, FT, REB, AST, TO, STL, BLK, …; FG/3PT/FT
 *         are "made-att" strings like "6-13")
 *   NHL:  Forwards/Defenses (G, A, S, SOG, TOI, …), Goalies (GA, SA, SV, TOI, …)
 *         — note ESPN's SOG label means shootout goals; real shots come from S.
 *   MLB:  Batting (H-AB, AB, R, H, RBI, HR, BB, K, #P, …),
 *         Pitching (IP, H, R, ER, BB, K, HR, PC-ST, ERA, PC)
 */

export const MODEL_STATS = [  'passing_yards',
  'rushing_yards',
  'receiving_yards',
  'receptions',
  'tds',
] as const

export type ModelStat = (typeof MODEL_STATS)[number]

/** Gradeable live stats per sport (mirrors /api/props MARKETS minus the ones
 *  the box-score feed can't observe: MLB total_bases has no 2B/3B splits). */
export const MODEL_STATS_PER_SPORT: Record<string, string[]> = {
  NFL: ['passing_yards', 'rushing_yards', 'receiving_yards', 'receptions', 'tds'],
  NBA: ['points', 'rebounds', 'assists', 'threes'],
  NHL: ['goals', 'assists', 'points', 'shots', 'saves'],
  MLB: ['hits', 'rbis', 'home_runs', 'strikeouts'],
}

export type LiveStatMap = Record<string, number | null>

/** Panel event date ("YYYYMMDD" or ISO) -> the CLI's --as-of form. Pure/client-safe. */
export function eventDateToAsOf(eventDate?: string | null): string | null {
  if (!eventDate) return null
  if (/^\d{8}$/.test(eventDate)) {
    return `${eventDate.slice(0, 4)}-${eventDate.slice(4, 6)}-${eventDate.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(eventDate)) return eventDate.slice(0, 10)
  return null
}

/** Token-based name match (same semantics as the panel's scraped-line matcher). */
export function namesMatch(a: string, b: string): boolean {
  const norm = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'junior', 'senior'])
  const want = norm(a)
  const wantToks = want.split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
  const otherToks = norm(b).split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
  const other = otherToks.join(' ')
  return other === want
    || (wantToks.length > 0 && wantToks.every((w) => other.includes(w)))
    || (otherToks.length > 0 && otherToks.every((s) => want.includes(s)))
    || (wantToks.length === 1 && want.length > 3 && other.includes(want.slice(1)))
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && v !== '--') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function athleteValues(categories: any[] | undefined, name: string): Record<string, number | null> {
  const out: Record<string, number | null> = {
    passing_yards: null, rushing_yards: null, receiving_yards: null,
    receptions: null, passing_tds: null, rushing_tds: null, receiving_tds: null,
  }
  if (!Array.isArray(categories)) return out
  for (const cat of categories) {
    const label = String(cat?.label ?? '').toLowerCase()
    const athletes = cat?.athletes
    if (!Array.isArray(athletes)) continue
    const a = athletes.find((x: any) => typeof x?.displayName === 'string' && namesMatch(name, x.displayName))
    if (!a || typeof a.stats !== 'object' || a.stats == null) continue
    const s = a.stats as Record<string, unknown>
    if (label === 'passing') {
      const y = toNum(s['YDS']); if (y != null) out.passing_yards = (out.passing_yards ?? 0) + y
      const t = toNum(s['TD']); if (t != null) out.passing_tds = (out.passing_tds ?? 0) + t
    } else if (label === 'rushing') {
      const y = toNum(s['YDS']); if (y != null) out.rushing_yards = (out.rushing_yards ?? 0) + y
      const t = toNum(s['TD']); if (t != null) out.rushing_tds = (out.rushing_tds ?? 0) + t
    } else if (label === 'receiving') {
      const y = toNum(s['YDS']); if (y != null) out.receiving_yards = (out.receiving_yards ?? 0) + y
      const r = toNum(s['REC']); if (r != null) out.receptions = (out.receptions ?? 0) + r
      const t = toNum(s['TD']); if (t != null) out.receiving_tds = (out.receiving_tds ?? 0) + t
    }
  }
  return out
}

function tdTotal(v: Record<string, number | null>): number | null {
  const parts = [v.passing_tds, v.rushing_tds, v.receiving_tds].filter((n): n is number => n != null)
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0)
}

/**
 * Map model target names -> per-stat live values from a /api/box-score payload.
 * A name absent from the box score — or present but not participating (NBA 0
 * MIN, NHL 0:00 TOI, MLB 0 AB / no batters faced) — yields nulls, so DNPs are
 * never graded as zeroes (books void those bets).
 */
export function extractLiveStats(
  boxScore: any,
  players: { name: string }[],
  sport: string = 'NFL',
): Record<string, LiveStatMap> {
  const teams: any[] = boxScore?.playerStats ?? boxScore?.teams ?? []
  // playerStats entries hold { teamAbbr, categories }; fall back to scanning
  // anything with a `categories` array.
  const groups: any[][] = []
  if (Array.isArray(teams)) {
    for (const t of teams) {
      if (Array.isArray(t?.categories)) groups.push(t.categories)
      else if (Array.isArray(t?.playerStats)) {
        for (const ps of t.playerStats) if (Array.isArray(ps?.categories)) groups.push(ps.categories)
      }
    }
  }
  const merged: any[] = groups.flat()
  const out: Record<string, LiveStatMap> = {}
  const s = (sport || 'NFL').toUpperCase()
  for (const p of players) {
    out[p.name] = s === 'NBA'
      ? nbaLive(merged, p.name)
      : s === 'NHL'
        ? nhlLive(merged, p.name)
        : s === 'MLB'
          ? mlbLive(merged, p.name)
          : nflLive(merged, p.name)
  }
  return out
}

/** Find one athlete's stats record across merged categories. */
function findAthlete(categories: any[], name: string): { label: string; stats: Record<string, unknown> }[] {
  const hits: { label: string; stats: Record<string, unknown> }[] = []
  for (const cat of categories) {
    const athletes = cat?.athletes
    if (!Array.isArray(athletes)) continue
    const a = athletes.find((x: any) => typeof x?.displayName === 'string' && namesMatch(name, x.displayName))
    if (a && typeof a.stats === 'object' && a.stats != null) {
      hits.push({ label: String(cat?.label ?? '').toLowerCase(), stats: a.stats as Record<string, unknown> })
    }
  }
  return hits
}

/** "6-13" -> 6 (NBA FG/3PT/FT are made-att strings). */
function madeOf(v: unknown): number | null {
  if (typeof v !== 'string') return toNum(v)
  const made = v.split('-')[0]
  return toNum(made)
}

/** "16:25" -> 985 (NHL TOI is M:SS). */
function toiSeconds(v: unknown): number {
  if (typeof v !== 'string') return 0
  const [m, s] = v.split(':').map(Number)
  if (!Number.isFinite(m)) return 0
  return m * 60 + (Number.isFinite(s) ? s : 0)
}

function nullsFor(stats: string[]): LiveStatMap {
  return Object.fromEntries(stats.map((k) => [k, null]))
}

function nbaLive(categories: any[], name: string): LiveStatMap {
  const stats = MODEL_STATS_PER_SPORT.NBA
  const entries = findAthlete(categories, name)
  if (!entries.length) return nullsFor(stats)
  const s = entries[0].stats
  // Dressed but never checked in: no minutes, no grading.
  if ((toNum(s['MIN']) ?? 0) <= 0) return nullsFor(stats)
  return {
    points: toNum(s['PTS']),
    rebounds: toNum(s['REB']),
    assists: toNum(s['AST']),
    threes: madeOf(s['3PT']),
  }
}

function nhlLive(categories: any[], name: string): LiveStatMap {
  const stats = MODEL_STATS_PER_SPORT.NHL
  const entries = findAthlete(categories, name)
  if (!entries.length) return nullsFor(stats)
  const played = entries.some((e) => toiSeconds(e.stats['TOI']) > 0)
  if (!played) return nullsFor(stats)
  let goals: number | null = null
  let assists: number | null = null
  let shots: number | null = null
  let saves: number | null = null
  for (const e of entries) {
    if (e.label === 'goalies') {
      const sv = toNum(e.stats['SV'])
      if (sv != null) saves = (saves ?? 0) + sv
    } else {
      const g = toNum(e.stats['G']); if (g != null) goals = (goals ?? 0) + g
      const a = toNum(e.stats['A']); if (a != null) assists = (assists ?? 0) + a
      // S is shots on goal; SOG is the shootoutGoals column (same-game
      // shootouts only) — never the betting line.
      const sh = toNum(e.stats['S']); if (sh != null) shots = (shots ?? 0) + sh
    }
  }
  const points = goals != null || assists != null ? (goals ?? 0) + (assists ?? 0) : null
  return { goals, assists, points, shots, saves }
}

function mlbLive(categories: any[], name: string): LiveStatMap {
  const stats = MODEL_STATS_PER_SPORT.MLB
  const entries = findAthlete(categories, name)
  if (!entries.length) return nullsFor(stats)
  let hits: number | null = null
  let rbis: number | null = null
  let homeRuns: number | null = null
  let strikeouts: number | null = null
  let played = false
  for (const e of entries) {
    if (e.label === 'pitching') {
      const ip = parseFloat(String(e.stats['IP'] ?? ''))
      const countable = ['H', 'R', 'ER', 'BB', 'K', 'HR'].some((k) => (toNum(e.stats[k]) ?? 0) !== 0)
      if (!(ip > 0) && !countable) continue // listed but faced nobody
      played = true
      const k = toNum(e.stats['K']); if (k != null) strikeouts = (strikeouts ?? 0) + k
    } else {
      // Batting (also covers 'fielding' rows that carry the same columns).
      const ab = toNum(e.stats['AB']) ?? 0
      const pitches = toNum(e.stats['#P']) ?? 0
      if (ab <= 0 && pitches <= 0) continue // PR/defensive sub with no plate appearance
      played = true
      const h = toNum(e.stats['H']); if (h != null) hits = (hits ?? 0) + h
      const r = toNum(e.stats['RBI']); if (r != null) rbis = (rbis ?? 0) + r
      const hr = toNum(e.stats['HR']); if (hr != null) homeRuns = (homeRuns ?? 0) + hr
    }
  }
  if (!played) return nullsFor(stats)
  return { hits, rbis, home_runs: homeRuns, strikeouts }
}

function nflLive(categories: any[], name: string): LiveStatMap {
  const v = athleteValues(categories, name)
  const found = Object.values(v).some((x) => x != null)
  return {
    passing_yards: found ? v.passing_yards : null,
    rushing_yards: found ? v.rushing_yards : null,
    receiving_yards: found ? v.receiving_yards : null,
    receptions: found ? v.receptions : null,
    tds: found ? tdTotal(v) : null,
  }
}

/** Periods completed/in-progress from team linescores (Q for NFL/NBA, P for
 *  NHL, innings for MLB). 0 = no data. */
export function quartersPlayed(boxScore: any): number {
  const teams = boxScore?.teams
  if (!Array.isArray(teams)) return 0
  let q = 0
  for (const t of teams) {
    const ls = t?.linescores
    if (Array.isArray(ls)) q = Math.max(q, ls.length)
  }
  return q
}

/** Sport-aware alias of quartersPlayed (same linescore-length semantics). */
export const periodsPlayed = quartersPlayed

function ordinal(n: number): string {
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** Short live badge: "Q3" (NFL/NBA), "P2" (NHL), "7th" (MLB). */
export function periodLabel(sport: string, periods: number): string {
  if (periods <= 0) return ''
  switch ((sport || '').toUpperCase()) {
    case 'NHL': return `P${periods}`
    case 'MLB': return ordinal(periods)
    default: return `Q${periods}`
  }
}

export function isGameComplete(boxScore: any): boolean {
  const state = boxScore?.status?.state
  if (state === 'post') return true
  const d = `${boxScore?.status?.description ?? ''} ${boxScore?.status?.shortDetail ?? ''}`
  return /final|ended|game over/i.test(d)
}
