'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { teams } from '@/data/teams'

interface Round {
  round: number
  name: string
  circuit: string | null
  locality: string | null
  country: string | null
  date: string
  time: string | null
  startIso: string
}

/**
 * F1 league hub: next race with countdown, live-session entry, full
 * calendar, and both championships. All data from /api/f1/* (Jolpica +
 * OpenF1) — nothing here touches ESPN team-vs-team shapes.
 */
export function F1Hub({ teamColor = '#E10600' }: { teamColor?: string }) {
  const [schedule, setSchedule] = useState<{ rounds: Round[]; next: Round | null } | null>(null)
  const [standings, setStandings] = useState<any | null>(null)
  const [liveKey, setLiveKey] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    fetch('/api/f1/schedule')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setSchedule(j) })
      .catch(() => {})
    fetch('/api/f1/standings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setStandings(j) })
      .catch(() => {})
    // Live now? The latest session endpoint answers in one call.
    fetch('/api/f1/live')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.state === 'live') setLiveKey(j.sessionKey) })
      .catch(() => {})
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const next = schedule?.next ?? null
  const msToNext = next ? Date.parse(next.startIso) - now : NaN
  const constructors = (teams ?? []).filter((t) => t.sport === 'F1')

  return (
    <div className="space-y-12">
      {/* Next race */}
      <section aria-label="Next race">
        {liveKey ? (
          <Link href={`/f1/race/${liveKey}`} className="fs-panel block p-5 sm:p-6 transition hover:brightness-125" style={{ borderColor: '#E1060055' }}>
            <p className="fs-eyebrow mb-1" style={{ '--tint': teamColor } as React.CSSProperties}>Happening now</p>
            <p className="fs-title text-2xl sm:text-3xl">🔴 Live timing is on — open the Race Center →</p>
          </Link>
        ) : next ? (
          <div className="fs-panel p-5 sm:p-6">
            <p className="fs-eyebrow mb-1" style={{ '--tint': teamColor } as React.CSSProperties}>
              Round {next.round} · Next race
            </p>
            <h2 className="fs-title text-2xl sm:text-3xl">{next.name}</h2>
            <p className="text-sm text-fs-muted mt-1">
              {next.circuit ?? ''}{next.locality ? ` · ${next.locality}` : ''}{next.country ? `, ${next.country}` : ''}
            </p>
            <p className="fs-mono text-sm mt-2 tabular-nums" title={new Date(next.startIso).toString()}>
              {Number.isFinite(msToNext) && msToNext > 0 ? countdown(msToNext) : 'Date TBC'} ·{' '}
              {new Date(next.startIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        ) : (
          <div className="fs-panel p-5 sm:p-6"><p className="text-sm text-fs-muted">Calendar loading…</p></div>
        )}
      </section>

      {/* Schedule */}
      <section aria-label="Calendar">
        <h2 className="fs-title text-xl mb-4">2026 Calendar</h2>
        <div className="fs-panel overflow-hidden">
          <ul className="divide-y divide-fs-line">
            {(schedule?.rounds ?? []).map((r) => {
              const past = Date.parse(r.startIso) < now - 3 * 3_600_000
              const isNext = next?.round === r.round && next?.name === r.name
              return (
                <li key={`${r.round}-${r.name}`} className={`flex items-baseline gap-3 px-3 sm:px-4 py-2 text-sm ${past && !isNext ? 'opacity-55' : ''}`}>
                  <span className="fs-mono text-fs-muted-2 w-7 shrink-0 tabular-nums">R{r.round}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{r.name}</span>{' '}
                    <span className="text-fs-muted-2 text-xs">{r.locality ?? r.country ?? ''}</span>
                    {isNext ? <span className="ml-2 text-[10px] font-bold text-fs-gold">NEXT</span> : null}
                  </span>
                  <span className="fs-mono text-xs text-fs-muted shrink-0 tabular-nums">
                    {new Date(r.startIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              )
            })}
            {!schedule ? <li className="px-4 py-3 text-sm text-fs-muted-2">Loading calendar…</li> : null}
          </ul>
        </div>
      </section>

      {/* Standings */}
      <section aria-label="Championships" className="grid gap-6 md:grid-cols-2 items-start">
        <div className="fs-panel overflow-hidden">
          <h2 className="fs-title text-xl px-4 pt-4 pb-1">Drivers</h2>
          <ol className="divide-y divide-fs-line">
            {(standings?.drivers ?? []).slice(0, 10).map((d: any) => (
              <li key={d.code ?? d.name} className="flex items-baseline gap-2.5 px-4 py-1.5 text-sm">
                <span className="fs-mono font-bold w-6 text-fs-muted tabular-nums">{d.position}</span>
                <span className="font-semibold flex-1 truncate">{d.name}</span>
                <span className="text-fs-muted-2 text-xs">{d.teamAbbr ?? ''}</span>
                <span className="fs-mono font-bold tabular-nums">{d.points}</span>
              </li>
            ))}
            {!standings ? <li className="px-4 py-3 text-sm text-fs-muted-2">Loading…</li> : null}
          </ol>
        </div>
        <div className="fs-panel overflow-hidden">
          <h2 className="fs-title text-xl px-4 pt-4 pb-1">Constructors</h2>
          <ol className="divide-y divide-fs-line">
            {(standings?.constructors ?? []).map((c: any) => (
              <li key={c.name} className="flex items-baseline gap-2.5 px-4 py-1.5 text-sm">
                <span className="fs-mono font-bold w-6 text-fs-muted tabular-nums">{c.position}</span>
                <span className="font-semibold flex-1 truncate">{c.name}</span>
                <span className="fs-mono font-bold tabular-nums">{c.points}</span>
              </li>
            ))}
            {!standings ? <li className="px-4 py-3 text-sm text-fs-muted-2">Loading…</li> : null}
          </ol>
        </div>
      </section>

      {/* Constructors */}
      <section aria-label="Constructors">
        <h2 className="fs-title text-xl mb-4">Constructors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {constructors.map((t) => (
            <Link key={t.id} href={`/f1/${t.id}`} className="fs-panel block p-4 transition hover:brightness-125">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="w-9 h-9 rounded-lg shrink-0" style={{ backgroundColor: t.colors.primary }} />
                <span>
                  <span className="fs-title text-base block">{t.name}</span>
                  <span className="fs-meta">{t.abbreviation}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function countdown(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${mins}m`
  return `in ${mins}m`
}
