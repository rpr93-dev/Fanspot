'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { sportConfig } from '@/data/teams'
import { FavoriteButton } from '@/components/FavoriteButton'
import { EmptyState, ErrorState } from '@/components/feedback'
import { normalizeSportKey, type SportKey } from '@/lib/models'
import { playerStatLabels, statMeaning } from '@/lib/roster-stats'

interface StatItem {
  key: string
  label: string
  value: string
}

interface StatCategory {
  name: string
  label: string
  stats: StatItem[]
}

interface PlayerPayload {
  sport: SportKey
  player: {
    id: string
    name: string
    shortName: string | null
    teamAbbr: string | null
    teamName: string | null
    teamHref: string | null
    position: string | null
    jersey: string | null
    headshot: string | null
    age: string | null
    height: string | null
    weight: string | null
    birthplace: string | null
    draft: string | null
    experience: number | null
    status: string | null
  }
  season: { year: number; categories: StatCategory[] } | null
  headline: { category: string | null; keys: { key: string; label: string }[] }
  careerSums: { range: [number, number] | null; sums: Record<string, string> }
  pastSeasons: { season: number; summary: Record<string, string> }[]
}

function statLabel(key: string, fallback: string): string {
  return playerStatLabels[key] ?? fallback ?? key
}

/** Every abbreviation on screen gets a hover explanation; the full list hides
 *  behind one toggle so the page stays clean for regulars. */
