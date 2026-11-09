'use client'
import { apiFetch } from '@/lib/api-base'

import { useCallback, useEffect, useState } from 'react'
import { LinescoreTable } from '@/components/game/PlayerBoxScore'
import { HeadToHeadTable, TeamComparisonHeader } from '@/components/box-score/GameStatsSection'
import { EmptyState, ErrorState } from '@/components/feedback'
import { useLivePoll } from '@/hooks/useLivePoll'
import { normalizeSportKey, type NormalizedGame } from '@/lib/models'
import type { MultiviewSlot } from '@/lib/multiview'

/**
 * Statistics for the game selected as "active" in Multiview mode. Loads the
 * same `/api/box-score` payload the Game Hub uses and renders the existing
 * `LinescoreTable` + the compact `HeadToHeadTable`, so no data path is
 * duplicated — Multiview just points the reader at another game.
 *
 * The score header shows the tile's OWN live game state (`game`), not a
 * second fetch — the game card above and this panel always quote the same
 * score/clock from one source; the box score only feeds the stat rows.
 */
export function ActiveGameStats({
  slot,
  game,
}: {
  slot: MultiviewSlot
  /** The selected tile's normalized game (single source for score/clock). */
  game?: NormalizedGame | null
}) {
  const sportKey = normalizeSportKey(slot.sport)
  const [boxScore, setBoxScore] = useState<any>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/box-score?sport=${slot.sport.toUpperCase()}&eventId=${encodeURIComponent(slot.eventId)}`,
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

  // Single score/clock source: the tile's game. Fall back to the box score's
  // own values when the tile feed hasn't loaded yet (or lagged behind).
  const live = game?.status.phase === 'live'
  const fallbackScore = (s: any): string | null => {
    const v = typeof s === 'object' ? s?.displayValue : s
    return v == null || v === '' ? null : String(v)
  }
  const awayScore = game?.away.scoreDisplay || fallbackScore(away.score) || '–'
  const homeScore = game?.home.scoreDisplay || fallbackScore(home.score) || '–'
  const statusText =
    game?.status.phase === 'pre'
      ? game.status.shortDetail
      : (game?.status.shortDetail ??
        boxScore.status?.shortDetail ??
        boxScore.status?.detail ??
        null)

  return (
    <div className="min-w-0 space-y-4">
      <TeamComparisonHeader
        away={away}
        home={home}
        awayScore={awayScore}
        homeScore={homeScore}
        statusText={statusText}
        live={live}
      />
      <LinescoreTable
        sport={sportKey}
        away={away ? { abbreviation: away.abbreviation, linescores: away.linescores, homeAway: 'away' } : null}
        home={home ? { abbreviation: home.abbreviation, linescores: home.linescores, homeAway: 'home' } : null}
      />
      <HeadToHeadTable away={away} home={home} sport={slot.sport.toUpperCase()} />
    </div>
  )
}
