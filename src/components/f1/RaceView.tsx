'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { F1CarState, F1Driver, F1LiveSnapshot } from '@/lib/f1'
import { F1TrackCanvas } from './F1TrackCanvas'
import { F1Tower } from './F1Tower'
import { ErrorState } from '@/components/feedback'

interface SessionInfo {
  key: number
  name: string
  type: string
  location: string
  country: string | null
  circuit: string | null
  dateStart: string
  dateEnd: string
  state: 'upcoming' | 'live' | 'final'
}

/**
 * Full race-weekend view: session header with state badge, live circuit map
 * with every car plotted, position tower, and race-control messages.
 * Polls /api/f1/live fast while the session is live, slow otherwise.
 */
export function RaceView({ sessionKey, teamColor = '#E10600' }: { sessionKey?: string; teamColor?: string }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [drivers, setDrivers] = useState<F1Driver[]>([])
  const [live, setLive] = useState<F1LiveSnapshot | null>(null)
  const [outline, setOutline] = useState<[number, number][] | null>(null)
  const [sessionError, setSessionError] = useState(false)
  const [sessionReload, setSessionReload] = useState(0)
  const [liveFailures, setLiveFailures] = useState(0)
  const [liveReload, setLiveReload] = useState(0)
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null)
  const keyRef = useRef<number | null>(null)

  // Session metadata + drivers (slow-moving).
  useEffect(() => {
    let cancelled = false
    setSessionError(false)
    fetch(`/api/f1/session${sessionKey ? `?session_key=${encodeURIComponent(sessionKey)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Session ${r.status}`))))
      .then((j) => {
        if (cancelled) return
        setSession(j.session)
        setDrivers(j.drivers ?? [])
        keyRef.current = j.session?.key ?? null
        setSessionError(false)
      })
      .catch(() => { if (!cancelled) setSessionError(true) })
    return () => { cancelled = true }
  }, [sessionKey, sessionReload])

  const loadLive = useCallback(async (signal: AbortSignal) => {
    const sk = keyRef.current ?? sessionKey
    const res = await fetch(`/api/f1/live${sk ? `?session_key=${encodeURIComponent(String(sk))}` : ''}`, { signal })
    if (!res.ok) throw new Error(`Live timing ${res.status}`)
    return res.json() as Promise<F1LiveSnapshot>
  }, [sessionKey])

  // Live snapshot poll: 5s while live (server cache window), 60s otherwise.
  useEffect(() => {
    if (!session && !sessionKey) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const j = await loadLive(AbortSignal.timeout(20000))
        if (!cancelled) {
          setLive(j)
          setLiveFailures(0)
          setLastLiveAt(Date.now())
          if (j.sessionKey && !keyRef.current) keyRef.current = j.sessionKey
        }
      } catch {
        /* keep last frame; retry on cadence */
        if (!cancelled) setLiveFailures((n) => n + 1)
      }
      if (!cancelled) {
        timer = setTimeout(tick, live?.state === 'live' ? 5_000 : 60_000)
      }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [session, sessionKey, loadLive, live?.state, liveReload])

  // Circuit outline (cached server-side for hours; needs cars on track).
  useEffect(() => {
    const sk = keyRef.current ?? sessionKey
    if (!sk && !live) return
    let cancelled = false
    fetch(`/api/f1/track${sk ? `?session_key=${encodeURIComponent(String(sk))}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.outline) setOutline(j.outline) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.key, live?.state])

  const cars: F1CarState[] = live?.cars ?? []
  const state = live?.state ?? session?.state ?? 'upcoming'
  const isLive = state === 'live'

  if (sessionError && !live) {
    return (
      <div className="space-y-6">
        <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">&larr; All of F1</Link>
        <ErrorState
          message="Couldn't load this session — timing may not be published yet."
          onRetry={() => setSessionReload((k) => k + 1)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">&larr; All of F1</Link>

      {/* Session header */}
      <div className="fs-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>
            {session?.location ?? 'Formula 1'}{session?.circuit ? ` · ${session.circuit}` : ''}
          </p>
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded ${
              isLive ? 'text-white bg-fs-red animate-pulse' : state === 'final' ? 'text-fs-muted bg-white/10' : 'text-fs-gold bg-fs-gold/15'
            }`}
          >
            {isLive ? '● LIVE' : state === 'final' ? 'FINAL' : 'UPCOMING'}
          </span>
          {session?.name && state !== 'upcoming' ? <span className="fs-meta">{session.name}</span> : null}
        </div>
        <h1 className="fs-title text-3xl sm:text-4xl mt-2">Race Center</h1>
        {session ? <p className="text-lg text-fs-text mt-1">{session.location} {session.name}</p> : null}
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-fs-muted">
          {live && live.lap > 0 ? <span>Lap {live.lap}</span> : null}
          {live?.airTemp != null ? <span>{live.airTemp.toFixed(1)}°C air</span> : null}
          {live?.trackTemp != null ? <span>{live.trackTemp.toFixed(1)}°C track</span> : null}
          {live?.trackStatus ? <span title="Current track status">{live.trackStatus}</span> : null}
        </div>
      </div>

      {liveFailures >= 3 ? (
        <div role="status" className="fs-panel p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fs-gold">
          <span>
            Live timing interrupted — showing the last update
            {lastLiveAt ? ` from ~${Math.max(1, Math.round((Date.now() - lastLiveAt) / 60_000))}m ago` : ''}.
          </span>
          <button
            type="button"
            className="fs-btn"
            onClick={() => { setLiveFailures(0); setLiveReload((k) => k + 1) }}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5 items-start">
        {/* Live track */}
        <section aria-label="Live track map" className="fs-panel p-4 sm:p-5 lg:col-span-3">
          <h2 className="fs-title text-xl mb-1">Track Map</h2>
          <p className="text-xs text-fs-muted-2 mb-3">
            Every car plotted live from timing-loop coordinates
            {isLive ? ' — updates every few seconds.' : '.'}
          </p>
          <F1TrackCanvas outline={outline} cars={cars} drivers={drivers} />
        </section>

        {/* Tower */}
        <section aria-label="Positions" className="fs-panel overflow-hidden lg:col-span-2">
          <h2 className="fs-title text-xl px-3 pt-4 pb-1">{state === 'final' ? 'Classification' : 'Positions'}</h2>
          <F1Tower cars={cars} drivers={drivers} gameFinal={state === 'final'} />
        </section>
      </div>

      {/* Race control */}
      {live && live.messages.length > 0 ? (
        <section aria-label="Race control messages" className="fs-panel p-4 sm:p-5">
          <h2 className="fs-title text-xl mb-3">Race Control</h2>
          <ul className="space-y-1.5 text-sm">
            {live.messages.slice().reverse().map((m, i) => (
              <li key={`${m.date}-${i}`} className="flex gap-2.5">
                <span className="fs-mono text-xs text-fs-muted-2 shrink-0 tabular-nums">
                  {m.date ? new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                </span>
                <span className="text-fs-text/90">{m.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-fs-muted-2">
        Timing data: OpenF1 · Calendar & standings: Jolpica F1.{' '}
        <Link href="/f1" className="underline underline-offset-2 hover:text-fs-text">All races →</Link>
      </p>
    </div>
  )
}
