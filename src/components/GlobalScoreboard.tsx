'use client'

import { useCallback, useRef, useState } from 'react'
import {
  dayLabel,
  relevanceSort,
  shiftDateKey,
  todayKey,
  SPORT_KEYS,
  type NormalizedGame,
  type SportKey,
} from '@/lib/models'
import { useFavorites } from '@/hooks/useFavorites'
import { useLivePoll } from '@/hooks/useLivePoll'
import { ScoreCard } from './scoreboard/ScoreCard'
import { EmptyState, ErrorState } from './feedback'

const LEAGUE_ORDER: SportKey[] = ['NFL', 'NBA', 'NHL', 'MLB']

interface MultiResponse {
  date: string
  leagues: Record<string, NormalizedGame[]>
}

function gamesOf(data: MultiResponse | null, sport: SportKey): NormalizedGame[] {
  return data?.leagues?.[sport] ?? []
}

/**
 * Persistent global scoreboard: Yesterday | Today | Tomorrow + date picker,
 * one horizontally-scrollable rail per league. Clicking a game opens its
 * Game Center. Live games poll fast; historical dates are static.
 */
export function GlobalScoreboard({
  initialDateKey,
  sports = LEAGUE_ORDER,
  showDateNav = true,
}: {
  initialDateKey?: string
  sports?: SportKey[]
  showDateNav?: boolean
}) {
  const [dateKey, setDateKey] = useState(() => initialDateKey ?? todayKey())
  const [data, setData] = useState<MultiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { favoriteAbbrs, hydrated } = useFavorites()
  // Favorites boost ordering only after hydration so the first client
  // render matches SSR (avoids hydration mismatch, then re-sorts).
  const boost = hydrated ? favoriteAbbrs : undefined
  const dataRef = useRef<MultiResponse | null>(null)
  dataRef.current = data
  const dateRef = useRef(dateKey)
  dateRef.current = dateKey

  const load = useCallback(async () => {
    const key = dateRef.current
    try {
      const res = await fetch(
        `/api/scoreboard/multi?date=${key}&sports=${sports.join(',').toLowerCase()}`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`Scoreboard returned ${res.status}`)
      const json = (await res.json()) as MultiResponse
      // Drop stale responses from an in-flight date change.
      if (dateRef.current !== key) return
      setData(json)
      setError(null)
    } catch (err) {
      if (dateRef.current !== key) return
      setError(err instanceof Error ? err.message : 'Failed to load scores')
    } finally {
      if (dateRef.current === key) setLoading(false)
    }
  }, [sports.join(',')])

  useLivePoll(
    load,
    () => {
      if (dateRef.current !== todayKey()) return null
      const d = dataRef.current
      if (!d) return 30_000
      const games = SPORT_KEYS.flatMap((s) => gamesOf(d, s))
      const now = Date.now()
      if (games.some((g) => g.status.phase === 'live')) return 30_000
      if (
        games.some((g) => {
          const t = new Date(g.date).getTime()
          return Number.isFinite(t) && Math.abs(now - t) < 6 * 60 * 60 * 1000
        })
      ) {
        return 60_000
      }
      return 5 * 60_000
    },
    [load],
  )

  const pickDate = (key: string) => {
    if (key === dateKey) return
    dateRef.current = key
    setDateKey(key)
    setLoading(true)
    setError(null)
    void load()
  }

  const today = todayKey()
  const orderedSports = LEAGUE_ORDER.filter((s) => sports.includes(s))
  const totalLive = orderedSports.reduce(
    (n, s) => n + gamesOf(data, s).filter((g) => g.status.phase === 'live').length,
    0,
  )
  const totalGames = orderedSports.reduce((n, s) => n + gamesOf(data, s).length, 0)

  const toInputValue = (key: string) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

  return (
    <section aria-label="Scoreboard">
      {showDateNav && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60" role="tablist" aria-label="Date">
            {[
              { key: shiftDateKey(today, -1), label: 'Yesterday' },
              { key: today, label: 'Today' },
              { key: shiftDateKey(today, 1), label: 'Tomorrow' },
            ].map((d) => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={dateKey === d.key}
                onClick={() => pickDate(d.key)}
                className={`fs-chip ${dateKey === d.key ? 'fs-chip-active' : ''}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Choose a date"
            className="fs-input !w-auto text-xs"
            value={toInputValue(dateKey)}
            onChange={(e) => {
              const v = e.target.value.replace(/-/g, '')
              if (/^\d{8}$/.test(v)) pickDate(v)
            }}
          />
          {totalLive > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
              <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
              {totalLive} LIVE
            </span>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="fs-skeleton h-36 w-56 sm:w-64 shrink-0" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState message={`Couldn't load scores: ${error}`} onRetry={() => { setLoading(true); void load() }} />
      ) : totalGames === 0 ? (
        <EmptyState title={`No games scheduled for ${dayLabel(dateKey).toLowerCase()}.`} hint="Try another date" />
      ) : (
        <div className="space-y-4">
          {orderedSports.map((sport) => {
            const games = relevanceSort(gamesOf(data, sport), boost)
            if (games.length === 0) return null
            const live = games.filter((g) => g.status.phase === 'live').length
            return (
              <div key={sport}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="fs-meta">{sport}</span>
                  <span className="fs-meta opacity-60">
                    {games.length} game{games.length === 1 ? '' : 's'}
                  </span>
                  {live > 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-fs-red">
                      <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
                      {live} LIVE
                    </span>
                  )}
                </div>
                <div
                  className="flex gap-3 overflow-x-auto pb-2 snap-x"
                  role="list"
                  aria-label={`${sport} games for ${dayLabel(dateKey)}`}
                >
                  {games.map((g) => (
                    <div key={g.id} role="listitem" className="snap-start">
                      <ScoreCard game={g} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
