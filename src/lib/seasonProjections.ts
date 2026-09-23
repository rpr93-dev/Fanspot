import { isRosterOut } from '@/lib/injury'
import { MLB_PITCHER_POSITIONS } from '@/lib/roster-stats'

/**
 * Keyless per-game projected lines for NBA / NHL / MLB, built from ESPN
 * season stats — the same method as the NFL fallback in /api/props (season
 * per-game rate × Vegas implied-team-total matchup multiplier), so every sport
 * gets a comparable "projection vs book line" table. NFL additionally runs the
 * Python prop model; these lines are the cross-sport baseline.
 *
 * `sd` is a heuristic spread for the edge badge: sqrt(mean × φ), where φ is an
 * over-dispersion factor per stat (counts are roughly Poisson; NBA points
 * swing more). It is deliberately simple and labelled as such in the UI.
 */

export type ProjectionSport = 'NBA' | 'NHL' | 'MLB'

export interface SeasonProjectionLine {
  /** Market-agnostic stat id, shared with the Odds API market mapping. */
  stat: string
  label: string
  value: number
  sd: number
}

export interface SeasonProjection {
  name: string
  position: string
  team: string
  /** ESPN injury status when flagged but not out (e.g. "Day-To-Day"). */
  status: string | null
  note: string | null
  lines: SeasonProjectionLine[]
}

/** League-average points per team per game — the matchup multiplier baseline. */
export const LEAGUE_AVG_TEAM_TOTAL: Record<'NFL' | ProjectionSport, number> = {
  NFL: 22,
  NBA: 114,
  NHL: 3.1,
  MLB: 4.4,
}

/**
 * Individual counting stats move less than team scoring, so the non-NFL
 * multiplier is clamped tighter than NFL's [0.6, 1.4].
 */
export const MATCHUP_CLAMP: Record<'NFL' | ProjectionSport, [number, number]> = {
  NFL: [0.6, 1.4],
  NBA: [0.85, 1.15],
  NHL: [0.8, 1.2],
  MLB: [0.8, 1.2],
}

export function matchupMultiplier(sport: 'NFL' | ProjectionSport, impliedTeamTotal: number): number {
  if (!Number.isFinite(impliedTeamTotal) || impliedTeamTotal <= 0) return 1
  const [lo, hi] = MATCHUP_CLAMP[sport]
  return Math.min(hi, Math.max(lo, impliedTeamTotal / LEAGUE_AVG_TEAM_TOTAL[sport]))
}

interface StatSpec {
  stat: string
  label: string
  /** Per-game value from season stats (null when not derivable). */
  perGame: (s: StatReader) => number | null
  /** Over-dispersion factor for the heuristic sd. */
  phi: number
  /** Scales with the team's implied total (offense) — false for saves / pitcher Ks. */
  offensive: boolean
}

interface StatReader {
  num: (key: string) => number | null
}

const perGameOf = (total: string, games: string) => (s: StatReader) => {
  const t = s.num(total)
  const g = s.num(games)
  return t != null && g != null && g > 0 ? t / g : null
}
const direct = (key: string) => (s: StatReader) => s.num(key)

const NBA_STATS: StatSpec[] = [
  { stat: 'points', label: 'PTS', perGame: direct('avgPoints'), phi: 2, offensive: true },
  { stat: 'rebounds', label: 'REB', perGame: direct('avgRebounds'), phi: 1.2, offensive: true },
  { stat: 'assists', label: 'AST', perGame: direct('avgAssists'), phi: 1.2, offensive: true },
  { stat: 'threes', label: '3PM', perGame: direct('avgThreePointFieldGoalsMade'), phi: 1.2, offensive: true },
]
const NHL_SKATER_STATS: StatSpec[] = [
  { stat: 'points', label: 'PTS', perGame: perGameOf('points', 'games'), phi: 1.1, offensive: true },
  { stat: 'shots', label: 'SOG', perGame: perGameOf('shotsTotal', 'games'), phi: 1.1, offensive: true },
  { stat: 'goals', label: 'Goals', perGame: perGameOf('goals', 'games'), phi: 1.1, offensive: true },
]
const NHL_GOALIE_STATS: StatSpec[] = [
  { stat: 'saves', label: 'Saves', perGame: perGameOf('saves', 'gameStarted'), phi: 1.1, offensive: false },
]
const MLB_HITTER_STATS: StatSpec[] = [
  { stat: 'hits', label: 'Hits', perGame: perGameOf('hits', 'gamesPlayed'), phi: 1.1, offensive: true },
  { stat: 'total_bases', label: 'Total Bases', perGame: perGameOf('totalBases', 'gamesPlayed'), phi: 1.5, offensive: true },
  { stat: 'rbis', label: 'RBIs', perGame: perGameOf('RBIs', 'gamesPlayed'), phi: 1.5, offensive: true },
  { stat: 'home_runs', label: 'HR', perGame: perGameOf('homeRuns', 'gamesPlayed'), phi: 1.1, offensive: true },
]
const MLB_PITCHER_STATS: StatSpec[] = [
  {
    stat: 'strikeouts',
    label: 'Strikeouts',
    // Per start; an opener / bulk reliever with no starts falls back to per appearance.
    perGame: (s) => perGameOf('strikeouts', 'gamesStarted')(s) ?? perGameOf('strikeouts', 'gamesPlayed')(s),
    phi: 1.1,
    offensive: false,
  },
]

