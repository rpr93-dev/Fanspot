'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRedzone } from '@/components/streams/RedzoneBoard'
import { EmptyState, ErrorState } from '@/components/feedback'
import { useLivePoll } from '@/hooks/useLivePoll'
import {
  SPORT_KEYS,
  formatTipoff,
  relevanceSort,
  todayKey,
  type NormalizedGame,
} from '@/lib/models'
import {
  MAX_MULTIVIEW_SLOTS,
  slotKey,
  type MultiviewSlot,
} from '@/lib/multiview'

/**
 * Game picker for split screen: today's cross-league board (live first) plus
 * the RedZone channel. Selected games render as pressed chips; adding is
 * disabled once the board is full.
 */
export function MultiviewPicker({
  slots,
  onAdd,
}: {
  slots: MultiviewSlot[]
  onAdd: (slot: MultiviewSlot) => void
}) {
  const [games, setGames] = useState<NormalizedGame[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState('')
  const rz = useRedzone()

  const load = useCallback(async () => {
    const res = await fetch(`/api/scoreboard/multi?date=${todayKey()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`board returned ${res.status}`)
    const json = await res.json()
    const all: NormalizedGame[] = SPORT_KEYS.flatMap((s) => json?.leagues?.[s] ?? [])
    setGames(all)
    setFailed(false)
  }, [])

  useEffect(() => {
    void load().catch(() => setFailed(true))
  }, [load])

  useLivePoll(load, () => 60_000, [load])

  const selected = useMemo(() => new Set(slots.map(slotKey)), [slots])
  const full = slots.length >= MAX_MULTIVIEW_SLOTS
  const q = filter.trim().toLowerCase()

  const ordered = useMemo(() => {
    const list = (games ?? []).filter((g) => g.sport !== 'F1')
    const rank = (g: NormalizedGame) => (g.status.phase === 'live' ? 0 : g.status.phase === 'pre' ? 1 : 2)
    const matching = q
      ? list.filter((g) =>
          `${g.away.name} ${g.home.name} ${g.away.abbr} ${g.home.abbr}`.toLowerCase().includes(q),
        )
      : list
    return relevanceSort([...matching].sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date)))
  }, [games, q])

  const redzoneSlot: MultiviewSlot = { sport: 'nfl', eventId: 'redzone' }
  const redzoneAdded = selected.has(slotKey(redzoneSlot))

  return (
    <section aria-label="Add games to split screen" className="fs-panel p-4 sm:p-5">
      <h2 className="fs-title text-lg">Add games</h2>
      <p className="fs-meta mt-1">
        {slots.length}/{MAX_MULTIVIEW_SLOTS} screens · live games first
      </p>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter teams…"
        aria-label="Filter games by team"
        className="fs-input mt-3 !py-1.5 text-sm w-full"
      />

      <div className="mt-3" role="group" aria-label="NFL RedZone channel">
        <button
          type="button"
          aria-pressed={redzoneAdded}
          disabled={(full && !redzoneAdded) || redzoneAdded}
          onClick={() => onAdd(redzoneSlot)}
          className={`fs-chip w-full justify-between ${redzoneAdded ? 'fs-chip-active' : ''}`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className="rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white shrink-0"
              style={{ backgroundColor: '#E01B2E' }}
            >
              RZ
            </span>
            <span className="truncate">NFL RedZone</span>
          </span>
          <span className="fs-meta shrink-0">
            {redzoneAdded ? '✓ added' : rz?.live ? '● live' : 'Sun PM'}
          </span>
        </button>
      </div>

      {failed ? (
        <div className="mt-3">
          <ErrorState message="Couldn't load today's games." onRetry={() => void load().catch(() => setFailed(true))} />
        </div>
      ) : games === null ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="fs-skeleton h-10" />
          <div className="fs-skeleton h-10" />
          <div className="fs-skeleton h-10" />
        </div>
      ) : ordered.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={q ? `No games match “${filter.trim()}”.` : 'No games on the board today.'} />
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5 max-h-[28rem] overflow-y-auto pr-1" aria-label="Today's games">
          {ordered.map((g) => {
            const slot: MultiviewSlot = { sport: g.sport.toLowerCase() as MultiviewSlot['sport'], eventId: g.id }
            // F1 is filtered above; guard the cast for any stragglers.
            if (g.sport === 'F1') return null
            const key = slotKey(slot)
            const added = selected.has(key)
            const status =
              g.status.phase === 'live'
                ? `${g.status.periodLabel ?? ''} ${g.status.clock ?? ''}`.trim() || 'LIVE'
                : g.status.phase === 'final'
                  ? 'Final'
                  : formatTipoff(g.date)
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={added}
                  disabled={(full && !added) || added}
                  onClick={() => onAdd(slot)}
                  className={`fs-chip w-full justify-between !py-2 ${added ? 'fs-chip-active' : ''}`}
                >
                  <span className="min-w-0 text-left">
                    <span className="block truncate font-semibold">
                      {g.away.abbr} @ {g.home.abbr}
                    </span>
                    <span className="fs-meta block truncate">
                      {g.sport} · {status}
                      {g.status.phase !== 'pre' && (g.away.scoreDisplay || g.home.scoreDisplay)
                        ? ` · ${g.away.scoreDisplay || '–'}–${g.home.scoreDisplay || '–'}`
                        : ''}
                    </span>
                  </span>
                  <span className="fs-meta shrink-0 pl-2">{added ? '✓ added' : g.status.phase === 'live' ? '● live' : '+'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {full && <p className="fs-meta mt-3">Board is full — remove a screen to add another.</p>}
    </section>
  )
}
