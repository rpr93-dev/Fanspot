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
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wider uppercase transition ${
              filter === f ? 'bg-white/90 text-slate-900' : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
            style={{ fontFamily: 'var(--font-mono-data), monospace' }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-white/5" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-gray-500 py-10 text-center">{error}</p>
      )}

      {!loading && !error && shown.length === 0 && (
        <p className="text-sm text-gray-500 py-10 text-center">No stories for this league right now.</p>
      )}

      <div className="space-y-2.5">
        {shown.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl p-4 transition hover:bg-white/[0.07]"
            style={{
              backgroundColor: `${LEAGUE_COLORS[s.league]}14`,
              border: `1px solid ${LEAGUE_COLORS[s.league]}28`,
            }}
          >
            <div className="flex items-start gap-3">
              <span
                className="text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0 mt-0.5 text-white/70 bg-white/10"
                style={{ fontFamily: 'var(--font-mono-data), monospace' }}
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
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{s.snippet}</p>
                )}
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500 uppercase tracking-wider"
                  style={{ fontFamily: 'var(--font-mono-data), monospace' }}
                >
                  <span>{s.source}</span>
                  {relativeTime(s.publishedAt) && <span>{relativeTime(s.publishedAt)}</span>}
                  {s.drivers.length > 0 && (
                    <span className="text-gray-600">why: {s.drivers.slice(0, 2).join(' · ')}</span>
                  )}
                </div>
              </div>
              <span
                className="text-xs text-gray-600 shrink-0 tabular-nums"
                style={{ fontFamily: 'var(--font-mono-data), monospace' }}
                title="Significance score: event type, player recognition and source prominence. Recency is only a tiebreaker."
              >
                {s.significance}
              </span>
            </div>
          </a>
        ))}
      </div>

      {!loading && !error && stories.length > 0 && (
        <p
          className="text-[10px] text-gray-600 mt-6 text-center uppercase tracking-wider"
          style={{ fontFamily: 'var(--font-mono-data), monospace' }}
        >
          Ranked by significance, not recency
        </p>
      )}
    </div>
  )
}
