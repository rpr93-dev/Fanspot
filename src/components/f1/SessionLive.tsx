'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { F1CarState, F1Driver, F1LiveSnapshot } from '@/lib/f1'
import { F1TrackCanvas } from './F1TrackCanvas'
import { F1Tower } from './F1Tower'

/**
 * Live-session panel used by the F1 weekend hub: circuit map with every car
 * plotted, position tower, and race-control messages. Polls /api/f1/live
 * (5s while live) and /api/f1/track (cached server-side). Everything degrades
 * gracefully: with no coordinates/timing it shows a clear "unavailable" note
 * instead of an empty canvas, and a stale banner after repeated failures.
 */
export function SessionLive({ sessionKey }: { sessionKey?: string }) {
  const [drivers, setDrivers] = useState<F1Driver[]>([])
  const [live, setLive] = useState<F1LiveSnapshot | null>(null)
  const [outline, setOutline] = useState<[number, number][] | null>(null)
  const [failures, setFailures] = useState(0)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const keyRef = useRef<string | null>(null)

  // Drivers + session identity (bridge or OpenF1, whichever is available).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/f1/session${sessionKey ? `?session_key=${encodeURIComponent(sessionKey)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return
        setDrivers(j.drivers ?? [])
        keyRef.current = j.session?.key ? String(j.session.key) : null
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionKey, reload])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const sk = keyRef.current ?? sessionKey
      try {
        const res = await fetch(`/api/f1/live${sk ? `?session_key=${encodeURIComponent(sk)}` : ''}`, {
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) throw new Error(`live ${res.status}`)
        const j = (await res.json()) as F1LiveSnapshot
        if (!cancelled) {
          setLive(j)
          setFailures(0)
          setLastAt(Date.now())
        }
      } catch {
        if (!cancelled) setFailures((n) => n + 1)
      }
      if (!cancelled) timer = setTimeout(tick, live?.state === 'live' ? 5_000 : 30_000)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, reload, live?.state])

  useEffect(() => {
    let cancelled = false
    const want = sessionKey ? `?session_key=${encodeURIComponent(sessionKey)}` : ''
    fetch(`/api/f1/track${want}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.outline) setOutline(j.outline)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionKey])

  const cars: F1CarState[] = live?.cars ?? []
  const state = live?.state ?? 'upcoming'
  const hasMap = !!outline || cars.some((c) => c.x != null)
  const hasTiming = cars.length > 0

  return (
    <div className="space-y-4">
      {failures >= 3 ? (
        <div
          role="status"
          className="fs-panel p-3 flex flex-wrap items-center justify-between gap-3 text-sm text-fs-gold"
        >
          <span>
            Live timing interrupted — showing the last update
            {lastAt ? ` from ~${Math.max(1, Math.round((Date.now() - lastAt) / 60_000))}m ago` : ''}.
          </span>
          <button
            type="button"
            className="fs-btn"
            onClick={() => {
              setFailures(0)
              setReload((k) => k + 1)
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {live && (live.lap > 0 || live.airTemp != null || live.trackTemp != null || live.trackStatus) ? (
        <div className="fs-panel px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fs-muted">
          {live.lap > 0 ? (
            <span className="fs-mono tabular-nums">
              Lap {live.lap}
              {live.totalLaps ? `/${live.totalLaps}` : ''}
            </span>
          ) : null}
          {live.trackStatus ? (
            <span className="inline-flex items-center gap-2" title="Track status">
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full align-middle"
                style={{
                  backgroundColor: /yellow/i.test(live.trackStatus)
                    ? '#facc15'
                    : /red|sc|safety/i.test(live.trackStatus)
                      ? '#E10600'
                      : '#8bc53f',
                }}
              />
              {live.trackStatus}
            </span>
          ) : null}
          {live.airTemp != null ? <span className="tabular-nums">{live.airTemp.toFixed(1)}°C air</span> : null}
          {live.trackTemp != null ? <span className="tabular-nums">{live.trackTemp.toFixed(1)}°C track</span> : null}
        </div>
      ) : null}

      <div className="space-y-4">
        <section aria-label="Track map" className="fs-panel p-4">
          <h3 className="fs-title text-lg mb-1">Track Map</h3>
          <p className="text-xs text-fs-muted-2 mb-3">
            {state === 'live'
              ? 'Every car plotted live — updates every few seconds.'
              : 'Positions from the last timing frame.'}
          </p>
          {hasMap ? (
            <F1TrackCanvas outline={outline} cars={cars} drivers={drivers} />
          ) : (
            <div className="rounded-lg border border-fs-line bg-white/[0.02] px-4 py-10 text-center">
              <p className="text-sm text-fs-muted">
                {hasTiming
                  ? 'Circuit map unavailable for this session.'
                  : 'Live positions unavailable right now.'}
              </p>
              <p className="fs-meta mt-1">Timing feed reconnects automatically.</p>
            </div>
          )}
        </section>

        <section aria-label="Positions" className="fs-panel overflow-hidden">
          <h3 className="fs-title text-lg px-3 pt-4 pb-1">
            {state === 'final' ? 'Classification' : 'Positions'}
          </h3>
          {hasTiming || state === 'final' ? (
            <F1Tower cars={cars} drivers={drivers} gameFinal={state === 'final'} />
          ) : (
            <p className="px-3 py-6 text-sm text-fs-muted-2">Timing not available yet.</p>
          )}
        </section>
      </div>

      {live && live.messages.length > 0 ? (
        <section aria-label="Race control messages" className="fs-panel p-4">
          <h3 className="fs-title text-lg mb-2">Race Control</h3>
          <ul className="space-y-1.5 text-sm">
            {live.messages.slice().reverse().map((m, i) => (
              <li key={`${m.date}-${i}`} className="flex gap-2.5">
                <span className="fs-mono text-xs text-fs-muted-2 shrink-0 tabular-nums">
                  {m.date
                    ? new Date(m.date).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : ''}
                </span>
                <span className="text-fs-text/90">{m.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
