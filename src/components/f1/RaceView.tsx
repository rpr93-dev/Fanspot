'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SessionLive } from './SessionLive'
import { F1StreamPanel } from '@/components/streams/F1StreamPanel'
import { f1WeekTokens } from '@/lib/streams'
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/**
 * Single-session hub (`/f1/race/[sessionKey]`) — same two-column shape as the
 * weekend hub: this Grand Prix's stream on the left, and the session's live
 * track map, position tower and race control on the right (SessionLive owns
 * the polling and degrades gracefully when timing is unavailable).
 */
export function RaceView({ sessionKey, teamColor = '#E10600' }: { sessionKey?: string; teamColor?: string }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [sessionError, setSessionError] = useState(false)
  const [sessionReload, setSessionReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setSessionError(false)
    fetch(`/api/f1/session${sessionKey ? `?session_key=${encodeURIComponent(sessionKey)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Session ${r.status}`))))
      .then((j) => {
        if (cancelled) return
        setSession(j.session)
        setSessionError(false)
      })
      .catch(() => {
        if (!cancelled) setSessionError(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionKey, sessionReload])

  if (sessionError && !session) {
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

  const state = session?.state ?? 'upcoming'
  const isLive = state === 'live'
  const weekTokens = f1WeekTokens([session?.location, session?.circuit, session?.name])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">&larr; All of F1</Link>
        {session?.name ? <span className="fs-meta">{session.name}</span> : null}
      </div>

      {/* Session hero */}
      <div className="fs-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>
            {session?.location ?? 'Formula 1'}
            {session?.circuit ? ` · ${session.circuit}` : ''}
          </p>
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded ${
              isLive
                ? 'text-white bg-fs-red animate-pulse'
                : state === 'final'
                  ? 'text-fs-muted bg-white/10'
                  : 'text-fs-gold bg-fs-gold/15'
            }`}
          >
            {isLive ? '● LIVE' : state === 'final' ? 'FINAL' : 'UPCOMING'}
          </span>
        </div>
        <h1 className="fs-title text-3xl sm:text-4xl mt-2">Race Center</h1>
        {session ? (
          <p className="text-lg text-fs-text mt-1">
            {session.location} {session.name}
          </p>
        ) : (
          <p className="text-sm text-fs-muted mt-1">Loading session…</p>
        )}
        {session ? (
          <p className="fs-mono text-xs text-fs-muted mt-1 tabular-nums">{fmtDate(session.dateStart)}</p>
        ) : null}
      </div>

      {/* Two-column hub: stream | live session data */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start">
        <div className="min-w-0 lg:sticky lg:top-20">
          <F1StreamPanel weekTokens={weekTokens} activeSession={session?.name} />
        </div>

        <div className="min-w-0">
          <SessionLive sessionKey={sessionKey ?? (session?.key != null ? String(session.key) : undefined)} />
        </div>
      </div>

      <p className="text-xs text-fs-muted-2">
        Timing data: OpenF1 · Calendar &amp; standings: Jolpica F1.{' '}
        <Link href="/f1" className="underline underline-offset-2 hover:text-fs-text">All races →</Link>
      </p>
    </div>
  )
}
