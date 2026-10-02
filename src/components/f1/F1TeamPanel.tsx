'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Team } from '@/data/teams'
import { F1Badge } from './F1Badge'
import { ErrorState } from '@/components/feedback'

interface ConstructorData {
  season: string
  teamAbbr: string
  constructor: { position: number; points: number; wins: number; name: string | null } | null
  rounds: {
    round: number
    name: string
    locality: string | null
    date: string
    cars: { code: string | null; name: string; position: string | null; positionText: string | null; points: number; grid: string | null; status: string | null }[]
    points: number
  }[]
}

interface NewsArticle {
  title: string
  url: string
  source: string
  date: string
  snippet: string
}

/**
 * Constructor page: hero in livery colours, championship stats, driver
 * cards linking to driver profiles, per-race both-cars table, and fresh
 * team news.
 */
export function F1TeamPanel({ team, teamColor }: { team: Team; teamColor: string }) {
  const [standings, setStandings] = useState<any | null>(null)
  const [next, setNext] = useState<any | null>(null)
  const [detail, setDetail] = useState<ConstructorData | null>(null)
  const [news, setNews] = useState<NewsArticle[] | null>(null)
  const [standingsFailed, setStandingsFailed] = useState(false)
  const [detailFailed, setDetailFailed] = useState(false)
  const [newsFailed, setNewsFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const primary = team.colors.primary

  useEffect(() => {
    let cancelled = false
    fetch('/api/f1/standings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`standings ${r.status}`))))
      .then((j) => { if (!cancelled) { setStandings(j); setStandingsFailed(false) } })
      .catch(() => { if (!cancelled) setStandingsFailed(true) })
    fetch('/api/f1/schedule')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.next) setNext(j.next) })
      .catch(() => {})
    fetch(`/api/f1/constructor?team=${encodeURIComponent(team.abbreviation)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`constructor ${r.status}`))))
      .then((j) => { if (!cancelled) { setDetail(j); setDetailFailed(false) } })
      .catch(() => { if (!cancelled) setDetailFailed(true) })
    fetch(`/api/news-search?team=${encodeURIComponent(team.name)}&sport=f1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`news ${r.status}`))))
      .then((j) => { if (!cancelled) { setNews(j.articles ?? []); setNewsFailed(false) } })
      .catch(() => { if (!cancelled) setNewsFailed(true) })
    return () => { cancelled = true }
  }, [team.abbreviation, team.name, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  const row = (standings?.constructors ?? []).find((c: any) => c.teamAbbr === team.abbreviation)
  const drivers = (standings?.drivers ?? []).filter((d: any) => d.teamAbbr === team.abbreviation)
  const rounds = [...(detail?.rounds ?? [])].sort((a, b) => b.round - a.round)

  return (
    <div className="space-y-8">
      <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">← All of F1</Link>

      {/* Hero in livery colours */}
      <div className="rounded-2xl border p-5 sm:p-7 relative overflow-hidden" style={{ borderColor: `${primary}55`, background: `linear-gradient(135deg, ${primary}2e 0%, #111712 55%)` }}>
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(120deg, ${primary}40 0%, transparent 45%, transparent 60%, ${team.colors.secondary}33 100%)` }}
        />
        <div className="relative flex items-center gap-4">
          <F1Badge abbr={team.abbreviation} size="xl" />
          <div>
            <p className="fs-eyebrow mb-1" style={{ '--tint': teamColor } as React.CSSProperties}>Constructor · {team.abbreviation}</p>
            <h1 className="fs-title text-3xl sm:text-5xl leading-none">{team.name}</h1>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-3 mt-6">
          {[
            ['Championship', row?.position != null ? `P${row.position}` : detail?.constructor?.position != null ? `P${detail.constructor.position}` : '–'],
            ['Points', row?.points ?? detail?.constructor?.points ?? '–'],
            ['Wins', row?.wins ?? detail?.constructor?.wins ?? '–'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl p-3 sm:p-4 text-center border" style={{ backgroundColor: `${primary}14`, borderColor: `${primary}38` }}>
              <p className="fs-mono text-xl sm:text-2xl font-bold tabular-nums">{value}</p>
              <p className="fs-meta mt-1">{label}</p>
            </div>
          ))}
        </div>
        {/* Livery strip */}
        <div aria-hidden="true" className="relative mt-5 h-2 rounded-full overflow-hidden" style={{ background: '#ffffff10' }}>
          <div className="h-full w-full" style={{ background: `linear-gradient(90deg, ${primary} 0%, ${primary} 60%, ${team.colors.secondary} 60%, ${team.colors.secondary} 100%)` }} />
        </div>
      </div>

      {/* Body: drivers/results and news/next-race sit side-by-side on desktop. */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 min-w-0 space-y-8">

      {/* Drivers */}
      <section aria-label="Drivers">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="fs-title text-xl">Drivers</h2>
          <p className="fs-meta">Tap for race-by-race</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {drivers.map((d: any) => (
            <Link
              key={d.code ?? d.name}
              href={d.code ? `/f1/driver/${encodeURIComponent(d.code)}` : '/f1'}
              className="block p-4 rounded-xl border transition hover:-translate-y-0.5 hover:brightness-125"
              style={{ borderColor: `${primary}44`, background: `linear-gradient(135deg, ${primary}1a 0%, #111712 60%)` }}
              prefetch={false}
            >
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="w-10 h-10 rounded-xl grid place-items-center text-xs font-black text-white shrink-0" style={{ backgroundColor: primary }}>
                  {d.code ?? '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="fs-title text-lg block truncate">{d.name}</span>
                  <span className="fs-meta">{d.code ?? ''} · P{d.position} · {d.points} PTS · {d.wins} WINS →</span>
                </span>
              </div>
            </Link>
          ))}
          {standingsFailed ? (
            <div className="sm:col-span-2">
              <ErrorState message="Couldn't load driver standings." onRetry={reload} />
            </div>
          ) : !standings ? (
            <p className="text-sm text-fs-muted-2">Loading drivers…</p>
          ) : drivers.length === 0 ? (
            <p className="text-sm text-fs-muted-2">No drivers listed for this team yet.</p>
          ) : null}
        </div>
      </section>

      {/* Per-race both-cars table */}
      <section aria-label="Season results">
        <h2 className="fs-title text-xl mb-4">{detail?.season ?? ''} race by race</h2>
        <div className="fs-panel overflow-hidden">
          <ol className="divide-y divide-fs-line">
            {rounds.map((r) => (
              <li key={r.round}>
                <Link href={`/f1/round/${r.round}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.03]" prefetch={false}>
                  <span className="fs-mono text-fs-muted-2 w-8 shrink-0 tabular-nums">R{r.round}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold block truncate">{r.name}</span>
                    <span className="text-fs-muted-2 text-xs">
                      {r.cars.map((c) => `${c.code ?? '?'} P${c.positionText ?? '–'}`).join(' · ')}{r.locality ? ` · ${r.locality}` : ''}
                    </span>
                  </span>
                  {r.points > 0 ? <span className="fs-mono text-xs font-bold text-fs-gold tabular-nums">+{r.points}</span> : <span className="fs-mono text-xs text-fs-muted-2">–</span>}
                </Link>
              </li>
            ))}
            {detail != null && rounds.length === 0 ? <li className="px-4 py-4 text-sm text-fs-muted-2">No race results this season yet.</li> : null}
            {detailFailed ? (
              <li className="px-4 py-4">
                <ErrorState message="Couldn't load this season's race results." onRetry={reload} />
              </li>
            ) : detail == null ? (
              <li className="px-4 py-4 text-sm text-fs-muted-2">Loading season results…</li>
            ) : null}
          </ol>
        </div>
      </section>
        </div>
        <aside className="lg:col-span-5 min-w-0 space-y-8">

      {/* News */}
      <section aria-label="Team news">
        <h2 className="fs-title text-xl mb-4">Team news</h2>
        {newsFailed ? (
          <ErrorState message="Couldn't load team news." onRetry={reload} />
        ) : news == null ? (
          <div className="fs-panel p-4"><p className="text-sm text-fs-muted-2">Loading news…</p></div>
        ) : news.length === 0 ? (
          <div className="fs-panel p-4"><p className="text-sm text-fs-muted-2">No fresh stories for {team.name} right now.</p></div>
        ) : (
          <div className="grid gap-3">
            {news.map((a) => (
              <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="fs-panel block p-4 hover:brightness-125 transition">
                <p className="fs-meta mb-1">{a.source} · {a.date ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</p>
                <p className="font-semibold text-sm leading-snug">{a.title}</p>
                {a.snippet ? <p className="text-xs text-fs-muted mt-1 line-clamp-2">{a.snippet}</p> : null}
              </a>
            ))}
          </div>
        )}
      </section>

      {next ? (
        <section aria-label="Next race" className="fs-panel p-4 sm:p-5">
          <h2 className="fs-title text-xl mb-1">Next Race</h2>
          <p className="text-sm"><span className="font-semibold">{next.name}</span>{' '}
            <span className="text-fs-muted">{next.locality ?? next.country ?? ''} · {new Date(next.startIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </p>
          <Link href={`/f1/round/${next.round}`} className="fs-btn inline-block mt-3" prefetch={false}>Weekend hub →</Link>
        </section>
      ) : null}
        </aside>
      </div>
    </div>
  )
}
