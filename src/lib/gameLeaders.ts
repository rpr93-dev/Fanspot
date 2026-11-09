/**
 * Game Leaders — pure selectors for the "who is carrying this game" block on
 * the Game Hub overview.
 *
 * ESPN's box score groups players into per-sport categories (Passing / Rushing
 * / Receiving / Defense / Kicking for the NFL, one `Stats` table for the NBA,
 * Forwards / Goalies for the NHL, Batting / Pitching for the MLB) and each
 * athlete carries a `stats` map keyed by the same abbreviations the category
 * lists in `statNames` (e.g. `{ YDS: '210' }`).
 *
 * We therefore derive leaders from data that is already on the page: for a
 * fixed list of headline categories + stats, pick the highest value in that
 * team's category. Nothing is invented — a category that is missing, empty, or
 * where the leader is still on zero simply produces no row, so a pregame box
 * score renders nothing instead of a table of zeroes.
 *
 * Kept free of React/DOM so it stays unit-testable next to `lib/plays.ts`.
 */

export interface LeaderAthlete {
  id?: string
  displayName: string
  jersey?: string
  position?: string
  stats?: Record<string, string>
}

export interface LeaderCategory {
  label: string
  statNames?: string[]
  athletes?: LeaderAthlete[]
}

export interface LeaderTeam {
  teamAbbr: string
  categories?: LeaderCategory[]
}

export interface GameLeader {
  /** Team the leader plays for (as the box score reports it). */
  teamAbbr: string
  /** Player page id when the feed supplies one. */
  playerId: string | null
  playerName: string
  jersey?: string
  position?: string
  /** Human label for the stat that is led, e.g. "Pass Yds". */
  statLabel: string
  /** Raw display value straight from the feed (never reformatted). */
  value: string
  /** Numeric magnitude used for ranking (not displayed). */
  numeric: number
}

/**
 * Which stat to rank by, per ESPN category. Several rules may share a category
 * (NBA points/rebounds/assists all live in `Stats`; NHL goals and assists both
 * live in `Forwards`). Order is the display order.
 */
export const LEADER_RULES: readonly { category: string; stat: string; label: string }[] = [
  { category: 'Passing', stat: 'YDS', label: 'Pass Yds' },
  { category: 'Rushing', stat: 'YDS', label: 'Rush Yds' },
  { category: 'Receiving', stat: 'YDS', label: 'Rec Yds' },
  { category: 'Defense', stat: 'TOT', label: 'Tackles' },
  { category: 'Kicking', stat: 'PTS', label: 'Kicking Pts' },
  { category: 'Stats', stat: 'PTS', label: 'Points' },
  { category: 'Stats', stat: 'REB', label: 'Rebounds' },
  { category: 'Stats', stat: 'AST', label: 'Assists' },
  { category: 'Forwards', stat: 'G', label: 'Goals' },
  { category: 'Forwards', stat: 'A', label: 'Assists' },
  { category: 'Defenses', stat: 'SOG', label: 'Shots' },
  { category: 'Goalies', stat: 'SV', label: 'Saves' },
  { category: 'Batting', stat: 'HR', label: 'Home Runs' },
  { category: 'Batting', stat: 'RBI', label: 'RBI' },
  { category: 'Batting', stat: 'H', label: 'Hits' },
  { category: 'Pitching', stat: 'K', label: 'Strikeouts' },
]

/**
 * Leading magnitude of a display value. Ratios rank by their numerator ("3/3"
 * field goals → 3 made), percentages by the number itself (".783" → 0.783),
 * and anything unparsable is unknown rather than zero.
 */
export function leaderNumeric(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const m = String(raw).trim().match(/^[-+]?(\d+(\.\d+)?|\.\d+)/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Leaders for one team, in rule order. A rule only produces a row when the
 * category exists and its best value is above zero (a 0-goal "leader" is
 * noise, and a team with no box score at all yields an empty list).
 */
export function selectTeamLeaders(team: LeaderTeam, limit = 4): GameLeader[] {
  const byLabel = new Map<string, LeaderCategory>()
  for (const cat of team.categories ?? []) {
    if (cat?.label && !byLabel.has(cat.label)) byLabel.set(cat.label, cat)
  }
  const out: GameLeader[] = []
  for (const rule of LEADER_RULES) {
    if (out.length >= limit) break
    const cat = byLabel.get(rule.category)
    if (!cat) continue
    let best: { athlete: LeaderAthlete; numeric: number; value: string } | null = null
    for (const athlete of cat.athletes ?? []) {
      const value = athlete?.stats?.[rule.stat]
      const numeric = leaderNumeric(value)
      if (numeric == null || numeric <= 0) continue
      if (!best || numeric > best.numeric) best = { athlete, numeric, value: String(value) }
    }
    if (!best) continue
    out.push({
      teamAbbr: team.teamAbbr,
      playerId: best.athlete.id ?? null,
      playerName: best.athlete.displayName ?? '',
      jersey: best.athlete.jersey,
      position: best.athlete.position,
      statLabel: rule.label,
      value: best.value,
      numeric: best.numeric,
    })
  }
  return out
}

/**
 * Leaders for every team in the box score, in the order the feed lists them
 * (away first on ESPN payloads). Empty when there is nothing to show.
 */
export function selectGameLeaders(
  playerStats: LeaderTeam[] | null | undefined,
  limitPerTeam = 4,
): GameLeader[] {
  return (playerStats ?? []).flatMap((team) => selectTeamLeaders(team, limitPerTeam))
}

/** Leaders for one specific team (used to render the two columns). */
export function leadersForTeam(
  playerStats: LeaderTeam[] | null | undefined,
  teamAbbr: string,
  limit = 4,
): GameLeader[] {
  const key = (teamAbbr ?? '').toUpperCase()
  const team = (playerStats ?? []).find((t) => (t.teamAbbr ?? '').toUpperCase() === key)
  return team ? selectTeamLeaders(team, limit) : []
}
