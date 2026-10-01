'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Team } from '@/data/teams'

/**
 * Constructor page: championship position, drivers with points, next race.
 * F1 teams have no ESPN roster/schedule feed, so this panel replaces the
 * ESPN-driven TeamDashboard for sport === 'F1'.
 */
export function F1TeamPanel({ team, teamColor }: { team: Team; teamColor: string }) {
  const [standings, setStandings] = useState<any | null>(null)
  const [next, setNext] = useState<any | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/f1/standings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setStandings(j) })
      .catch(() => {})
    fetch('/api/f1/schedule')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.next) setNext(j.next) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const row = (standings?.constructors ?? []).find((c: any) => c.teamAbbr === team.abbreviation)
  const drivers = (standings?.drivers ?? []).filter((d: any) => d.teamAbbr === team.abbreviation)

  return (
    <div className="space-y-8">
      <div className="fs-panel p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="w-14 h-14 rounded-xl shrink-0" style={{ backgroundColor: team.colors.primary }} />
          <div>
            <p className="fs-eyebrow mb-1" style={{ '--tint': teamColor } as React.CSSProperties}>Constructor</p>
            <h1 className="fs-title text-3xl sm:text-4xl leading-none">{team.name}</h1>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-5">
          {[
            ['Championship', row?.position != null ? `P${row.position}` : '–'],
            ['Points', row?.points ?? '–'],
            ['Wins', row?.wins ?? '–'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg p-3 text-center" style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}16` }}>
              <p className="fs-mono text-xl font-bold tabular-nums">{value}</p>
              <p className="fs-meta mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <section aria-label="Drivers">
        <h2 className="fs-title text-xl mb-4">Drivers</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {drivers.map((d: any) => (
            <div key={d.code ?? d.name} className="fs-panel p-4">
              <p className="fs-title text-lg">{d.name}</p>
              <p className="fs-meta mt-0.5">{d.code ?? ''}</p>
              <div className="flex gap-4 mt-2 text-sm">
                <span><span className="fs-mono font-bold tabular-nums">{d.points}</span> <span className="fs-meta">pts</span></span>
                <span><span className="fs-mono font-bold tabular-nums">P{d.position}</span> <span className="fs-meta">championship</span></span>
                <span><span className="fs-mono font-bold tabular-nums">{d.wins}</span> <span className="fs-meta">wins</span></span>
              </div>
            </div>
          ))}
          {!standings ? <p className="text-sm text-fs-muted-2">Loading drivers…</p> : null}
        </div>
      </section>

      {next ? (
        <section aria-label="Next race" className="fs-panel p-4 sm:p-5">
          <h2 className="fs-title text-xl mb-1">Next Race</h2>
          <p className="text-sm"><span className="font-semibold">{next.name}</span>{' '}
            <span className="text-fs-muted">{next.locality ?? next.country ?? ''} · {new Date(next.startIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </p>
        </section>
      ) : null}

      <p className="text-xs text-fs-muted-2">
        <Link href="/f1" className="underline underline-offset-2 hover:text-fs-text">← All of F1</Link>
      </p>
    </div>
  )
}
