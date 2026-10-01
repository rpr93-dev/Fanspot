'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { teams } from '@/data/teams'
import { F1Badge } from './F1Badge'

interface WeekendSession {
  key: number
  name: string
  type: string
  location: string
  dateStart: string
  dateEnd: string
  state: 'upcoming' | 'live' | 'final'
  result: {
    position: string | number | null
    driverNumber: number
    laps: number | null
    points: number | null
    gapToLeader: string | number | null
    dnf: boolean
    dns: boolean
    dsq: boolean
  }[]
}

interface WeekendData {
  season: string
  round: number | null
  race: { round: number; name: string; circuit: string | null; locality: string | null; country: string | null; date: string; time: string | null } | null
  meeting: { key: number; name: string; location: string; country: string | null; circuit: string | null; dateStart: string } | null
  sessions: WeekendSession[]
  drivers: { number: number; acronym: string; firstName: string; lastName: string; team: string; teamAbbr: string | null; colour: string }[]
}

const SESSION_ORDER = ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying', 'Practice 3', 'Practice 2', 'Practice 1']

function sessionRank(name: string): number {
  const i = SESSION_ORDER.indexOf(name)
  return i === -1 ? 99 : i
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

/**
 * Whole Grand Prix weekend: every session as a tab (Race / Qualifying /
 * Practice…) with full classification for completed sessions, live entry for
 * sessions on track now, and start times for upcoming ones. Works for past
 * and current weekends — future rounds without OpenF1 meetings show the
 * Jolpica schedule card.
 */
export function WeekendView({ round, season }: { round: string; season?: string }) {
  const [data, setData] = useState<WeekendData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<number | null>(null)
  // Per-session fallback: if the weekend payload missed a finished session's
  // classification, backfill it from the single-session endpoint on demand.
  const [backfill, setBackfill] = useState<Record<number, { result: WeekendSession['result']; drivers: WeekendData['drivers'] }>>({})

  useEffect(() => {
    let cancelled = false
    const yr = season ?? String(new Date().getFullYear())
    fetch(`/api/f1/weekend?season=${encodeURIComponent(yr)}&round=${encodeURIComponent(round)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Weekend ${r.status}`))))
      .then((j) => {
        if (cancelled) return
        setData(j)
        const ordered = [...(j.sessions ?? [])].sort((a, b) => sessionRank(a.name) - sessionRank(b.name))
        const live = ordered.find((s) => s.state === 'live')
        const race = ordered.find((s) => s.name === 'Race')
        const lastFinal = [...ordered].reverse().find((s) => s.state === 'final')
        setActiveKey((live ?? race ?? lastFinal ?? ordered[0] ?? null)?.key ?? null)
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Weekend unavailable') })
    return () => { cancelled = true }
  }, [round, season])

  const ordered = useMemo(
    () => [...(data?.sessions ?? [])].sort((a, b) => sessionRank(a.name) - sessionRank(b.name)),
    [data],
  )
  const activeRaw = ordered.find((s) => s.key === activeKey) ?? null
  // Merge any backfilled classification into the active session.
  const active = useMemo(() => {
    if (!activeRaw) return null
    const bf = backfill[activeRaw.key]
    return bf ? { ...activeRaw, result: bf.result } : activeRaw
  }, [activeRaw, backfill])
  const driverByNumber = useMemo(() => {
    const map = new Map((data?.drivers ?? []).map((d) => [d.number, d]))
    for (const bf of Object.values(backfill)) {
      for (const d of bf.drivers) if (!map.has(d.number)) map.set(d.number, d)
    }
    return map
  }, [data, backfill])

  // Backfill a finished session whose classification came back empty.
  useEffect(() => {
    if (!activeRaw || activeRaw.state !== 'final' || activeRaw.result.length > 0) return
    if (backfill[activeRaw.key]) return
    let cancelled = false
    fetch(`/api/f1/session?session_key=${encodeURIComponent(String(activeRaw.key))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return
        const result = (Array.isArray(j.result) ? j.result : []).map((row: any) => ({
          position: row.position,
          driverNumber: row.driverNumber,
          laps: row.laps ?? null,
          points: row.points ?? null,
          gapToLeader: Array.isArray(row.gapToLeader) ? row.gapToLeader[row.gapToLeader.length - 1] : (row.gapToLeader ?? null),
          dnf: row.dnf === true,
          dns: row.dns === true,
          dsq: row.dsq === true,
        }))
        if (result.length > 0) {
          setBackfill((prev) => ({ ...prev, [activeRaw.key]: { result, drivers: j.drivers ?? [] } }))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeRaw, backfill])

  if (error) {
    return (
      <div className="space-y-6">
        <Link href="/f1" className="fs-meta hover:text-fs-text">← All of F1</Link>
        <div className="fs-panel p-6"><p className="text-sm text-fs-red">{error}</p></div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <Link href="/f1" className="fs-meta hover:text-fs-text">← All of F1</Link>
        <div className="fs-panel p-6"><p className="text-sm text-fs-muted">Loading Grand Prix weekend…</p></div>
      </div>
    )
  }

  const title = data.race?.name ?? data.meeting?.name ?? `Round ${round}`
  return (
    <div className="space-y-6">
      <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">← All of F1</Link>

      {/* Weekend hero with constructor-colour wash */}
      <div
        className="fs-panel p-5 sm:p-7 relative overflow-hidden"
        style={{ borderColor: '#E1060044' }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(120deg, #E1060026 0%, transparent 40%, transparent 60%, #4781D755 100%)' }}
        />
        <div className="relative">
          <p className="fs-eyebrow mb-1" style={{ '--tint': '#E10600' } as React.CSSProperties}>
            {data.round != null ? `Round ${data.round}` : ''}{data.season ? ` · ${data.season} season` : ''}
          </p>
          <h1 className="fs-title text-3xl sm:text-5xl">{title}</h1>
          <p className="text-sm text-fs-muted mt-2">
            {[data.race?.circuit ?? data.meeting?.circuit, data.race?.locality ?? data.meeting?.location, data.race?.country ?? data.meeting?.country].filter(Boolean).join(' · ')}
          </p>
          {data.race ? (
            <p className="fs-mono text-xs text-fs-muted mt-1 tabular-nums">
              {data.race.date}{data.race.time ? ` · ${data.race.time}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="fs-panel p-6">
          <p className="text-sm text-fs-muted">
            Timing data isn&apos;t published for this weekend yet — the calendar entry above is confirmed, check back closer to the event.
          </p>
        </div>
      ) : (
        <>
          {/* Session tabs */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Weekend sessions">
            {ordered.map((s) => {
              const isActive = s.key === active?.key
              return (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveKey(s.key)}
                  className={`fs-tab border ${isActive ? 'fs-tab-active' : 'border-fs-line bg-white/[0.03]'}`}
                >
                  {s.name}
                  {s.state === 'live' ? ' ●' : ''}
                </button>
              )
            })}
          </div>

          {active ? <SessionPanel session={active} driverByNumber={driverByNumber} /> : null}
        </>
      )}
    </div>
  )
}

