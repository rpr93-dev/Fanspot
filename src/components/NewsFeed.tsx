'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { teams, sportPath } from '@/data/teams'
import { useFavorites } from '@/hooks/useFavorites'
import { favoriteTeamIds } from '@/lib/favorites'
import { ErrorState } from '@/components/feedback'

type League = 'nfl' | 'nba' | 'nhl' | 'mlb' | 'f1'

export interface FeedStory {
  title: string
  url: string
  source: string
  league: League
  publishedAt: string | null
  snippet: string
  significance: number
  drivers: string[]
  teamIds: string[]
}

const LEAGUE_COLORS: Record<League, string> = {
  nfl: '#013369',
  nba: '#C9082A',
  nhl: '#003E7E',
  mlb: '#002D72',
  f1: '#E10600',
}

const LEAGUE_LABELS: Record<League, string> = {
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
  mlb: 'MLB',
  f1: 'F1',
}

const FILTERS: ('foryou' | 'all' | League)[] = ['foryou', 'all', 'nfl', 'nba', 'nhl', 'mlb', 'f1']

function relativeTime(iso: string | null, now: number | null): string {
  if (!iso || now == null) return ''
  const mins = Math.round((now - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(mins) || mins < 0) return ''
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function teamHref(league: League, teamId: string): string | null {
  const t = teams.find((x) => x.id === teamId && x.sport === league.toUpperCase())
  if (!t) return null
  return `/${sportPath[t.sport]}/${t.id}`
}

function LeagueBadge({ league, solid = false }: { league: League; solid?: boolean }) {
  const color = LEAGUE_COLORS[league]
  if (solid) {
    return (
      <span
        className="text-[10px] font-black tracking-[0.14em] px-2 py-0.5 rounded-md shrink-0 text-white"
        style={{ backgroundColor: color }}
      >
        {LEAGUE_LABELS[league]}
      </span>
    )
  }
  return (
    <span className="text-xs font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0 mt-0.5 fs-mono text-fs-muted border border-fs-line">
      {LEAGUE_LABELS[league]}
    </span>
  )
}

function TeamPills({ league, teamIds }: { league: League; teamIds: string[] }) {
  if (teamIds.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {teamIds.slice(0, 3).map((id) => {
        const href = teamHref(league, id)
        if (!href) return null
        const t = teams.find((x) => x.id === id)
        return (
          <Link
            key={id}
            href={href}
            className="fs-meta !text-[10px] px-2 py-0.5 rounded-full border border-fs-line-strong hover:text-fs-text hover:border-fs-muted"
          >
            {t?.abbreviation ?? id}
          </Link>
        )
      })}
    </span>
  )
}

/**
 * Shared sports news feed. Fetches significance- or recency-ranked stories,
 * filters by league, and boosts favorite teams ("For You") without hiding
 * everything else.
 */
export function NewsFeed({
  ranking = 'balanced',
  limit = 24,
  showScores = false,
  leagues,
  initialFilter = 'foryou',
  layout = 'list',
}: {
  ranking?: 'significance' | 'balanced'
  limit?: number
  showScores?: boolean
  leagues?: League[]
  initialFilter?: 'foryou' | 'all' | League
  /** 'grid' renders uniform tiles (homepage). 'list' renders a lead story + dense rows. */
  layout?: 'list' | 'grid'
}) {
  const [stories, setStories] = useState<FeedStory[]>([])
  const [filter, setFilter] = useState<'foryou' | 'all' | League>(initialFilter)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [emptyLeagues, setEmptyLeagues] = useState<string[]>([])
  const [now, setNow] = useState<number | null>(null)
  const { favorites, hydrated } = useFavorites()
  const favIds = useMemo(() => favoriteTeamIds(favorites), [favorites])
  const hasFavs = favIds.size > 0
  const scope = leagues && leagues.length > 0 ? [...leagues].sort().join(',') : ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(limit), ranking })
      if (scope) params.set('leagues', scope)
      const res = await fetch(`/api/top-stories?${params.toString()}`, {
        signal: AbortSignal.timeout(30000),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`)
      setStories(body.stories ?? [])
      setFetchedAt(body.fetchedAt ?? null)
      setEmptyLeagues(body.emptyLeagues ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stories')
    } finally {
      setLoading(false)
    }
  }, [limit, ranking, scope])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const effectiveFilter = filter === 'foryou' && !hasFavs ? 'all' : filter
  const visibleFilters = (leagues && leagues.length > 0
    ? (['all', ...leagues] as ('all' | League)[])
    : (FILTERS as ('foryou' | 'all' | League)[])
  ).filter((f) => f !== 'foryou' || hasFavs)
  const shown = useMemo(() => {
    if (effectiveFilter === 'all') return stories
    if (effectiveFilter === 'foryou') {
      return stories.filter((s) =>
        s.teamIds.some((id) => favIds.has(`${s.league.toUpperCase()}:${id}`)),
      )
    }
    return stories.filter((s) => s.league === effectiveFilter)
  }, [stories, effectiveFilter, favIds])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: stories.length }
    for (const s of stories) c[s.league] = (c[s.league] ?? 0) + 1
    return c
  }, [stories])

  const [lead, ...rest] = layout === 'list' && effectiveFilter !== 'foryou' ? shown : []
  const listStories = lead ? rest : shown

  return (
    <div>
      {hydrated ? (
      <div className="flex flex-wrap gap-1.5 mb-5 justify-start" role="group" aria-label="Story filter">
        {visibleFilters.map((f) => {
          const active = (filter === 'foryou' && !hasFavs ? 'all' : filter) === f
          const color = f === 'all' || f === 'foryou' ? null : LEAGUE_COLORS[f]
          const n = counts[f] ?? 0
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f)}
              className={`fs-chip inline-flex items-center gap-1.5 !border ${active ? '!text-white' : ''}`}
              style={
                active
                  ? {
                      backgroundColor: `${color ?? '#8a9990'}2e`,
                      borderColor: `${color ?? '#8a9990'}88`,
                    }
                  : {
                      borderColor: 'transparent',
                    }
              }
            >
              {color && (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
              )}
              {f === 'foryou' ? '★ For You' : f === 'all' ? 'All' : LEAGUE_LABELS[f]}
              {!loading && <span className="opacity-60 tabular-nums">{n}</span>}
            </button>
          )
        })}
      </div>
      ) : (
        <div className="h-[34px] mb-5" aria-hidden="true" />
      )}

      {loading && (
        layout === 'grid' ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 items-stretch" aria-hidden="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="fs-skeleton h-36" />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5" aria-hidden="true">
            <div className="fs-skeleton h-44" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="fs-skeleton h-20" />
            ))}
          </div>
        )
      )}

      {error && <div className="py-6"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!loading && !error && shown.length === 0 && (
        <p className="text-sm text-fs-muted py-10 text-center">
          {effectiveFilter === 'foryou'
            ? 'No stories about your favorites right now.'
            : 'No stories for this league right now.'}
        </p>
      )}

      {layout === 'grid' ? (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 items-stretch">
          {shown.map((s) => (
            <div
              key={s.url}
              className="fs-panel relative block p-4 transition hover:brightness-125 h-full"
              style={{ '--tint': LEAGUE_COLORS[s.league], '--tint-border': `${LEAGUE_COLORS[s.league]}2a` } as React.CSSProperties}
            >
              <div className="flex items-start gap-3">
                <LeagueBadge league={s.league} />
                <div className="min-w-0 flex-1 flex flex-col">
                  <h3
                    className="text-[17px] leading-snug text-white/90 font-semibold line-clamp-2 min-h-[2.75rem]"
                    style={{ fontFamily: 'var(--font-display), sans-serif' }}
                  >
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="after:absolute after:inset-0 after:content-['']"
                    >
                      {s.title}
                    </a>
                  </h3>
                  <p className="text-xs text-fs-muted mt-1 line-clamp-2 min-h-[2rem] leading-relaxed">
                    {s.snippet || ' '}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-fs-muted-2 uppercase tracking-wider fs-mono">
                    <span>{s.source}</span>
                    {relativeTime(s.publishedAt, now) && <span>{relativeTime(s.publishedAt, now)}</span>}
                    {showScores && s.drivers.length > 0 && (
                      <span className="text-fs-muted-2/70">why: {s.drivers.slice(0, 2).join(' · ')}</span>
                    )}
                  </div>
                  {s.teamIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-2 min-h-[1.5rem] relative z-10">
                      <TeamPills league={s.league} teamIds={s.teamIds} />
                    </div>
                  ) : (
                    <div aria-hidden="true" className="min-h-[1.5rem] mt-2" />
                  )}
                </div>
                {showScores && (
                  <span
                    className="text-xs text-fs-muted-2 shrink-0 tabular-nums fs-mono"
                    title="Significance score: event type, player recognition and source prominence. Recency is only a tiebreaker."
                  >
                    {s.significance}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {lead && (
            <div
              key={lead.url}
              className="fs-panel relative block overflow-hidden p-5 sm:p-6 transition hover:brightness-125"
              style={{ '--tint': LEAGUE_COLORS[lead.league], '--tint-border': `${LEAGUE_COLORS[lead.league]}55` } as React.CSSProperties}
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ backgroundColor: LEAGUE_COLORS[lead.league] }}
              />
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <span className="inline-flex items-center gap-2">
                  <LeagueBadge league={lead.league} solid />
                  <span className="fs-meta">Top story</span>
                </span>
                {relativeTime(lead.publishedAt, now) && (
                  <span className="fs-meta shrink-0">{relativeTime(lead.publishedAt, now)}</span>
                )}
              </div>
              <h3
                className="text-xl sm:text-2xl leading-tight text-white font-bold text-balance"
                style={{ fontFamily: 'var(--font-display), sans-serif' }}
              >
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="after:absolute after:inset-0 after:content-['']"
                >
                  {lead.title}
                </a>
              </h3>
              {lead.snippet && (
                <p className="text-sm text-fs-muted mt-2 line-clamp-2 leading-relaxed">{lead.snippet}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
                <span className="fs-meta !text-fs-muted">{lead.source}</span>
                <span className="ml-auto inline-flex items-center gap-2 relative z-10">
                  <TeamPills league={lead.league} teamIds={lead.teamIds} />
                  {showScores && (
                    <span
                      className="text-xs text-fs-muted-2 tabular-nums fs-mono"
                      title="Significance score: event type, player recognition and source prominence. Recency is only a tiebreaker."
                    >
                      {lead.significance}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
          <div className="grid gap-2.5 md:grid-cols-2">
          {listStories.map((s) => (
            <div
              key={s.url}
              className="fs-panel relative block overflow-hidden py-3 px-4 transition hover:brightness-125"
              style={{ '--tint-border': `${LEAGUE_COLORS[s.league]}44` } as React.CSSProperties}
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                style={{ backgroundColor: LEAGUE_COLORS[s.league] }}
              />
              <div className="flex items-center justify-between gap-3">
                <LeagueBadge league={s.league} solid />
                <span className="inline-flex items-center gap-2 shrink-0">
                  {showScores && (
                    <span
                      className="text-xs text-fs-muted-2 tabular-nums fs-mono"
                      title="Significance score: event type, player recognition and source prominence. Recency is only a tiebreaker."
                    >
                      {s.significance}
                    </span>
                  )}
                  {relativeTime(s.publishedAt, now) && (
                    <span className="fs-meta">{relativeTime(s.publishedAt, now)}</span>
                  )}
                </span>
              </div>
              <h3
                className="text-[16px] leading-snug text-white/90 font-semibold mt-1.5"
                style={{ fontFamily: 'var(--font-display), sans-serif' }}
              >
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="after:absolute after:inset-0 after:content-['']"
                >
                  {s.title}
                </a>
              </h3>
              {s.snippet && (
                <p className="text-xs text-fs-muted mt-1 line-clamp-2 leading-relaxed">{s.snippet}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5 relative z-10">
                <span className="fs-meta !text-fs-muted">{s.source}</span>
                <TeamPills league={s.league} teamIds={s.teamIds} />
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {!loading && !error && stories.length > 0 && (
        <p className="fs-meta mt-6 text-center">
          {ranking === 'balanced' ? 'Recency-weighted feed' : 'Ranked by significance, not recency'}
          {fetchedAt && relativeTime(fetchedAt, now) && ` · updated ${relativeTime(fetchedAt, now)}`}
          {emptyLeagues.length > 0 && ` · quiet right now: ${emptyLeagues.join(', ').toUpperCase()}`}
        </p>
      )}
    </div>
  )
}