/** How many players per team to project, and how to rank / qualify them. */
const SELECTION = {
  NBA: { count: 6, rankKey: 'avgMinutes', minGames: 'gamesPlayed', minGamesValue: 3 },
  NHL: { count: 5, rankKey: 'points', minGames: 'games', minGamesValue: 3 },
  MLB: { count: 6, rankKey: 'plateAppearances', minGames: 'gamesPlayed', minGamesValue: 10 },
} as const

function reader(stats: Record<string, string> | null | undefined): StatReader {
  return {
    num: (key) => {
      const raw = stats?.[key]
      if (raw == null) return null
      const n = parseFloat(String(raw).replace(/,/g, ''))
      return Number.isFinite(n) ? n : null
    },
  }
}

function round(v: number): number {
  // Keep sub-1 rates (HR/game, goals/game) readable against 0.5 lines.
  return v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10
}

function injuryStatus(athlete: any): { out: boolean; status: string | null } {
  const status = athlete?.injuries?.[0]?.status
  if (typeof status !== 'string' || !status) return { out: false, status: null }
  return { out: isRosterOut(status), status }
}

function buildLines(specs: StatSpec[], stats: Record<string, string> | null, multiplier: number): SeasonProjectionLine[] {
  const r = reader(stats)
  const out: SeasonProjectionLine[] = []
  for (const spec of specs) {
    const base = spec.perGame(r)
    if (base == null || base <= 0) continue
    const value = base * (spec.offensive ? multiplier : 1)
    out.push({ stat: spec.stat, label: spec.label, value: round(value), sd: Math.round(Math.sqrt(value * spec.phi) * 100) / 100 })
  }
  return out
}

function project(athlete: any, team: string, specs: StatSpec[], multiplier: number, note: string | null = null): SeasonProjection | null {
  const lines = buildLines(specs, athlete.seasonStats, multiplier)
  if (!lines.length) return null
  return {
    name: athlete.displayName ?? athlete.fullName ?? '',
    position: athlete.position?.abbreviation ?? '',
    team,
    status: injuryStatus(athlete).status,
    note,
    lines,
  }
}

/**
 * Projections for one team's roster (athletes as returned by fetchTeamRoster).
 * Players flagged Out/IR/Doubtful are skipped — the next man up is projected
 * instead, mirroring the NFL lineup's auto-swap.
 */
export function buildSeasonProjections(
  sport: ProjectionSport,
  athletes: any[],
  team: string,
  multiplier: number,
  opts: { probablePitcherIds?: string[] } = {},
): SeasonProjection[] {
  const sel = SELECTION[sport]
  const available = athletes.filter((a) => a?.seasonStats && !injuryStatus(a).out)
  const qualifies = (a: any) => (reader(a.seasonStats).num(sel.minGames) ?? 0) >= sel.minGamesValue
  const rank = (a: any) => reader(a.seasonStats).num(sel.rankKey) ?? 0

  const pos = (a: any) => String(a?.position?.abbreviation ?? '').toUpperCase()
  const isSpecialist = (a: any) =>
    (sport === 'NHL' && pos(a) === 'G') || (sport === 'MLB' && MLB_PITCHER_POSITIONS.has(pos(a)))
  const regulars = available
    .filter((a) => !isSpecialist(a) && qualifies(a))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, sel.count)

  const specs = sport === 'NBA' ? NBA_STATS : sport === 'NHL' ? NHL_SKATER_STATS : MLB_HITTER_STATS
  const out = regulars
    .map((a) => project(a, team, specs, multiplier))
    .filter((p): p is SeasonProjection => p != null)

  if (sport === 'NHL') {
    // Starter isn't published ahead of time: project the goalie with the most starts.
    const goalie = available
      .filter((a) => pos(a) === 'G')
      .sort((a, b) => (reader(b.seasonStats).num('gameStarted') ?? 0) - (reader(a.seasonStats).num('gameStarted') ?? 0))[0]
    const g = goalie ? project(goalie, team, NHL_GOALIE_STATS, 1, 'Most starts — starter not confirmed') : null
    if (g) out.push(g)
  }

  if (sport === 'MLB' && opts.probablePitcherIds?.length) {
    // Only the announced probable starter — never guess a pitcher.
    const ids = new Set(opts.probablePitcherIds)
    for (const a of available) {
      if (!ids.has(String(a.id))) continue
      const p = project(a, team, MLB_PITCHER_STATS, 1, 'Probable starter')
      if (p) out.unshift(p)
    }
  }

  return out
}