function StatGuide({ items }: { items: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const seen = new Map<string, string>()
  for (const s of items) {
    const label = statLabel(s.key, s.label)
    if (!seen.has(label)) seen.set(label, statMeaning(s.key, s.label))
  }
  if (seen.size === 0) return null
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-xs text-fs-muted-2 underline underline-offset-2 hover:text-fs-text"
      >
        {open ? 'Hide stat guide' : 'What do these abbreviations mean?'}
      </button>
      {open ? (
        <dl className="mt-2 rounded-lg px-3 py-2 text-xs space-y-1.5 fs-panel">
          {Array.from(seen.entries()).map(([label, meaning]) => (
            <div key={label} className="flex gap-2">
              <dt className="font-bold text-fs-text shrink-0 min-w-14">{label}</dt>
              <dd className="text-fs-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

/** Goalie-flavored categories — never the default for skaters. */
function isGoalieCategory(name: string): boolean {
  const n = name.toLowerCase().replace(/\s/g, '')
  return n === 'goaltending' || n === 'goalie'
}

/** Most relevant category for the key-stats strip (passing for QBs, ...). */
function keyCategory(season: StatCategory[] | null, position: string | null): StatCategory | null {  if (!season || season.length === 0) return null
  const pos = (position ?? '').toUpperCase()
  const byName = (n: string) => season.find((c) => c.name.toLowerCase() === n)
  if (pos === 'QB') return byName('passing') ?? season[0]
  if (['RB', 'FB'].includes(pos)) return byName('rushing') ?? season[0]
  if (['WR', 'TE'].includes(pos)) return byName('receiving') ?? season[0]
  if (['P', 'SP', 'RP', 'CP'].includes(pos)) return byName('pitching') ?? season[0]
  if (pos === 'G') return byName('goaltending') ?? byName('goalie') ?? season[0]
  // NHL skaters: default to offensive output, never goalie stats (ESPN can
  // list a goalie-flavored "defensive" category first for centers).
  if (['C', 'LW', 'RW', 'D'].includes(pos)) {
    return (
      byName('offensive') ??
      season.find((c) => c.name.toLowerCase() !== 'general' && !isGoalieCategory(c.name)) ??
      season[0]
    )
  }
  return season.find((c) => c.name.toLowerCase() !== 'general') ?? season[0]
}

/** Order leftover categories so position-relevant ones sort first. */
const CATEGORY_RELEVANCE: Record<string, string[]> = {
  QB: ['passing', 'rushing', 'general'],
  RB: ['rushing', 'receiving', 'general'],
  FB: ['rushing', 'receiving', 'general'],
  WR: ['receiving', 'rushing', 'general'],
  TE: ['receiving', 'general'],
  C: ['offensive', 'general', 'defensive'],
  LW: ['offensive', 'general', 'defensive'],
  RW: ['offensive', 'general', 'defensive'],
  D: ['offensive', 'defensive', 'general'],
  G: ['goaltending', 'goalie', 'general'],
}

function relevanceRank(position: string | null, name: string): number {
  const order = CATEGORY_RELEVANCE[(position ?? '').toUpperCase()] ?? []
  const i = order.indexOf(name.toLowerCase().replace(/\s/g, ''))
  return i === -1 ? order.length : i
}

function RelatedStories({ name }: { name: string }) {
  const [stories, setStories] = useState<{ title: string; url: string; source: string }[]>([])
  useEffect(() => {
    let cancelled = false
    const last = name.split(' ').slice(-1)[0]
    if (last.length < 4) return
    fetch('/api/top-stories?limit=30&ranking=balanced')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return
        const hits = (json.stories ?? [])
          .filter((s: any) => `${s.title} ${s.snippet}`.toLowerCase().includes(last.toLowerCase()))
          .slice(0, 5)
        setStories(hits)
      })
      .catch((err) => { console.debug('[related-stories] fetch failed', err) })
    return () => {
      cancelled = true
    }
  }, [name])
  if (stories.length === 0) return null
  return (
    <section aria-label="Related stories">
      <h2 className="fs-title text-xl mb-4">Related Stories</h2>
      <div className="space-y-2.5">
        {stories.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="fs-panel block p-4 transition hover:brightness-125">
            <p className="text-[15px] font-semibold leading-snug text-white/90">{s.title}</p>
            <p className="fs-meta mt-1.5">{s.source}</p>
          </a>
        ))}
      </div>
    </section>
  )
}

export function PlayerView({ sportParam, playerId }: { sportParam: string; playerId: string }) {
  const sport = normalizeSportKey(sportParam)
  const config = sport ? sportConfig[sport] : undefined

  const [data, setData] = useState<PlayerPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sport || !playerId) return
    let cancelled = false
    fetch(`/api/player?sport=${sport}&id=${encodeURIComponent(playerId)}`)
      .then((r) => {
        if (r.status === 404) throw new Error('Player not found')
        if (!r.ok) throw new Error(`Player API returned ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load player')
      })
    return () => {
      cancelled = true
    }
  }, [sport, playerId])

  useEffect(() => {
    if (data?.player.name) document.title = `${data.player.name} - Fanspot`
  }, [data?.player.name])

  const seasonCats = data?.season?.categories ?? null
  const keyCat = useMemo(() => {
    const fromSeason = keyCategory(seasonCats, data?.player.position ?? null)
    if (fromSeason) return fromSeason
    return null
  }, [seasonCats, data?.player.position])

  if (!sport || !config) {
    return (
      <div className="min-h-screen fs-page flex items-center justify-center">
        <div className="text-center">
          <h1 className="fs-title text-2xl text-fs-muted mb-4">Sport not found</h1>
          <Link href="/" className="fs-meta hover:text-fs-text">&larr; All Leagues</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}1c` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link
          href={data?.player.teamHref ?? `/${sportParam}`}
          className="fs-meta hover:text-fs-text inline-block mb-4"
        >
          &larr; {data?.player.teamName ?? config.name}
        </Link>
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setError(null)
              setData(null)
              fetch(`/api/player?sport=${sport}&id=${encodeURIComponent(playerId)}`)
                .then((r) => {
                  if (!r.ok) throw new Error(`Player API returned ${r.status}`)
                  return r.json()
                })
                .then(setData)
                .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load player'))
            }}
          />
        ) : !data ? (
          <div className="space-y-4">
            <div className="fs-skeleton h-36 rounded-xl" />
            <div className="fs-skeleton h-64 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header: identity and bio sit side-by-side on desktop */}
            <div className="fs-panel p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="flex items-start gap-4 sm:gap-5">
                <span className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-fs-panel-2 border border-fs-line-strong overflow-hidden shrink-0 flex items-center justify-center">
                  {data.player.headshot ? (
                    <img src={data.player.headshot} alt={`${data.player.name} headshot`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="fs-title text-2xl text-fs-muted-2">
                      {data.player.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="fs-eyebrow mb-1" style={{ '--tint': config.color } as React.CSSProperties}>
                    {data.player.position ?? sport}
                    {data.player.jersey ? ` · #${data.player.jersey}` : ''}
                  </p>
                  <h1 className="fs-title text-3xl sm:text-4xl leading-none">{data.player.name}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                    {data.player.teamHref && data.player.teamName ? (
                      <Link href={data.player.teamHref} className="text-sm font-semibold text-fs-text hover:underline underline-offset-2">
                        {data.player.teamName}
                      </Link>
                    ) : data.player.teamName ? (
                      <span className="text-sm font-semibold">{data.player.teamName}</span>
                    ) : null}
                    {data.player.status && <span className="fs-meta">{data.player.status}</span>}
                  </div>
                  <div className="mt-3">
                    <FavoriteButton
                      favorite={{
                        kind: 'player',
                        sport,
                        playerId: data.player.id,
                        name: data.player.name,
                        teamAbbr: data.player.teamAbbr,
                      }}
                    />
                  </div>
                </div>
              </div>
              {(data.player.age || data.player.height || data.player.weight || data.player.birthplace || data.player.draft || data.player.experience != null) && (
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 mt-5 pt-4 border-t border-fs-line lg:mt-0 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-6 lg:w-[34rem] lg:shrink-0">
                  {[
                    ['Age', data.player.age],
                    ['Height', data.player.height],
                    ['Weight', data.player.weight],
                    ['Born', data.player.birthplace],
                    ['Draft', data.player.draft],
                    ['Exp', data.player.experience != null ? `${data.player.experience} yrs` : null],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label}>
                        <dt className="fs-meta">{label}</dt>
                        <dd className="text-sm mt-0.5 truncate" title={value}>{value}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              )}
              </div>
            </div>

            {/* Body: two columns on desktop so the long player page reads horizontally */}
            <div className="grid gap-6 lg:grid-cols-12 items-start">
              <div className="lg:col-span-7 min-w-0 space-y-6">

            {/* Key stats */}
            {keyCat && data.season ? (
              <section aria-label="Key stats">
                <h2 className="fs-title text-xl mb-4">
                  {data.season.year} Stats · {keyCat.label}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {keyCat.stats.slice(0, 12).map((s) => (
                    <div key={s.key} className="fs-panel p-3 text-center" title={statMeaning(s.key, s.label)}>
                      <p className="fs-mono text-lg font-bold tabular-nums">{s.value}</p>
                      <p className="fs-meta mt-1 truncate" title={s.label}>{statLabel(s.key, s.label)}</p>
                    </div>
                  ))}
                </div>
                <StatGuide items={keyCat.stats.slice(0, 12)} />
              </section>
            ) : (
              <EmptyState title="Season stats unavailable for this player yet." hint="Past seasons live below." />
            )}

            {/* Full season tables */}
            {seasonCats && seasonCats.length > 1 && (
              <section aria-label="Full season stats">
                <h2 className="fs-title text-xl mb-4">All Categories</h2>
                <div className="grid gap-4 md:grid-cols-2 items-start">
                  {seasonCats
                    .filter((c) => c !== keyCat)
                    .sort((a, b) => relevanceRank(data.player.position, a.name) - relevanceRank(data.player.position, b.name))
                    .map((cat) => (
                      <div key={cat.name} className="fs-panel p-4">
                        <h3 className="fs-title text-base mb-3">{cat.label}</h3>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                          {cat.stats.map((s) => (
                            <div key={s.key} className="flex items-baseline justify-between gap-2 border-b border-fs-line py-1" title={statMeaning(s.key, s.label)}>
                              <dt className="fs-meta truncate">{statLabel(s.key, s.label)}</dt>
                              <dd className="fs-mono text-sm tabular-nums shrink-0">{s.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                </div>
                {seasonCats ? <StatGuide items={seasonCats.flatMap((c) => c.stats)} /> : null}
              </section>
            )}

            {/* Past seasons — lives in the wide column so the table isn't squeezed */}
            {data.pastSeasons.length > 0 && data.headline.keys.length > 0 && (
              <section aria-label="Past seasons">
                <h2 className="fs-title text-xl mb-4">Past Seasons</h2>
                <div className="fs-panel overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead>
                        <tr className="border-b border-fs-line">
                          <th scope="col" className="text-left fs-meta font-medium px-3 py-2">Season</th>
                          {data.headline.keys.slice(0, 6).map((s) => (
                            <th key={s.key} scope="col" className="text-right fs-meta font-medium px-2 py-2 tabular-nums" title={statMeaning(s.key, s.label)}>
                              {statLabel(s.key, s.label)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.pastSeasons.map((c) => (
                          <tr key={c.season} className="border-b border-fs-line last:border-0">
                            <td className="px-3 py-2 font-semibold">{c.season}</td>
                            {data.headline.keys.slice(0, 6).map((s) => (
                              <td key={s.key} className="text-right px-2 py-2 tabular-nums fs-mono text-[13px]">
                                {c.summary[s.key] ?? '–'}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr className="bg-white/[0.03]">
                          <td className="px-3 py-2 font-bold">
                            Total{data.careerSums.range ? ` ${data.careerSums.range[0]}–${data.careerSums.range[1]}` : ''}
                          </td>
                          {data.headline.keys.slice(0, 6).map((s) => (
                            <td key={s.key} className="text-right px-2 py-2 tabular-nums fs-mono text-[13px] font-bold">
                              {data.careerSums.sums[s.key] ?? '–'}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

              </div>
              <aside className="lg:col-span-5 min-w-0 space-y-6">

            {/* Career totals (separate section only when a season is also shown) */}
            {data.season && data.careerSums.range && Object.keys(data.careerSums.sums).length > 0 && (
              <section aria-label="Career totals">
                <h2 className="fs-title text-xl mb-4">
                  Career {data.careerSums.range[0] === data.careerSums.range[1] ? data.careerSums.range[0] : `${data.careerSums.range[0]}–${data.careerSums.range[1]}`}
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {(keyCat?.stats.slice(0, 12) ?? data.headline.keys.slice(0, 12)).map((s) => {
                    const value = data.careerSums.sums[s.key]
                    if (value == null) return null
                    return (
                      <div key={s.key} className="fs-panel-2 p-3 text-center">
                        <p className="fs-mono text-lg font-bold tabular-nums">{value}</p>
                        <p className="fs-meta mt-1 truncate" title={s.label}>{statLabel(s.key, s.label)}</p>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {sport === 'NFL' && (
              <div className="fs-panel p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="fs-title text-base">Fantasy & Props</h2>
                  <p className="fs-meta mt-1">Projections, draft prep, and model edges</p>
                </div>
                <Link href="/fantasy/nfl" className="fs-btn shrink-0">Open Fantasy →</Link>
              </div>
            )}

            <RelatedStories name={data.player.name} />
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
