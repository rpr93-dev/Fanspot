'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Race {
  round: number
  name: string
  locality: string | null
  country: string | null
}

interface Session {
  key: number
  name: string
  type: string | null
  dateStart: string
  state: string
}

/** "in 2d 4h" / "in 3h 12m" / "in 47m 12s" — mirrors the hub's countdown. */
function countdown(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  const secs = Math.floor((ms % 60_000) / 1000)
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${mins}m`
  if (mins > 0) return `in ${mins}m ${secs}s`
  return `in ${secs}s`
}

function chipFor(type: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('race') && !t.includes('sprint')) return 'RACE'
  if (t.includes('sprint')) return 'SPRINT'
  if (t.includes('qualifying')) return 'QUALI'
  if (t.includes('practice')) return 'PRACTICE'
  return 'F1'
}

/**
 * Compact countdown to the next Formula 1 session (practice / sprint /
 * qualifying / race) for the upcoming race weekend. Fetches the calendar to
 * find the next round, then that round's weekend for per-session times.
 * Renders nothing when there is no upcoming weekend or no session left.
 */
export function F1SessionCountdown({ className }: { className?: string }) {
  const [race, setRace] = useState<Race | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    fetch('/api/f1/schedule')
      .then((r) => (r.ok ? r.json() : null))
      .then((sched) => {
        if (cancelled || !sched?.next) return
        setRace(sched.next)
        return fetch(`/api/f1/weekend?round=${encodeURIComponent(String(sched.next.round))}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((w) => { if (!cancelled && w) setSessions(w.sessions ?? []) })
      })
      .catch(() => {})
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!race || !sessions) return null

  const live = sessions.find((s) => s.state === 'live') ?? null
  const nextSession = live ?? sessions.find((s) => Date.parse(s.dateStart) > now) ?? null
  if (!nextSession) return null

  const ms = Date.parse(nextSession.dateStart) - now
  const when = live
    ? 'LIVE'
    : Number.isFinite(ms) && ms > 0
      ? countdown(ms)
      : 'Soon'

  return (
    <Link
      href={`/f1/round/${race.round}`}
      className={`fs-panel flex items-center gap-3 p-3 transition hover:brightness-125 ${className ?? ''}`}
      prefetch={false}
      aria-label={`Next F1 session: ${nextSession.name} at the ${race.name}`}
    >
      <span
        aria-hidden="true"
        className="shrink-0 grid place-items-center rounded-lg px-2 py-1 text-[10px] font-black tracking-wider text-white"
        style={{ backgroundColor: '#E10600' }}
      >
        {chipFor(nextSession.type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">
          {nextSession.name} · {race.name}
        </span>
        <span className="fs-meta block truncate">
          {race.locality ?? race.country ?? ''}
          {race.locality && race.country ? `, ${race.country}` : ''}
        </span>
      </span>
      <span
        className={`fs-mono text-xs font-bold tabular-nums shrink-0 ${live ? 'text-fs-red' : 'text-fs-gold'}`}
        title={new Date(nextSession.dateStart).toString()}
      >
        {live ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          when
        )}
      </span>
    </Link>
  )
}
