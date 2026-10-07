'use client'

import { useEffect, useMemo, useState } from 'react'
import { isF1Session, matchF1Weekend, f1SessionScore, type StreamMatch } from '@/lib/streams'
import { StreamPlayer } from './StreamPlayer'

/**
 * Stream panel for a Formula 1 race weekend — the F1 counterpart of the game
 * hub's GameStreamPanel. Streamed's motor-sports category mixes the whole
 * calendar (plus NASCAR/WRC/MotoGP), so listings are narrowed to this Grand
 * Prix (by GP name / circuit / locality) and ordered with the active session's
 * stream (race, qualifying, practice N, sprint) first. The user can pick any
 * weekend session from the listing chips. No listing → a quiet empty state.
 */
export function F1StreamPanel({
  weekTokens,
  activeSession,
  heading = 'Race stream',
}: {
  /** Significant weekend tokens from the GP name + circuit + locality. */
  weekTokens: string[]
  /** Active session display name (e.g. "Qualifying", "Race"). */
  activeSession?: string | null
  heading?: string
}) {
  const [matches, setMatches] = useState<StreamMatch[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [choice, setChoice] = useState(0)
  const tokensKey = weekTokens.join(',')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setMatches(null)
      setFailed(false)
      setChoice(0)
      try {
        const res = await fetch('/api/streams/matches?sport=f1&scope=all', {
          signal: AbortSignal.timeout(25000),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || 'listings failed')
        const hits = (body.matches ?? []).filter(
          (m: StreamMatch) => isF1Session(m.title) && matchF1Weekend(m.title, weekTokens),
        )
        if (!cancelled) setMatches(hits)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokensKey])

  const ordered = useMemo(() => {
    const list = [...(matches ?? [])]
    list.sort(
      (a, b) =>
        f1SessionScore(b.title, activeSession ?? '') - f1SessionScore(a.title, activeSession ?? '') ||
        Number(b.popular) - Number(a.popular) ||
        a.date - b.date,
    )
    return list
  }, [matches, activeSession])

  if (matches === null && !failed) {
    return <div className="fs-skeleton h-32" aria-hidden="true" />
  }
  if (failed || ordered.length === 0) {
    return (
      <div className="fs-panel p-5 text-center">
        <p className="fs-title text-lg">No stream listed</p>
        <p className="text-sm text-fs-muted mt-1">
          Nothing for this Grand Prix in the Streamed listings right now — check back closer to the
          session.
        </p>
      </div>
    )
  }

  const current = ordered[Math.min(choice, ordered.length - 1)]
  return (
    <div className="space-y-3">
      <p className="fs-eyebrow" style={{ '--tint': '#E10600' } as React.CSSProperties}>
        {heading}
      </p>
      {ordered.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a session stream">
          {ordered.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setChoice(i)}
              className={`fs-chip ${i === Math.min(choice, ordered.length - 1) ? 'fs-chip-active' : ''}`}
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
        <StreamPlayer key={current.id} match={current} />
      </div>
    </div>
  )
}
