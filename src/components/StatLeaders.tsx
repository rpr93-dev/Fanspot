'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { playerPageHref, type SportKey, type StatLeader } from '@/lib/models'
import { EmptyState, ErrorState } from './feedback'

interface LeaderBoard {
  key: string
  label: string
  leaders: StatLeader[]
}

/** League stat leaders. Every entry links to its player page. */
export function StatLeaders({ sport }: { sport: SportKey }) {
  const [boards, setBoards] = useState<LeaderBoard[] | null>(null)
  const [seasonNote, setSeasonNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
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
        <section key={board.key} className="fs-panel p-4" aria-label={`${board.label} leaders`}>
          <h3 className="fs-title text-base mb-3">{board.label}</h3>
          <ol className="space-y-1">
            {board.leaders.map((l) => (
              <li key={`${l.playerId}-${l.rank}`}>
                {l.playerId ? (
                  <Link
                    href={playerPageHref(sport, l.playerId)}
                    className="flex items-center gap-3 p-1.5 -mx-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="fs-mono text-xs text-fs-muted-2 w-4 shrink-0 tabular-nums">{l.rank}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{l.playerName}</span>
                      {l.teamAbbr && <span className="block fs-meta mt-0.5">{l.teamAbbr}</span>}
                    </span>
                    <span className="fs-mono text-sm font-bold tabular-nums shrink-0">{l.value}</span>
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 p-1.5">
                    <span className="fs-mono text-xs text-fs-muted-2 w-4 shrink-0 tabular-nums">{l.rank}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{l.playerName}</span>
                    </span>
                    <span className="fs-mono text-sm font-bold tabular-nums shrink-0">{l.value}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      </div>
    </div>
  )
}
