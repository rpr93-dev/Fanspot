'use client'

import { useCallback, useEffect, useState } from 'react'
import { LinescoreTable } from '@/components/game/PlayerBoxScore'
import { GameStatsSection } from '@/components/box-score/GameStatsSection'
import { EmptyState, ErrorState } from '@/components/feedback'
import { useLivePoll } from '@/hooks/useLivePoll'
import { normalizeSportKey } from '@/lib/models'
import type { MultiviewSlot } from '@/lib/multiview'

/**
 * Team-by-team statistics for the game selected as "active" in Multiview mode.
 * Loads the same `/api/box-score` payload the Game Hub uses and renders the
 * existing `LinescoreTable` + `GameStatsSection`, so no data path is
 * duplicated — Multiview just points the reader at another game.
 */
export function ActiveGameStats({ slot }: { slot: MultiviewSlot }) {
  const sportKey = normalizeSportKey(slot.sport)
  const [boxScore, setBoxScore] = useState<any>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/box-score?sport=${slot.sport.toUpperCase()}&eventId=${encodeURIComponent(slot.eventId)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`box score returned ${res.status}`)
    const json = await res.json()
    setBoxScore(json?.boxScore ?? null)
    setFailed(false)
  }, [slot.sport, slot.eventId])

  useEffect(() => {
    let cancelled = false
    setBoxScore(null)
    setFailed(false)
    load().catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useLivePoll(load, () => 20_000, [load])

  if (!sportKey) return <EmptyState title="Stats aren't available for this game." />
  if (failed) {
    return (
      <ErrorState
        message="Couldn't load this game's statistics."
        onRetry={() => void load().catch(() => setFailed(true))}
      />
    )
  }
  if (!boxScore) return <div className="fs-skeleton h-40" aria-hidden="true" />

  const bsTeams: any[] = boxScore.teams ?? []
  const away = bsTeams.find((t) => t.homeAway === 'away') ?? bsTeams[0] ?? null
  const home = bsTeams.find((t) => t.homeAway === 'home') ?? bsTeams[1] ?? null
  if (!away || !home) return <EmptyState title="Stats not yet available." />

  return (
    <div className="space-y-4">
      <LinescoreTable
        sport={sportKey}
        away={away ? { abbreviation: away.abbreviation, linescores: away.linescores, homeAway: 'away' } : null}
        home={home ? { abbreviation: home.abbreviation, linescores: home.linescores, homeAway: 'home' } : null}
      />
      <GameStatsSection
        away={away}
        home={home}
        status={boxScore.status ?? null}
        sport={slot.sport.toUpperCase()}
        lastPlay={boxScore.lastPlay ?? null}
      />
    </div>
  )
}
