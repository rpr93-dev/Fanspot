'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { teams } from '@/data/teams'
import { F1Badge } from './F1Badge'
import { ErrorState } from '@/components/feedback'

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
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeKey, setActiveKey] = useState<number | null>(null)
  // Per-session fallback: if the weekend payload missed a finished session's
  // classification, backfill it from the single-session endpoint on demand.
  const [backfill, setBackfill] = useState<Record<number, { result: WeekendSession['result']; drivers: WeekendData['drivers'] }>>({})

  useEffect(() => {
    let cancelled = false
    setError(false)
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
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [round, season, reloadKey])

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
        <ErrorState
          message="Couldn't load this Grand Prix weekend — it may not be published yet."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-6">
        <Link href="/f1" className="fs-meta hover:text-fs-text">← All of F1</Link>
        <h1 className="fs-title text-3xl sm:text-5xl">
          {round ? `Round ${round}` : 'Grand Prix weekend'}
        </h1>
        <div className="fs-panel p-6"><p className="text-sm text-fs-muted">Loading Grand Prix weekend…</p></div>
      </div>
    )
  }

  const title = data.race?.name ?? data.meeting?.name ?? `Round ${round}`
  const nLive = ordered.filter((s) => s.state === 'live').length
  const nFinal = ordered.filter((s) => s.state === 'final').length
  return (
    <div className="space-y-6">
      <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">← All of F1</Link>

      {/* Weekend hero */}
      <div
        className="rounded-2xl border p-5 sm:p-7 relative overflow-hidden"
        style={{ borderColor: '#E1060044', background: 'linear-gradient(135deg, #E1060024 0%, #111712 55%)' }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(600px 200px at 85% 0%, #E1060018, transparent 70%)' }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="fs-mono text-[11px] font-bold px-2 py-0.5 rounded tabular-nums" style={{ backgroundColor: '#E10600', color: '#fff' }}>
              {data.round != null ? `ROUND ${data.round}` : 'GRAND PRIX'}
            </span>
            <span className="fs-meta">{data.season} season</span>
            {nLive > 0 ? (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded text-white bg-fs-red animate-pulse">● LIVE NOW</span>
            ) : nFinal === ordered.length && ordered.length > 0 ? (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded text-fs-muted bg-white/10">WEEKEND COMPLETE</span>
            ) : null}
          </div>
          <h1 className="fs-title text-3xl sm:text-5xl">{title}</h1>
          <p className="text-sm text-fs-muted mt-2">
            {[data.race?.circuit ?? data.meeting?.circuit, data.race?.locality ?? data.meeting?.location, data.race?.country ?? data.meeting?.country].filter(Boolean).join(' · ')}
          </p>
          <p className="fs-mono text-xs text-fs-muted mt-1 tabular-nums">
            {data.race ? `${data.race.date}${data.race.time ? ` · ${data.race.time}` : ''} · ` : ''}
            {ordered.length > 0 ? `${ordered.length} sessions${nFinal > 0 ? ` · ${nFinal} final` : ''}` : 'Date TBC'}
          </p>
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
          <div className="inline-flex flex-wrap gap-1 rounded-full border border-fs-line bg-white/[0.03] p-1" role="tablist" aria-label="Weekend sessions">
            {ordered.map((s, i) => {
              const isActive = s.key === active?.key
              return (
                <button
                  key={s.key}
                  role="tab"
                  id={`weekend-tab-${s.key}`}
                  aria-controls="weekend-session-panel"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveKey(s.key)}
                  onKeyDown={(e) => {
                    const last = ordered.length - 1
                    let next = -1
                    if (e.key === 'ArrowRight') next = i === last ? 0 : i + 1
                    else if (e.key === 'ArrowLeft') next = i === 0 ? last : i - 1
                    else if (e.key === 'Home') next = 0
                    else if (e.key === 'End') next = last
                    if (next >= 0) {
                      e.preventDefault()
                      setActiveKey(ordered[next].key)
                      requestAnimationFrame(() => document.getElementById(`weekend-tab-${ordered[next].key}`)?.focus())
                    }
                  }}
                  className={`fs-tab !px-4 ${isActive ? 'fs-tab-active' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                    style={{
                      backgroundColor: s.state === 'live' ? '#E10600' : s.state === 'final' ? '#8bc53f' : 'transparent',
                      border: s.state === 'upcoming' ? '1px solid #5e6c63' : undefined,
                      boxShadow: s.state === 'live' ? '0 0 6px #E10600' : undefined,
                    }}
                  />
                  {s.name}
                </button>
              )
            })}
          </div>

          {active ? (
            <div role="tabpanel" id="weekend-session-panel" aria-labelledby={`weekend-tab-${active.key}`}>
              <SessionPanel session={active} driverByNumber={driverByNumber} />
            </div>
          ) : null}
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="fs-meta !text-[10px] text-left border-y border-fs-line">
              <th scope="col" className="font-medium pl-4 sm:pl-5 pr-2 py-2 w-14">POS</th>
              <th scope="col" className="font-medium py-2 pr-2">DRIVER</th>
              <th scope="col" className="font-medium py-2 pr-2 hidden md:table-cell">TEAM</th>
              <th scope="col" className="font-medium py-2 pr-2 text-right">GAP</th>
              <th scope="col" className="font-medium py-2 pl-2 pr-4 sm:pr-5 text-right">PTS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fs-line">
            {rows.map((r) => {
              const d = driverByNumber.get(r.driverNumber)
              const status = r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : null
              const pos = Number(r.position)
              const posColor = pos === 1 ? 'text-fs-gold' : pos === 2 ? 'text-fs-text' : pos === 3 ? 'text-[#cd7f32]' : 'text-fs-muted'
              const tid = teams.find((t) => t.sport === 'F1' && t.abbreviation === d?.teamAbbr)?.id
              return (
                <tr key={r.driverNumber} className="hover:bg-white/[0.025] transition-colors">
                  <td className="pl-4 sm:pl-5 pr-2 py-2 relative">
                    <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: d?.colour ?? '#333' }} />
                    <span className={`fs-mono font-black text-base tabular-nums ${posColor}`}>{r.position ?? '–'}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-24 shrink-0 hidden sm:inline-flex">
                        <F1Badge abbr={d?.teamAbbr} primary={d?.colour} size="sm" />
                      </span>
                      <span className="min-w-0">
                        {d ? (
                          <Link href={`/f1/driver/${encodeURIComponent(d.acronym)}`} className="font-bold fs-mono text-[13px] hover:underline" prefetch={false}>
                            {d.acronym}
                          </Link>
                        ) : (
                          <span className="font-bold fs-mono text-[13px]">#{r.driverNumber}</span>
                        )}{' '}
                        {status ? <span className="text-[10px] font-bold text-fs-red">{status}</span> : null}
                        <span className="block text-fs-muted-2 text-xs truncate">
                          {d ? `${d.firstName} ${d.lastName}` : 'Classification pending'}
                          <span className="md:hidden">{d?.teamAbbr ? ` · ${d.teamAbbr}` : ''}</span>
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 hidden md:table-cell">
                    {d?.team ? (
                      tid ? (
                        <Link href={`/f1/${tid}`} className="text-fs-muted text-[13px] hover:text-fs-text hover:underline truncate block max-w-40" prefetch={false}>
                          {d.team}
                        </Link>
                      ) : (
                        <span className="text-fs-muted text-[13px] truncate block max-w-40">{d.team}</span>
                      )
                    ) : (
                      <span className="text-fs-muted-2 text-xs">–</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right fs-mono text-xs text-fs-muted tabular-nums whitespace-nowrap">
                    {typeof r.gapToLeader === 'number' ? (r.gapToLeader === 0 ? 'LEADER' : `+${r.gapToLeader.toFixed(3)}`) : (r.gapToLeader ?? '–')}
                  </td>
                  <td className="py-2 pl-2 pr-4 sm:pr-5 text-right fs-mono text-xs font-bold tabular-nums">
                    {r.points != null && Number(r.points) > 0 ? <span className="text-fs-gold">{r.points}</span> : <span className="text-fs-muted-2 font-normal">–</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      ) : (
        <p className="px-4 sm:px-5 pb-5 text-sm text-fs-muted-2">
          {session.state === 'upcoming' ? 'No classification yet — lights out ' + fmtDate(session.dateStart) + '.' : 'Timing data pending for this session.'}
        </p>
      )}
    </section>
  )
}
