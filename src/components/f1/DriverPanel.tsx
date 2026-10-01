'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { teams } from '@/data/teams'
import { F1Badge } from './F1Badge'

interface DriverData {
  season: string
  code: string
  driver: {
    position: number | null
    points: number
    wins: number
    name: string | null
    number: string | null
    nationality: string | null
    team: string | null
    teamAbbr: string | null
  } | null
  rounds: {
    round: number
    name: string
    locality: string | null
    country: string | null
    date: string
    position: string | null
    positionText: string | null
    points: number
    grid: string | null
    laps: string | null
    status: string | null
    team: string | null
    teamAbbr: string | null
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
 * Driver detail: championship card in constructor colours, per-race results
 * table across the season, and fresh F1 news for the driver.
 */
export function DriverPanel({ code }: { code: string }) {
  const [data, setData] = useState<DriverData | null>(null)
  const [news, setNews] = useState<NewsArticle[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/f1/driver?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Driver ${r.status}`))))
      .then((j) => { if (!cancelled) setData(j) })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Driver unavailable') })
    return () => { cancelled = true }
  }, [code])

  useEffect(() => {
    if (!data?.driver?.name) return
    let cancelled = false
    fetch(`/api/news-search?team=${encodeURIComponent(data.driver.name)}&sport=f1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setNews(j.articles ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [data?.driver?.name])

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
        <div className="fs-panel p-6"><p className="text-sm text-fs-muted">Loading driver…</p></div>
      </div>
    )
  }

  const teamRecord = teams.find((t) => t.sport === 'F1' && t.abbreviation === data.driver?.teamAbbr)
  const primary = teamRecord?.colors.primary ?? '#E10600'
  const name = data.driver?.name ?? code.toUpperCase()
  const rounds = [...(data.rounds ?? [])].sort((a, b) => b.round - a.round)

  return (
    <div className="space-y-8">
      <Link href="/f1" className="fs-meta hover:text-fs-text inline-block">← All of F1</Link>

      {/* Hero in constructor colours */}
      <div className="fs-panel p-5 sm:p-7 relative overflow-hidden" style={{ borderColor: `${primary}55` }}>
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(120deg, ${primary}33 0%, transparent 45%, transparent 60%, ${primary}22 100%)` }}
        />
        <div className="relative flex items-center gap-4 sm:gap-5">
          <F1Badge abbr={data.driver?.teamAbbr} primary={primary} size="xl" />
          <div className="min-w-0">
            <p className="fs-eyebrow mb-1" style={{ '--tint': primary } as React.CSSProperties}>
              Driver · {code.toUpperCase()}{data.driver?.number ? ` · #${data.driver.number}` : ''}
            </p>
            <h1 className="fs-title text-3xl sm:text-5xl leading-none truncate">{name}</h1>
            <p className="text-sm text-fs-muted mt-2">
              {data.driver?.team ? (
                <>
                  {teamRecord ? (
                    <Link href={`/f1/${teamRecord.id}`} className="font-semibold hover:underline" style={{ color: primary }} prefetch={false}>
                      {data.driver.team}
                    </Link>
                  ) : (
                    <span className="font-semibold">{data.driver.team}</span>
                  )}
                  {data.driver?.nationality ? ` · ${data.driver.nationality}` : ''}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="relative grid grid-cols-3 gap-3 mt-6">
          {[
            ['Championship', data.driver?.position != null ? `P${data.driver.position}` : '–'],
            ['Points', data.driver?.points ?? '–'],
            ['Wins', data.driver?.wins ?? '–'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl p-3 sm:p-4 text-center border" style={{ backgroundColor: `${primary}0f`, borderColor: `${primary}33` }}>
              <p className="fs-mono text-xl sm:text-2xl font-bold tabular-nums">{value}</p>
              <p className="fs-meta mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-race results */}
      <section aria-label="Race by race">
        <h2 className="fs-title text-xl mb-4">{data.season} race by race</h2>
        <div className="fs-panel overflow-hidden">
          <ol className="divide-y divide-fs-line">
            {rounds.map((r) => {
              const finished = r.status === 'Finished' || /^\d+$/.test(r.positionText ?? '')
              return (
                <li key={r.round}>
                  <Link
                    href={`/f1/round/${r.round}`}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.03] transition-colors"
                    prefetch={false}
                  >
                    <span className="fs-mono text-fs-muted-2 w-8 shrink-0 tabular-nums">R{r.round}</span>
                    <span
                      aria-hidden="true"
                      className="w-8 h-8 rounded-lg grid place-items-center text-[11px] font-black text-white shrink-0"
                      style={{
                        backgroundColor: finished && r.position === '1' ? '#e8b94c' : finished && Number(r.position) <= 3 ? '#8a9990' : '#222',
                        color: finished && r.position === '1' ? '#111' : '#fff',
                      }}
                    >
                      {r.positionText ?? '–'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold block truncate">{r.name}</span>
                      <span className="fs-meta !text-[10px]">{r.locality ?? r.country ?? ''} · {r.date}</span>
                    </span>
                    {r.points > 0 ? <span className="fs-mono text-xs font-bold text-fs-gold tabular-nums">+{r.points}</span> : null}
                    <span className="fs-mono text-xs text-fs-muted-2 tabular-nums hidden sm:inline w-20 text-right">
                      {r.grid ? `P${r.grid} → P${r.positionText ?? '–'}` : (r.status ?? '')}
                    </span>
                  </Link>
                </li>
              )
            })}
            {rounds.length === 0 ? <li className="px-4 py-4 text-sm text-fs-muted-2">No race results this season yet.</li> : null}
          </ol>
        </div>
      </section>

      {/* News */}
      <section aria-label="Driver news">
        <h2 className="fs-title text-xl mb-4">Latest news</h2>
        {news == null ? (
          <div className="fs-panel p-4"><p className="text-sm text-fs-muted-2">Loading news…</p></div>
        ) : news.length === 0 ? (
          <div className="fs-panel p-4"><p className="text-sm text-fs-muted-2">No fresh stories for {name} right now.</p></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
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
    </div>
  )
}
