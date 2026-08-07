'use client'

import { useState, useEffect } from 'react'

type League = 'nfl' | 'nba' | 'nhl' | 'mlb'

interface Story {
  title: string
  url: string
  source: string
  league: League
  publishedAt: string | null
  snippet: string
  significance: number
  drivers: string[]
}

const LEAGUE_COLORS: Record<League, string> = {
  nfl: '#013369',
  nba: '#C9082A',
  nhl: '#003E7E',
  mlb: '#002D72',
}

const FILTERS: ('all' | League)[] = ['all', 'nfl', 'nba', 'nhl', 'mlb']

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(mins) || mins < 0) return ''
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function BiggestStories() {
  const [stories, setStories] = useState<Story[]>([])
  const [filter, setFilter] = useState<'all' | League>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/top-stories?limit=24', { signal: AbortSignal.timeout(30000) })
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
  }, [])

  const shown = filter === 'all' ? stories : stories.filter((s) => s.league === filter)

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-6 justify-center">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`fs-chip ${filter === f ? 'fs-chip-active' : ''}`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="fs-skeleton h-20" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-fs-muted py-10 text-center">{error}</p>
      )}

      {!loading && !error && shown.length === 0 && (
        <p className="text-sm text-fs-muted py-10 text-center">No stories for this league right now.</p>
      )}

      <div className="space-y-2.5">
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
              <span
                className="text-xs font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0 mt-0.5 fs-mono text-fs-muted border border-fs-line"
              >
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
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-fs-muted-2 uppercase tracking-wider fs-mono"
                >
                  <span>{s.source}</span>
                  {relativeTime(s.publishedAt) && <span>{relativeTime(s.publishedAt)}</span>}
                  {s.drivers.length > 0 && (
                    <span className="text-fs-muted-2/70">why: {s.drivers.slice(0, 2).join(' · ')}</span>
                  )}
                </div>
              </div>
              <span
                className="text-xs text-fs-muted-2 shrink-0 tabular-nums fs-mono"
                title="Significance score: event type, player recognition and source prominence. Recency is only a tiebreaker."
              >
                {s.significance}
              </span>
            </div>
          </a>
        ))}
      </div>

      {!loading && !error && stories.length > 0 && (
        <p className="fs-meta mt-6 text-center">
          Ranked by significance, not recency
        </p>
      )}
    </div>
  )
}
