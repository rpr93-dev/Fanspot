'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import {
  relevanceSort,
  todayKey,
  SPORT_KEYS,
  type NormalizedGame,
} from '@/lib/models'
import { useFavorites } from '@/hooks/useFavorites'
import { useLivePoll } from '@/hooks/useLivePoll'
import { ScoreCard } from '@/components/scoreboard/ScoreCard'
import { SectionHeader, EmptyState } from '@/components/feedback'

/**
 * "What's happening" snapshot: Live Now / Upcoming / Recent Finals from a
 * single multi-league board fetch. Favorites float to the top of each group.
 */
export function DaySnapshot() {
  const [games, setGames] = useState<NormalizedGame[] | null>(null)
  const [failed, setFailed] = useState(false)
  const { favoriteAbbrs, hydrated } = useFavorites()
  const boost = hydrated ? favoriteAbbrs : undefined

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scoreboard/multi?date=${todayKey()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`board returned ${res.status}`)
      const json = await res.json()
      const all: NormalizedGame[] = SPORT_KEYS.flatMap((s) => json?.leagues?.[s] ?? [])
      setGames(all)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useLivePoll(
    load,
    () => {
      if (!games) return 30_000
      if (games.some((g) => g.status.phase === 'live')) return 30_000
      return 5 * 60_000
    },
    [load, games != null],
  )

  if (failed && !games) return null
  if (!games) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fs-skeleton h-36" />
        ))}
      </div>
    )
  }

  const live = relevanceSort(games.filter((g) => g.status.phase === 'live'), boost)
  const upcoming = relevanceSort(games.filter((g) => g.status.phase === 'pre'), boost).slice(0, 6)
  const finals = relevanceSort(games.filter((g) => g.status.phase === 'final'), boost).slice(0, 6)

  const rail = (list: NormalizedGame[], empty: string) =>
    list.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {list.map((g) => (
          <div key={`${g.sport}:${g.id}`} className="snap-start">
            <ScoreCard game={g} />
          </div>
        ))}
      </div>
    )

  return (
    <div className="space-y-8">
      <section aria-label="Live now">
        <SectionHeader
          eyebrow="Happening now"
          title="Live Now"
          action={
            live.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
                <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
                {live.length} LIVE
              </span>
            ) : undefined
          }
        />
        {rail(live, 'No games live right now.')}
      </section>

      <section aria-label="Upcoming">
        <SectionHeader
          eyebrow="Later today"
          title="Upcoming"
          action={
            <Link href="/scores" className="fs-meta hover:text-fs-text">
              All scores →
            </Link>
          }
        />
        {rail(upcoming, 'No more games today.')}
      </section>

      <section aria-label="Recent finals">
        <SectionHeader eyebrow="Today" title="Recent Finals" />
        {rail(finals, 'No finals yet today.')}
      </section>
    </div>
  )
}
