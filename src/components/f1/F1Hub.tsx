'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { teams } from '@/data/teams'
import { F1Badge } from './F1Badge'

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
 * F1 league hub: next race with countdown, live-session entry, clickable
 * full calendar (every round links to its weekend hub with race/qualy/
 * practice classifications), and both championships with constructor
 * colours throughout.
 */
export function F1Hub({ teamColor = '#E10600' }: { teamColor?: string }) {
  const [schedule, setSchedule] = useState<{ rounds: Round[]; next: Round | null; season?: string } | null>(null)
  const [standings, setStandings] = useState<any | null>(null)
  const [liveKey, setLiveKey] = useState<number | null>(null)
  const [liveName, setLiveName] = useState<string | null>(null)
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
    fetch('/api/f1/live')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.state === 'live') {
          setLiveKey(j.sessionKey)
          setLiveName(j.sessionName ?? null)
        }
      })
      .catch(() => {})
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const next = schedule?.next ?? null
  const msToNext = next ? Date.parse(next.startIso) - now : NaN
  const constructors = (teams ?? []).filter((t) => t.sport === 'F1')
  const abbrToTeam = new Map(constructors.map((t) => [t.abbreviation, t]))
  const season = schedule?.season ?? String(new Date().getFullYear())

  return (
    <div className="space-y-12">
      {/* Next race hero */}
      <section aria-label="Next race">
        {liveKey ? (
          <Link
            href={`/f1/race/${liveKey}`}
            className="block p-5 sm:p-7 rounded-2xl border relative overflow-hidden transition hover:brightness-125"
            style={{ borderColor: '#E1060066', background: 'linear-gradient(120deg, #E1060033 0%, #111712 45%, #111712 100%)' }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(100deg, #E1060044 0%, transparent 50%)' }}
            />
            <p className="fs-eyebrow mb-1 relative" style={{ '--tint': teamColor } as React.CSSProperties}>Happening now{liveName ? ` · ${liveName}` : ''}</p>
            <p className="fs-title text-2xl sm:text-4xl relative">🔴 Live timing is on — open the Race Center →</p>
          </Link>
        ) : next ? (
          <Link
            href={`/f1/round/${next.round}`}
            className="block p-5 sm:p-7 rounded-2xl border relative overflow-hidden transition hover:brightness-125"
            style={{ borderColor: '#E1060044', background: 'linear-gradient(120deg, #E1060022 0%, #111712 45%, #111712 100%)' }}
          >
            <p className="fs-eyebrow mb-1" style={{ '--tint': teamColor } as React.CSSProperties}>
              Round {next.round} · Next race · tap for weekend hub
            </p>
            <h2 className="fs-title text-3xl sm:text-4xl">{next.name}</h2>
            <p className="text-sm text-fs-muted mt-1">
              {next.circuit ?? ''}{next.locality ? ` · ${next.locality}` : ''}{next.country ? `, ${next.country}` : ''}
            </p>
            <p className="fs-mono text-sm mt-2 tabular-nums" title={new Date(next.startIso).toString()}>
              {Number.isFinite(msToNext) && msToNext > 0 ? countdown(msToNext) : 'Date TBC'} ·{' '}
              {new Date(next.startIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
          </Link>
        ) : (
          <div className="fs-panel p-5 sm:p-6"><p className="text-sm text-fs-muted">Calendar loading…</p></div>
        )}
      </section>

      {/* Schedule — every round clickable */}
      <section aria-label="Calendar">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="fs-title text-xl">{season} Calendar</h2>
          <p className="fs-meta">Tap a GP for results + sessions</p>
        </div>
        {!schedule ? (
          <div className="fs-panel px-4 py-3 text-sm text-fs-muted-2">Loading calendar…</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(schedule.rounds ?? []).map((r) => {
              const past = Date.parse(r.startIso) < now - 3 * 3_600_000
              const isNext = next?.round === r.round && next?.name === r.name
              const d = new Date(r.startIso)
              const day = d.toLocaleDateString('en-US', { day: '2-digit' })
              const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
              return (
                <Link
                  key={`${r.round}-${r.name}`}
                  href={`/f1/round/${r.round}`}
                  prefetch={false}
                  className={`group relative overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:-translate-y-1 ${past ? 'opacity-75 hover:opacity-100' : ''}`}
                  style={
                    isNext
                      ? { borderColor: '#E1060066', background: 'linear-gradient(135deg, #E1060028 0%, #111712 55%)', boxShadow: '0 0 24px #E1060022' }
                      : { borderColor: 'rgba(242,245,241,0.08)', background: 'linear-gradient(180deg, #151c16, #111712)' }
                  }
                >
                  {/* top accent */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ background: isNext ? '#E10600' : past ? '#5e6c63' : 'linear-gradient(180deg, #E10600, #8a9990)', boxShadow: isNext ? '0 0 10px #E10600' : undefined }}
                  />
                  <div className="flex items-start justify-between gap-3 pl-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="fs-mono text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums"
                          style={isNext ? { backgroundColor: '#E10600', color: '#fff' } : { backgroundColor: 'rgba(255,255,255,0.07)', color: '#8a9990' }}
                        >
                          R{r.round}
                        </span>
                        {isNext ? <span className="text-[10px] font-bold text-fs-gold">★ NEXT</span> : null}
                        {past ? <span className="text-[10px] font-bold text-fs-muted-2">✓ DONE</span> : null}
                      </div>
                      <p className="font-bold text-[15px] leading-tight group-hover:underline underline-offset-2">{r.name}</p>
                      <p className="text-xs text-fs-muted mt-1 truncate">
                        {[r.circuit, r.locality ?? r.country].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-center shrink-0 rounded-lg px-2 py-1" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
                      <p className="fs-mono text-xl font-black leading-none tabular-nums">{day}</p>
                      <p className="fs-mono text-[10px] text-fs-muted tabular-nums">{mon}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pl-2">
                    <span className="fs-mono text-[11px] text-fs-muted tabular-nums">
                      {d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className={`text-[11px] font-bold ${past ? 'text-fs-muted-2' : 'text-fs-text'} group-hover:translate-x-0.5 transition-transform`}>
                      {past ? 'Results →' : 'Weekend →'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Standings */}
      <section aria-label="Championships" className="grid gap-6 md:grid-cols-2 items-start">
        <div className="fs-panel overflow-hidden">
          <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
            <h2 className="fs-title text-xl">Drivers</h2>
            <p className="fs-meta">Tap for profile</p>
          </div>
          <ol className="divide-y divide-fs-line">
            {(standings?.drivers ?? []).map((d: any) => {
              const team = abbrToTeam.get(d.teamAbbr)
              const c = team?.colors.primary ?? '#666'
              return (
                <li key={d.code ?? d.name} className="relative">
                  <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px] z-10" style={{ backgroundColor: c }} />
                  <Link href={d.code ? `/f1/driver/${encodeURIComponent(d.code)}` : '/f1'} className="flex items-center gap-3 pl-4 pr-4 py-1.5 text-sm hover:bg-white/[0.03]" prefetch={false}>
                    <span className="fs-mono font-bold w-6 text-fs-muted tabular-nums">{d.position}</span>
                    <span className="w-24 shrink-0 hidden sm:inline-flex">
                      <F1Badge abbr={d.teamAbbr} size="sm" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold block truncate hover:underline leading-tight">{d.name}</span>
                      <span className="fs-meta !text-[10px]">{d.code ?? ''}{d.wins ? ` · ${d.wins} WIN${d.wins === 1 ? '' : 'S'}` : ''}</span>
                    </span>
                    <span className="fs-mono font-bold tabular-nums w-12 text-right">{d.points}</span>
                  </Link>
                </li>
              )
            })}
            {!standings ? <li className="px-4 py-3 text-sm text-fs-muted-2">Loading…</li> : null}
          </ol>
        </div>
        <div className="fs-panel overflow-hidden">
          <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
            <h2 className="fs-title text-xl">Constructors</h2>
            <p className="fs-meta">Tap for team hub</p>
          </div>
          <ol className="divide-y divide-fs-line">
            {(standings?.constructors ?? []).map((c: any) => {
              const team = abbrToTeam.get(c.teamAbbr)
              const color = team?.colors.primary ?? '#666'
              const href = team ? `/f1/${team.id}` : '/f1'
              const max = Math.max(...(standings?.constructors ?? []).map((x: any) => Number(x.points) || 0), 1)
              const pct = Math.max(4, ((Number(c.points) || 0) / max) * 100)
              return (
                <li key={c.name} className="relative">
                  <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px] z-10" style={{ backgroundColor: color }} />
                  <Link href={href} className="flex items-center gap-3 pl-4 pr-4 py-1.5 text-sm hover:bg-white/[0.03]" prefetch={false}>
                    <span className="fs-mono font-bold w-6 text-fs-muted tabular-nums">{c.position}</span>
                    <span className="w-24 shrink-0 hidden sm:inline-flex">
                      <F1Badge abbr={c.teamAbbr} size="sm" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold block truncate hover:underline leading-tight">{c.name}</span>
                      <span className="block h-1 rounded-full mt-1 overflow-hidden bg-white/5">
                        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
                      </span>
                    </span>
                    <span className="fs-mono font-bold tabular-nums w-12 text-right">{c.points}</span>
                  </Link>
                </li>
              )
            })}
            {!standings ? <li className="px-4 py-3 text-sm text-fs-muted-2">Loading…</li> : null}
          </ol>
        </div>
      </section>

      {/* Constructors grid with logos */}
      <section aria-label="Constructors">
        <h2 className="fs-title text-xl mb-4">Constructors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {constructors.map((t) => {
            const row = (standings?.constructors ?? []).find((c: any) => c.teamAbbr === t.abbreviation)
            return (
              <Link
                key={t.id}
                href={`/f1/${t.id}`}
                className="block p-4 rounded-xl border transition hover:-translate-y-0.5 hover:brightness-125 relative overflow-hidden"
                style={{ borderColor: `${t.colors.primary}44`, background: `linear-gradient(135deg, ${t.colors.primary}1f 0%, #111712 55%)` }}
                prefetch={false}
              >
                <div className="flex items-center gap-3">
                  <span className="w-32 shrink-0 inline-flex">
                    <F1Badge abbr={t.abbreviation} size="md" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="fs-title text-base block truncate">{t.name}</span>
                    <span className="fs-meta">{t.abbreviation}{row ? ` · P${row.position} · ${row.points} PTS` : ''}</span>
                  </span>
                  <span aria-hidden="true" className="text-fs-muted-2">→</span>
                </div>
                <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1" style={{ background: `linear-gradient(180deg, ${t.colors.primary}, ${t.colors.secondary})` }} />
              </Link>
            )
          })}
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
