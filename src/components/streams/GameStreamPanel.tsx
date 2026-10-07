'use client'

import { useEffect, useState } from 'react'
import { matchGame, type StreamMatch, type WatchSport } from '@/lib/streams'
import { StreamPlayer } from './StreamPlayer'

/**
 * Stream section for a game hub: finds this game's Streamed listing by
 * matching BOTH team names, then hands the match to the shared player.
 * An optional preselect (from a /watch deep link) jumps a source to the
 * front of the resolution order. No listing → quiet empty state, never an
 * error wall — streams are a bonus, not the page.
 */
export function GameStreamPanel({
  sport,
  awayName,
  homeName,
  preselect,
  autoplay,
}: {
  sport: WatchSport
  awayName: string
  homeName: string
  preselect?: { source: string; id: string } | null
  autoplay?: boolean
}) {
  const [matches, setMatches] = useState<StreamMatch[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [choice, setChoice] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setMatches(null)
      setFailed(false)
      setChoice(0)
      try {
        const res = await fetch(`/api/streams/matches?sport=${sport}&scope=all`, {
          signal: AbortSignal.timeout(25000),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || 'listings failed')
        const hits = (body.matches ?? []).filter((m: StreamMatch) =>
          matchGame(m, awayName, homeName),
        )
        if (!cancelled) setMatches(hits)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    if (awayName && homeName) void load()
    return () => {
      cancelled = true
    }
  }, [sport, awayName, homeName])

  if (!awayName || !homeName) return null
  if (matches === null && !failed) {
    return <div className="fs-skeleton h-32" aria-hidden="true" />
  }
  if (failed || (matches ?? []).length === 0) {
    return (
      <div className="fs-panel p-5 text-center">
        <p className="fs-title text-lg">No stream listed</p>
        <p className="text-sm text-fs-muted mt-1">
          Nothing matched {awayName} vs {homeName} in the listings right now — check back closer to game time.
        </p>
      </div>
    )
  }

  const list = matches ?? []
  const current = list[Math.min(choice, list.length - 1)]
  return (
    <div className="space-y-3">
      {list.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a listing">
          {list.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setChoice(i)}
              className={`fs-chip ${i === Math.min(choice, list.length - 1) ? 'fs-chip-active' : ''}`}
            >
              {m.title}
            </button>
          ))}
        </div>
      )}
      <div className="fs-panel p-4 sm:p-5">
        <p className="fs-meta mb-3">
          {current.title} · via Streamed (third-party — expect ads or popups)
        </p>
        <StreamPlayer key={current.id} match={current} preselect={preselect} autoplay={autoplay} />
      </div>
    </div>
  )
}
