/**
 * Shared grading for the game-day prop ledger (client-safe, no Node imports).
 *
 * A game grades when it has pre-game model rows AND final actuals (a live
 * point with `final: true` or `state: 'post'`). Picks are scored against the
 * frozen closing lines — the most recent book-line snapshot before the game
 * ended — so post-game line movement can't rewrite the scorecard.
 *
 * Mirrors propmodel/ledger.py::grade_game (same pick/outcome semantics).
 */

export interface GradeResult {
  n: number
  mae: number
  picks: number
  hits: number
  pushes: number
  hitRate: number | null
}

/** Short display label for a model stat key across all sports. */
export function statLabel(stat: string): string {
  const labels: Record<string, string> = {
    passing_yards: 'Pass Yds', rushing_yards: 'Rush Yds', receiving_yards: 'Rec Yds',
    receptions: 'Rec', tds: 'TDs', passing_tds: 'Pass TDs',
    points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
    goals: 'Goals', shots: 'SOG', saves: 'Saves',
    hits: 'Hits', total_bases: 'Bases', rbis: 'RBI', home_runs: 'HR',
    strikeouts: 'K',
  }
  return labels[stat] ?? stat
}

/** Latest final live point's per-player actuals ({} until the game is final). */
export function finalActuals(game: any): Record<string, any> {
  const live = Array.isArray(game?.live) ? game.live : []
  const finals = live.filter((p: any) => p?.final === true || p?.state === 'post')
  if (!finals.length) return {}
  const rows = finals[finals.length - 1]?.rows
  return rows && typeof rows === 'object' ? rows : {}
}

/** (player|stat) -> closing line from frozen finalLines, else latest snapshot. */
export function closingLineMap(game: any): Map<string, number> {
  const map = new Map<string, number>()
  const final = game?.finalLines ?? (Array.isArray(game?.lines) && game.lines.length ? game.lines[game.lines.length - 1] : null)
  const fromSnapshot = (snap: any) => {
    for (const r of snap?.lines ?? []) {
      if (r?.player && r?.stat && typeof r?.line === 'number' && r.line > 0) {
        map.set(`${r.player}|${r.stat}`, r.line)
      }
    }
  }
  if (final) fromSnapshot(final)
  if (map.size === 0) {
    // Oldest games: lines live only on the pre rows.
    for (const r of game?.pre?.rows ?? []) {
      if (r?.player && r?.stat && typeof r?.line === 'number' && r.line > 0) {
        map.set(`${r.player}|${r.stat}`, r.line)
      }
    }
  }
  return map
}

/** Grade one game's pre snapshot vs final actuals at the closing lines. */
export function gradeGame(game: any): GradeResult | null {
  const preRows = Array.isArray(game?.pre?.rows) ? game.pre.rows : []
  if (!preRows.length) return null
  const actuals = finalActuals(game)
  if (!Object.keys(actuals).length) return null
  const closing = closingLineMap(game)
  let errSum = 0
  let n = 0
  let hits = 0
  let pushes = 0
  let scored = 0
  for (const r of preRows) {
    if (typeof r?.projection !== 'number' || !r?.player || !r?.stat) continue
    const actual = actuals?.[r.player]?.[r.stat]
    if (typeof actual !== 'number') continue
    n++
    errSum += Math.abs(actual - r.projection)
    const line = closing.get(`${r.player}|${r.stat}`) ?? (typeof r?.line === 'number' && r.line > 0 ? r.line : null)
    const pick = r?.pick === 'over' || r?.pick === 'under'
      ? r.pick
      : typeof line === 'number' ? (r.projection >= line ? 'over' : 'under') : null
    if (pick == null || typeof line !== 'number') continue
    if (actual === line) { pushes++; continue }
    scored++
    if ((pick === 'over') === (actual > line)) hits++
  }
  if (!n) return null
  return { n, mae: errSum / n, picks: scored + pushes, hits, pushes, hitRate: scored ? hits / scored : null }
}

export interface Scorecard {
  picks: number
  hits: number
  pushes: number
  graded: number
}

/**
 * Mid-game scorecard: pre rows vs current actuals at closing lines (or each
 * row's own line). Unlike gradeGame this scores in-progress games — the
 * panel's live "Picks x/y" strip. Picks reuse each row's locked pre-game pick
 * when present, else projection vs line.
 */
export function scorePicks(
  preRows: any[],
  actuals: Record<string, Record<string, number | null> | null | undefined>,
  closing?: Map<string, number> | null,
): Scorecard | null {
  let picks = 0
  let hits = 0
  let pushes = 0
  let graded = 0
  for (const r of preRows ?? []) {
    if (typeof r?.projection !== 'number' || !r?.player || !r?.stat) continue
    const actual = actuals?.[r.player]?.[r.stat]
    if (typeof actual !== 'number') continue
    graded++
    const line = closing?.get(`${r.player}|${r.stat}`)
      ?? (typeof r?.line === 'number' && r.line > 0 ? r.line : null)
    const pick = r?.pick === 'over' || r?.pick === 'under'
      ? r.pick
      : typeof line === 'number' ? (r.projection >= line ? 'over' : 'under') : null
    if (pick == null || typeof line !== 'number') continue
    if (actual === line) { pushes++; continue }
    picks++
    if ((pick === 'over') === (actual > line)) hits++
  }
  if (!graded) return null
  return { picks, hits, pushes, graded }
}
