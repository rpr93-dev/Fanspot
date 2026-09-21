'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { teams, sportPath } from '@/data/teams'
import { useFavorites } from '@/hooks/useFavorites'
import { favoriteTeamIds } from '@/lib/favorites'

type League = 'nfl' | 'nba' | 'nhl' | 'mlb'

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
}

const FILTERS: ('foryou' | 'all' | League)[] = ['foryou', 'all', 'nfl', 'nba', 'nhl', 'mlb']

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
  /** 'grid' renders stories two-up on wider screens (homepage). */
  layout?: 'list' | 'grid'
}) {
  const [stories, setStories] = useState<FeedStory[]>([])
  const [filter, setFilter] = useState<'foryou' | 'all' | League>(initialFilter)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const { favorites } = useFavorites()
  const favIds = useMemo(() => favoriteTeamIds(favorites), [favorites])
  const hasFavs = favIds.size > 0
  const scope = leagues && leagues.length > 0 ? [...leagues].sort().join(',') : ''

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const params = new URLSearchParams({ limit: String(limit), ranking })
        if (scope) params.set('leagues', scope)
        const res = await fetch(`/api/top-stories?${params.toString()}`, {
          signal: AbortSignal.timeout(30000),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`)
        if (!cancelled) setStories(body.stories ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stories')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [limit, ranking, scope])

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

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-6 justify-start" role="tablist" aria-label="Story filter">
        {visibleFilters.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={(filter === 'foryou' && !hasFavs ? 'all' : filter) === f}
            onClick={() => setFilter(f)}
            className={`fs-chip ${(filter === 'foryou' && !hasFavs ? 'all' : filter) === f ? 'fs-chip-active' : ''}`}
          >
            {f === 'foryou' ? '★ For You' : f}
          </button>
        ))}
      </div>

      {loading && (
        <div className={layout === 'grid' ? 'grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2.5'} aria-hidden="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="fs-skeleton h-20" />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-fs-muted py-10 text-center">{error}</p>}

      {!loading && !error && shown.length === 0 && (
        <p className="text-sm text-fs-muted py-10 text-center">
          {effectiveFilter === 'foryou'
            ? 'No stories about your favorites right now — showing everything instead.'
            : 'No stories for this league right now.'}
        </p>
      )}

      <div className={layout === 'grid' ? 'grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 items-start' : 'space-y-2.5'}>
        {shown.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="fs-panel block p-4 transition hover:brightness-125"
            style={{ '--tint': LEAGUE_COLORS[s.league], '--tint-border': `${LEAGUE_COLORS[s.league]}2a` } as React.CSSProperties}
          >
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0 mt-0.5 fs-mono text-fs-muted border border-fs-line">
                {s.league.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  className="text-[17px] leading-snug text-white/90 font-semibold"
                  style={{ fontFamily: 'var(--font-display), sans-serif' }}
                >
                  {s.title}
                </h3>
                {s.snippet && (
                  <p className="text-xs text-fs-muted mt-1 line-clamp-2 leading-relaxed">{s.snippet}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-fs-muted-2 uppercase tracking-wider fs-mono">
                  <span>{s.source}</span>
                  {relativeTime(s.publishedAt, now) && <span>{relativeTime(s.publishedAt, now)}</span>}
                  {showScores && s.drivers.length > 0 && (
                    <span className="text-fs-muted-2/70">why: {s.drivers.slice(0, 2).join(' · ')}</span>
                  )}
                </div>
                {s.teamIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                    {s.teamIds.slice(0, 3).map((id) => {
                      const href = teamHref(s.league, id)
                      if (!href) return null
                      const t = teams.find((x) => x.id === id)
                      return (
                        <Link
                          key={id}
                          href={href}
                          className="fs-meta !text-[10px] px-2 py-0.5 rounded-full border border-fs-line-strong hover:text-fs-text hover:border-fs-muted"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t?.abbreviation ?? id}
                        </Link>
                      )
                    })}
                  </div>
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
          </a>
        ))}
      </div>

      {!loading && !error && stories.length > 0 && (
        <p className="fs-meta mt-6 text-center">
          {ranking === 'balanced' ? 'Recency-weighted feed' : 'Ranked by significance, not recency'}
        </p>
      )}
    </div>
  )
}
