'use client'

import { useState } from 'react'

/**
 * Plain-English guide for the per-player prop tables (all sports, NFL model
 * table included). One line of orientation up front; the full glossary hides
 * behind a toggle so regulars never see it twice.
 */
export function PropTableLegend({
  teamColor,
  extra,
}: {
  teamColor: string
  /** Extra rows for table-specific columns (e.g. distribution, reliability). */
  extra?: { term: string; meaning: string }[]
}) {
  const [open, setOpen] = useState(false)
  const rows = [
    {
      term: 'Proj',
      meaning:
        'What the model expects per game — season average adjusted for the matchup. Read it as the middle of a range, not an exact prediction.',
    },
    {
      term: 'Line',
      meaning:
        "DraftKings' number, refreshed hourly before the game. An over bet wins if the player finishes above it, under if below.",
    },
    {
      term: 'Pick %',
      meaning:
        'Which side the model leans and how strongly. OVER 62% means the model gives the over about a 62% chance — a coin flip reads ~50%.',
    },
    {
      term: 'Conf',
      meaning:
        'How much to trust the projection: sample size, matchup data quality, and lineup certainty. High beats medium beats low.',
    },
    {
      term: 'Live / Final',
      meaning:
        "What the player has right now (live) or finished with (final). Dashes mean they haven't played or the stat isn't tracked live.",
    },
    {
      term: 'Picks 3/5',
      meaning:
        'Frozen pre-game picks beating the frozen closing line — the model is graded on the last lines before the game, never moved afterward.',
    },
    ...(extra ?? []),
  ]
  return (
    <div className="mb-2">
      <p className="text-xs text-fs-muted-2">
        Model guess vs the book&apos;s number, graded live.{' '}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="underline underline-offset-2 hover:text-fs-text"
          aria-expanded={open}
        >
          {open ? 'Hide guide' : 'What do these mean?'}
        </button>
      </p>
      {open ? (
        <dl className="mt-2 rounded-lg px-3 py-2 text-xs space-y-1.5" style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}16` }}>
          {rows.map((r) => (
            <div key={r.term} className="flex gap-2">
              <dt className="font-bold text-fs-text shrink-0 w-16">{r.term}</dt>
              <dd className="text-fs-muted">{r.meaning}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
