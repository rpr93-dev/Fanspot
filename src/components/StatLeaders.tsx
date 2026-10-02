'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { playerPageHref, type SportKey, type StatLeader } from '@/lib/models'
import { sportTheme } from '@/lib/sportTheme'
import { EmptyState, ErrorState } from './feedback'

interface LeaderBoard {
  key: string
  label: string
  leaders: StatLeader[]
}

const MEDALS = ['#e8b94c', '#c0c8cc', '#cd7f32']

function RankBadge({ rank }: { rank: number }) {
  const medal = MEDALS[rank - 1]
  if (medal) {
    return (
      <span
        className="fs-mono text-xs font-bold w-5 h-5 shrink-0 grid place-items-center rounded-full tabular-nums"
        style={{ backgroundColor: `${medal}22`, color: medal, border: `1px solid ${medal}55` }}
        title={`Rank ${rank}`}
      >
        {rank}
      </span>
    )
  }
  return (
    <span className="fs-mono text-xs text-fs-muted-2 w-5 h-5 shrink-0 grid place-items-center tabular-nums">
      {rank}
    </span>
  )
}

/** League stat leaders. Every entry links to its player page. */
export function StatLeaders({ sport }: { sport: SportKey }) {
  const [boards, setBoards] = useState<LeaderBoard[] | null>(null)
  const [seasonNote, setSeasonNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const theme = sportTheme(sport)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/stat-leaders?sport=${sport}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Leaders returned ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (cancelled) return
        setBoards(json.categories ?? [])
        if (json.isPreviousSeason && typeof json.season === 'number') {
          setSeasonNote(`${json.season}–${String(json.season + 1).slice(2)} final leaders`)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load leaders')
      })
    return () => {
      cancelled = true
    }
  }, [sport])

  if (error) return <ErrorState message={`Couldn't load stat leaders: ${error}`} />
  if (!boards) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fs-skeleton h-48" />
        ))}
      </div>
    )
  }
  if (boards.length === 0) return <EmptyState title="Stat leaders unavailable right now." />

  return (
    <div>
      {seasonNote && <p className="fs-meta mb-3">{seasonNote} — new season not started</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {boards.map((board) => (
          <section
            key={board.key}
            className="fs-panel overflow-hidden"
            aria-label={`${board.label} leaders`}
          >
            <div
              className="flex items-center justify-between px-4 py-3 border-b border-fs-line"
              style={{ background: `linear-gradient(90deg, ${theme.accent}18, transparent)` }}
            >
              <h3 className="fs-title text-base">{board.label}</h3>
              <span className="fs-meta">Top {board.leaders.length}</span>
            </div>
            <ol className="p-2">
              {board.leaders.map((l) => {
                const row = (
                  <>
                    <RankBadge rank={l.rank} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{l.playerName}</span>
                      {l.teamAbbr && (
                        <span className="block fs-meta mt-0.5">{l.teamAbbr}</span>
                      )}
                    </span>
                    <span
                      className="fs-mono text-base font-bold tabular-nums shrink-0"
                      style={l.rank === 1 ? { color: theme.accent } : undefined}
                    >
                      {l.value}
                    </span>
                  </>
                )
                const classes =
                  'flex items-center gap-3 p-2 rounded-lg transition-colors hover:bg-white/5'
                return (
                  <li key={`${l.playerId}-${l.rank}`}>
                    {l.playerId ? (
                      <Link href={playerPageHref(sport, l.playerId)} className={classes}>
                        {row}
                      </Link>
                    ) : (
                      <div className={classes}>{row}</div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
