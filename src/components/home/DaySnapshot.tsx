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
import { HorizontalRail } from '@/components/HorizontalRail'
import { useF1Sessions, F1SessionCard } from '@/components/f1/F1SessionsBoard'
import { RedzoneCard } from '@/components/streams/RedzoneBoard'
import { SectionHeader, EmptyState, ErrorState } from '@/components/feedback'

/**
 * "What's happening" snapshot: Live Now / Upcoming / Recent Finals from a
 * single multi-league board fetch. Favorites float to the top of each group.
 */
export function DaySnapshot() {
  const [games, setGames] = useState<NormalizedGame[] | null>(null)
  const [failed, setFailed] = useState(false)
  const { favoriteAbbrs, hydrated } = useFavorites()
  const boost = hydrated ? favoriteAbbrs : undefined
  // F1 sessions (practice / sprint / quali / race) run independently of the
  // ESPN team-sport board, so they're surfaced here in Live Now + Upcoming.
  const f1 = useF1Sessions()
  const f1Live = (f1 ?? []).filter((s) => s.state === 'live')
  const f1Upcoming = (f1 ?? []).filter((s) => s.state === 'upcoming').slice(0, 3)

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

  if (!games) {
    if (failed) {
      return <ErrorState message="Couldn't load today's games right now." onRetry={() => void load()} />
    }
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fs-skeleton h-28" />
        ))}
      </div>
    )
  }

  const live = relevanceSort(games.filter((g) => g.status.phase === 'live'), boost)
  const upcoming = relevanceSort(games.filter((g) => g.status.phase === 'pre'), boost).slice(0, 6)
  // F1 races are covered by the session countdown below, not the Finals rail.
  const finals = relevanceSort(games.filter((g) => g.status.phase === 'final' && g.sport !== 'F1'), boost).slice(0, 6)

  const rail = (list: NormalizedGame[], empty: string, label: string, wrap = false) =>
    list.length === 0 ? (
      <EmptyState title={empty} />
    ) : wrap ? (
      <div className="flex flex-wrap gap-3">
        {list.map((g) => (
          <div key={`${g.sport}:${g.id}`}>
            <ScoreCard game={g} />
          </div>
        ))}
      </div>
    ) : (
      <HorizontalRail ariaLabel={label}>
        {list.map((g) => (
          <div key={`${g.sport}:${g.id}`} role="listitem">
            <ScoreCard game={g} />
          </div>
        ))}
      </HorizontalRail>
    )

  return (
    <div className="space-y-8 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
      <section aria-label="Live now">
        <SectionHeader
          eyebrow="Happening now"
          title="Live Now"
          action={
            live.length + f1Live.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
                <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
                {live.length + f1Live.length} LIVE
              </span>
            ) : undefined
          }
        />
        {f1Live.length > 0 ? (
          <div className="flex flex-wrap gap-3 mb-3">
            {f1Live.map((s) => (
              <F1SessionCard key={s.id} session={s} className="w-full" />
            ))}
          </div>
        ) : null}
        {/* NFL RedZone surfaces only while Sunday games are actually live. */}
        <RedzoneCard className="mb-3" />
        {rail(live, 'No games live right now.', 'Live now', true)}
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
        {f1Upcoming.length > 0 ? (
          <div className="flex flex-wrap gap-3 mb-3">
            {f1Upcoming.map((s) => (
              <F1SessionCard key={s.id} session={s} className="w-full" />
            ))}
          </div>
        ) : null}
        {rail(upcoming, 'No more games today.', 'Upcoming today', true)}
      </section>

      <section aria-label="Recent finals">
        <SectionHeader eyebrow="Today" title="Recent Finals" />
        {rail(finals, 'No finals yet today.', 'Recent finals')}
      </section>
    </div>
  )
}
