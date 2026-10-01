'use client'

import {
  computeOverUnderEdge,
  EDGE_STYLES,
  formatPrice,
  normalizePlayerName,
  pickConfidencePct,
} from '@/lib/propEdge'
import { PropTableLegend } from '@/components/PropTableLegend'
import type { Scorecard } from '@/lib/propGrades'

/**
 * Per-player projected lines vs sportsbook lines for NBA / NHL / MLB — the
 * same table layout and edge badges as the NFL prop-model table, fed by the
 * keyless season-average projections from /api/props (plus The Odds API book
 * lines when ODDS_API_KEY is configured).
 */

export interface ProjectionLine {
  stat?: string
  label: string
  value: number
  sd?: number
}

export interface ProjectionRow {
  name: string
  position: string
  team: string
  status?: string | null
  note?: string | null
  lines: ProjectionLine[]
}

export interface BookPlayer {
  name: string
  team?: string | null
  props: { stat?: string | null; label: string; line: number; over: number | null; under: number | null }[]
}

export function PlayerProjections({
  projections,
  bookPlayers,
  bookmaker,
  teams,
  teamColor,
  loading,
  matchup,
  liveStats,
  gameFinal,
  scorecard,
  closingAt,
  closingFrozen,
}: {
  projections: ProjectionRow[] | null
  bookPlayers: BookPlayer[] | null
  bookmaker?: string | null
  /** Teams to show, in display order: [{ abbr, name }]. */
  teams: { abbr: string; name: string }[]
  teamColor: string
  loading: boolean
  matchup?: { ourMultiplier: number; oppMultiplier: number } | null
  /** Live/final actuals: player -> stat -> value (null = DNP/untracked). */
  liveStats?: Record<string, Record<string, number | null>> | null
  gameFinal?: boolean
  scorecard?: Scorecard | null
  /** When the closing lines were frozen (display string), if known. */
  closingAt?: string | null
  closingFrozen?: boolean
}) {
  const books = new Map<string, BookPlayer>()
  for (const p of bookPlayers ?? []) books.set(normalizePlayerName(p.name), p)
  const bookLineFor = (name: string, stat: string | undefined) => {
    if (!stat) return null
    return books.get(normalizePlayerName(name))?.props.find((x) => x.stat === stat) ?? null
  }
  const hasBookLines = (bookPlayers?.length ?? 0) > 0
  const showLive = liveStats != null

  const groups = teams
    .map((t) => ({ ...t, rows: (projections ?? []).filter((p) => p.team === t.abbr) }))
    .filter((g) => g.rows.length > 0)

  return (
    <div className="mt-4">
      <p className="fs-eyebrow mb-2" style={{ '--tint': teamColor } as React.CSSProperties}>Player Projections</p>
      <PropTableLegend teamColor={teamColor} />
      <p className="text-xs text-fs-muted-2 mb-2">
        Season per-game averages from ESPN
        {matchup ? ', scaled by the Vegas implied team total' : ''}. Injured-out players are skipped.
        {hasBookLines
          ? ` Book lines: ${bookmaker ?? 'sportsbook'}. Edge uses a simple normal approximation.`
          : ' Book lines appear here when an Odds API key is configured.'}
      </p>

      {scorecard ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: `${teamColor}0c`, border: `1px solid ${teamColor}1c` }}>
          <span className="text-fs-text font-semibold" title="Frozen pre-game picks beating the closing line">
            Picks {scorecard.hits}/{scorecard.picks}
            {scorecard.picks > 0 ? ` (${Math.round((scorecard.hits / scorecard.picks) * 100)}%)` : ''}
          </span>
          {scorecard.pushes > 0 ? <span className="text-fs-muted">{scorecard.pushes} push{scorecard.pushes === 1 ? '' : 'es'}</span> : null}
          <span className="text-fs-muted">{scorecard.graded} projections graded</span>
          {closingAt ? (
            <span className="text-fs-muted-2" title="Picks are graded against the frozen closing lines — the most recent book-line snapshot before the game ended.">
              · closing lines {closingAt}{closingFrozen ? ' (frozen)' : ''}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
          <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-fs-muted-2">No player projections available for this game yet.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.abbr} className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${teamColor}16` }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fs-muted-2" style={{ backgroundColor: `${teamColor}08` }}>
                    <th scope="col" className="text-left px-2.5 py-1.5 font-medium">{g.name}</th>
                    <th scope="col" className="text-left px-2 py-1.5 font-medium">Stat</th>
                    <th scope="col" className="text-right px-2 py-1.5 font-medium" title="What the model expects per game — the middle of a range, not an exact prediction">Proj</th>
                    <th scope="col" className="text-right px-2 py-1.5 font-medium" title="DraftKings' number. Over wins above it, under wins below it.">Line</th>
                    <th scope="col" className="text-right px-2 py-1.5 font-medium" title="Which side the model leans and how strongly">Pick</th>
                    {showLive ? (
                      <th scope="col" className="text-right px-2.5 py-1.5 font-medium" title={gameFinal ? 'What the player finished with' : 'What the player has right now'}>{gameFinal ? 'Final' : 'Live'}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((p) =>
                    p.lines.map((l, idx) => {
                      const book = bookLineFor(p.name, l.stat)
                      const edge = book ? computeOverUnderEdge(l.value, l.sd ?? null, book.line) : null
                      const actual = showLive && l.stat ? liveStats?.[p.name]?.[l.stat] ?? null : null
                      return (
                        <tr
                          key={`${p.name}-${l.label}`}
                          className="text-fs-text/75"
                          style={{ borderTop: `1px solid ${teamColor}${idx === 0 ? '16' : '0c'}` }}
                        >
                          {idx === 0 ? (
                            <td rowSpan={p.lines.length} className="px-2.5 py-2 align-top whitespace-nowrap border-r" style={{ borderColor: `${teamColor}10`, backgroundColor: `${teamColor}06` }}>
                              <span className="font-medium text-fs-text/90">{p.name}</span>
                              <span className="block text-[10px] text-fs-muted-2">{p.position}</span>
                              {p.status ? (
                                <span className="mt-0.5 inline-block px-1.5 py-px rounded text-[10px] text-fs-gold bg-fs-gold/15">{p.status.toUpperCase()}</span>
                              ) : null}
                              {p.note ? <span className="block text-[10px] text-fs-muted-2 mt-0.5">{p.note}</span> : null}
                            </td>
                          ) : null}
                          <td className="px-2 py-1.5 text-fs-muted">{l.label}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-text">{l.value}</td>
                          <td
                            className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-muted"
                            title={book ? `over ${formatPrice(book.over)} / under ${formatPrice(book.under)}` : undefined}
                          >
                            {book ? book.line : '—'}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                            {edge && edge.pick ? (
                              <span
                                className={`text-[11px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${edge.strong ? EDGE_STYLES[edge.pick].strongBg : EDGE_STYLES[edge.pick].bg} ${edge.strong ? EDGE_STYLES[edge.pick].strongFg : EDGE_STYLES[edge.pick].fg}`}
                                title={`The model leans ${edge.pick} — about a ${pickConfidencePct(edge)}% chance against line ${book!.line} (projection ${l.value})`}
                              >
                                {EDGE_STYLES[edge.pick].label} {pickConfidencePct(edge)}%
                              </span>
                            ) : (
                              <span className="text-fs-muted-2" title={book ? 'No line to compare against' : 'No book line yet'}>—</span>
                            )}
                          </td>
                          {showLive ? (
                            <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-fs-text" title={actual == null ? 'Hasn\u2019t played, DNP, or stat untracked live' : undefined}>
                              {actual ?? '—'}
                            </td>
                          ) : null}
                        </tr>
                      )
                    }),
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
