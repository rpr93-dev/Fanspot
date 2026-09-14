'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { todayKey, SPORT_KEYS, type NormalizedGame } from '@/lib/models'
import { useFavorites } from '@/hooks/useFavorites'
import { favoriteTeamIds } from '@/lib/favorites'
import { ScoreCard } from '@/components/scoreboard/ScoreCard'
import { SectionHeader } from '@/components/feedback'

/**
 * For You: games involving favorite teams today (live first), plus a
 * favorites-aware news shortcut. Favorites prioritize — everything else
 * still shows below. Onboarding prompt when empty.
 */
export function ForYou() {
  const { favorites } = useFavorites()
  const [games, setGames] = useState<NormalizedGame[] | null>(null)

  const favAbbrs = new Set(
    favorites.filter((f) => f.kind === 'team').map((f) => (f.kind === 'team' ? f.abbr.toUpperCase() : '')),
  )
  const favIds = favoriteTeamIds(favorites)

  const load = useCallback(async () => {
    if (favAbbrs.size === 0) return
    try {
      const res = await fetch(`/api/scoreboard/multi?date=${todayKey()}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      const all: NormalizedGame[] = SPORT_KEYS.flatMap((s) => json?.leagues?.[s] ?? [])
      const mine = all.filter(
        (g) => favAbbrs.has(g.away.abbr.toUpperCase()) || favAbbrs.has(g.home.abbr.toUpperCase()),
      )
      const rank = (g: NormalizedGame) => (g.status.phase === 'live' ? 0 : g.status.phase === 'pre' ? 1 : 2)
      mine.sort(
        (a, b) => rank(a) - rank(b) || new Date(a.date).getTime() - new Date(b.date).getTime(),
      )
      setGames(mine)
    } catch {
      /* best-effort personalization; the rest of home still renders */
    }
  }, [favorites])

  // Load once per favorites change (no live poll: DaySnapshot polls already).
  useEffect(() => {
    load()
  }, [load])

  if (favorites.length === 0) {
    return (
      <section aria-label="For you" className="fs-panel p-5 sm:p-6">
        <SectionHeader eyebrow="Personalize" title="For You" />
        <p className="text-sm text-fs-muted mb-4 max-w-xl">
          Save your teams to float their games and stories to the top — scores,
          news, and this page reorder around them. No account, stored on this device.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/favorites" className="fs-btn">★ Choose teams</Link>
          <Link href="/search" className="fs-btn">⌕ Search</Link>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="For you">
      <SectionHeader
        eyebrow={`${favorites.length} saved`}
        title="For You"
        action={
          <Link href="/favorites" className="fs-meta hover:text-fs-text">
            Manage →
          </Link>
        }
      />
      {games === null ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="fs-skeleton h-36 w-56 sm:w-64 shrink-0" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <p className="text-sm text-fs-muted">
          None of your teams play today — check the league hubs or{' '}
          <Link href="/scores" className="underline underline-offset-2 hover:text-fs-text">
            pick another date
          </Link>
          .
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {games.slice(0, 8).map((g) => (
            <div key={`${g.sport}:${g.id}`} className="snap-start">
              <ScoreCard game={g} />
            </div>
          ))}
        </div>
      )}
      {favIds.size > 0 && (
        <p className="fs-meta mt-3">
          <Link href="/news" className="hover:text-fs-text">★ News about your teams →</Link>
        </p>
      )}
    </section>
  )
}