function SessionPanel({
  session,
  driverByNumber,
}: {
  session: WeekendSession
  driverByNumber: Map<number, WeekendData['drivers'][number]>
}) {
  const rows = [...(session.result ?? [])].sort((a, b) => (Number(a.position) || 999) - (Number(b.position) || 999))
  return (
    <section aria-label={session.name} className="fs-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-5 pt-4 pb-2">
        <h2 className="fs-title text-xl flex-1">{session.name}</h2>
        <span
          className={`text-[11px] font-bold px-2 py-0.5 rounded ${
            session.state === 'live' ? 'text-white bg-fs-red animate-pulse' : session.state === 'final' ? 'text-fs-muted bg-white/10' : 'text-fs-gold bg-fs-gold/15'
          }`}
        >
          {session.state === 'live' ? '● LIVE' : session.state.toUpperCase()}
        </span>
        <span className="fs-mono text-xs text-fs-muted tabular-nums">{fmtDate(session.dateStart)}</span>
        <Link href={`/f1/race/${session.key}`} className="fs-btn" prefetch={false}>
          {session.state === 'live' ? 'Open live timing →' : session.state === 'final' ? 'Track map + tower →' : 'Session hub →'}
        </Link>
      </div>

      {rows.length > 0 ? (
        <ol className="divide-y divide-fs-line">
          {rows.map((r) => {
            const d = driverByNumber.get(r.driverNumber)
            const status = r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : null
            return (
              <li key={r.driverNumber} className="flex items-center gap-2.5 px-4 sm:px-5 py-1.5 text-sm hover:bg-white/[0.02]">
                <span className="fs-mono font-bold w-7 text-fs-muted tabular-nums">{r.position ?? '–'}</span>
                <F1Badge abbr={d?.teamAbbr} primary={d?.colour} size="sm" />
                <span className="min-w-0 flex-1">
                  {d ? (
                    <Link href={`/f1/driver/${encodeURIComponent(d.acronym)}`} className="font-semibold fs-mono text-[13px] hover:underline" prefetch={false}>
                      {d.acronym}
                    </Link>
                  ) : (
                    <span className="font-semibold fs-mono text-[13px]">#{r.driverNumber}</span>
                  )}{' '}
                  <span className="text-fs-muted-2 text-xs truncate">
                    {d ? `${d.firstName} ${d.lastName}` : 'Classification pending'}
                    {d?.team ? (
                      <>
                        {' · '}
                        {(() => {
                          const tid = teams.find((t) => t.sport === 'F1' && t.abbreviation === d.teamAbbr)?.id
                          return tid ? (
                            <Link href={`/f1/${tid}`} className="hover:underline" prefetch={false}>{d.team}</Link>
                          ) : (
                            <span>{d.team}</span>
                          )
                        })()}
                      </>
                    ) : null}
                  </span>
                  {status ? <span className="ml-1.5 text-[10px] font-bold text-fs-red">{status}</span> : null}
                </span>
                <span className="fs-mono text-xs text-fs-muted tabular-nums hidden sm:inline">
                  {r.laps != null ? `${r.laps} laps` : ''}
                </span>
                {r.points != null && Number(r.points) > 0 ? (
                  <span className="fs-mono text-xs font-bold text-fs-gold tabular-nums w-14 text-right">{r.points} PTS</span>
                ) : null}
                <span className="fs-mono text-xs text-fs-muted tabular-nums w-20 text-right">
                  {typeof r.gapToLeader === 'number' ? (r.gapToLeader === 0 ? 'LEADER' : `+${r.gapToLeader.toFixed(3)}`) : (r.gapToLeader ?? '')}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="px-4 sm:px-5 pb-5 text-sm text-fs-muted-2">
          {session.state === 'upcoming' ? 'No classification yet — lights out ' + fmtDate(session.dateStart) + '.' : 'Timing data pending for this session.'}
        </p>
      )}
    </section>
  )
}
