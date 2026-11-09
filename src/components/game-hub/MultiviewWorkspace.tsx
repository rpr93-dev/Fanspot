'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MultiviewTile } from '@/components/multiview/MultiviewTile'
import { MultiviewPicker } from '@/components/multiview/MultiviewPicker'
import { ActiveGameStats } from './ActiveGameStats'
import { SectionHeader } from '@/components/feedback'
import {
  MULTIVIEW_LAYOUTS,
  MULTIVIEW_LAYOUT_LABELS,
  multiviewBoardClass,
  multiviewTileClass,
  type MultiviewLayout,
} from '@/lib/gameHub'
import { isRedzoneSlot, MAX_MULTIVIEW_SLOTS, slotKey, type MultiviewSlot } from '@/lib/multiview'
import type { NormalizedGame } from '@/lib/models'

/**
 * The Multiview board, shared by the Game Hub's Multiview mode and the
 * `/multiview` page. It reuses the existing split-screen tiles + picker (no
 * competing implementation): every tile keeps its player mounted, spotlight
 * only re-orders, and pausing unmounts just the player to silence audio.
 *
 * `hidden` keeps the whole board mounted while another mode is on stage, so
 * returning to Multiview never reloads a feed.
 */
export function MultiviewWorkspace({
  slots,
  onAdd,
  onRemove,
  clear,
  spotlight,
  onSpotlight,
  paused,
  onTogglePause,
  autoplay,
  onAutoplay,
  audioKey,
  onAudioKey,
  layout,
  onLayout,
  activeKey,
  onActive,
  hidden = false,
  standalone = false,
  extraActions,
}: {
  slots: MultiviewSlot[]
  onAdd: (slot: MultiviewSlot) => void
  onRemove: (index: number) => void
  clear: () => void
  spotlight: number | null
  onSpotlight: (index: number | null) => void
  paused: Set<string>
  onTogglePause: (slot: MultiviewSlot) => void
  autoplay: boolean
  onAutoplay: (value: boolean) => void
  /** Slot key allowed to play audio; `null` = every screen (the default). */
  audioKey: string | null
  onAudioKey: (key: string | null) => void
  layout: MultiviewLayout
  onLayout: (layout: MultiviewLayout) => void
  activeKey: string | null
  onActive: (key: string | null) => void
  hidden?: boolean
  standalone?: boolean
  /** Extra toolbar actions (e.g. the standalone page's copy-link button). */
  extraActions?: ReactNode
}) {
  const effectiveSpotlight = spotlight != null && spotlight < slots.length ? spotlight : null

  // Every tile reports its live game here; the side column (scoreboard strip
  // + the stats panel's score header) reads the same objects the tiles show,
  // so all scores on the page always agree with one another.
  const [gamesByKey, setGamesByKey] = useState<Record<string, NormalizedGame>>({})
  const handleGame = useCallback((game: NormalizedGame, slot: MultiviewSlot) => {
    const key = slotKey(slot) // stable identity: setGamesByKey never resurfaces callbacks
    setGamesByKey((prev) => (prev[key] === game ? prev : { ...prev, [key]: game }))
  }, [])
  const knownKeys = useMemo(() => new Set(slots.map(slotKey)), [slots])
  const gamesView = useMemo(() => {
    const out: Record<string, NormalizedGame> = {}
    for (const key of knownKeys) if (gamesByKey[key]) out[key] = gamesByKey[key]
    return out
  }, [gamesByKey, knownKeys])

  // Keep the "stats for" selection pointing at a real tile.
  const activeSlot = useMemo(() => {
    const hit = slots.find((s) => slotKey(s) === activeKey)
    return hit ?? slots[0] ?? null
  }, [slots, activeKey])
  useEffect(() => {
    if (!activeSlot) {
      if (activeKey !== null) onActive(null)
      return
    }
    const key = slotKey(activeSlot)
    if (key !== activeKey) onActive(key)
  }, [activeSlot, activeKey, onActive])

  const chip = 'fs-chip'
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Multiview layout" className="inline-flex items-center gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60">
        {MULTIVIEW_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layout === l}
            onClick={() => onLayout(l)}
            title={
              l === 'auto'
                ? 'Auto — 2-up, 3-up (hero + two) or 4-up 2×2, one column on phones'
                : l === 'stack'
                  ? 'Stack — one screen per row'
                  : 'Focus — the first screen spans the full width'
            }
            className={`${chip} ${layout === l ? 'fs-chip-active' : ''}`}
          >
            {MULTIVIEW_LAYOUT_LABELS[l]}
          </button>
        ))}
      </div>

      {slots.length > 1 && (
        <div
          role="group"
          aria-label="Audio source"
          className="inline-flex items-center gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60"
        >
          <button
            type="button"
            aria-pressed={audioKey === null}
            onClick={() => onAudioKey(null)}
            title="Every screen plays its own audio"
            className={`${chip} ${audioKey === null ? 'fs-chip-active' : ''}`}
          >
            ♪ All
          </button>
          {slots.map((slot, i) => {
            const key = slotKey(slot)
            const on = audioKey === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => onAudioKey(key)}
                title={
                  on
                    ? `Screen ${i + 1} owns the audio — press ♪ All to hear every screen`
                    : `Hear screen ${i + 1} only (third-party embeds can’t be muted, so the others pause)`
                }
                className={`${chip} !px-3 ${on ? 'fs-chip-active !text-fs-turf' : ''}`}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
      )}

      {slots.length > 0 && (
        <>
          <button
            type="button"
            className="fs-btn"
            onClick={() => onAutoplay(!autoplay)}
            aria-pressed={autoplay}
            title="Start every screen's best feed at once"
          >
            {autoplay ? '⏸ Stop all' : '▶ Start all'}
          </button>
          <button
            type="button"
            className="fs-meta px-2 py-1 rounded-md hover:text-fs-text"
            onClick={() => {
              onSpotlight(null)
              clear()
            }}
          >
            Clear all
          </button>
        </>
      )}
      {extraActions}
    </div>
  )

  const board =
    slots.length === 0 ? (
      <div className="fs-panel p-6 sm:p-8">
        <h2 className="fs-title text-xl">Pick games to fill the wall</h2>
        <p className="text-sm text-fs-muted mt-2 max-w-xl leading-relaxed">
          Add up to {MAX_MULTIVIEW_SLOTS} screens — live games are listed first. Try{' '}
          <span className="text-fs-text font-semibold">NFL RedZone + your team</span>, two Sunday
          games side by side, or football next to basketball.
        </p>
        <p className="fs-meta mt-3">
          Streams are third-party embeds — each screen starts on click so you control which feeds
          play audio.
        </p>
      </div>
    ) : (
      <div
        className={
          effectiveSpotlight != null ? 'grid gap-3 grid-cols-1' : multiviewBoardClass(slots.length, layout)
        }
      >
        {slots.map((slot, i) => {
          const key = slotKey(slot)
          const audioFocused = audioKey === key
          return (
            <div
              key={key}
              className={`min-w-0 ${effectiveSpotlight != null ? '' : multiviewTileClass(slots.length, i, layout)}`}
            >
              <MultiviewTile
                slot={slot}
                autoplay={autoplay}
                paused={paused.has(key)}
                audioFocused={audioFocused}
                mutedByAudio={audioKey !== null && !audioFocused}
                spotlighted={effectiveSpotlight === i}
                canSpotlight={slots.length > 1}
                active={activeSlot ? slotKey(activeSlot) === key : false}
                onGame={handleGame}
                onSelectActive={() => onActive(key)}
                onSelectAudio={() => onAudioKey(key)}
                onTogglePause={() => onTogglePause(slot)}
                onToggleSpotlight={() => onSpotlight(effectiveSpotlight === i ? null : i)}
                onRemove={() => onRemove(i)}
              />
            </div>
          )
        })}
      </div>
    )

  const sideColumn = (
    <div className="min-w-0 space-y-4">
      {/* Live scoreboard for EVERY game on the wall — tap a row to point the
          statistics below at that game. RedZone rows are shown but can't take
          stats (there is no box score for a channel). */}
      {slots.length > 0 && (
        <section aria-label="Games on the wall" className="fs-panel p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
            <h2 className="fs-title text-base">On the wall</h2>
            <span className="fs-meta">tap a game for its stats</span>
          </div>
          <ul role="radiogroup" aria-label="Choose statistics source" className="divide-y divide-fs-line/60 -my-1">
            {slots.map((slot, i) => {
              const key = slotKey(slot)
              const isRz = isRedzoneSlot(slot)
              const game = gamesView[key]
              const selected = activeSlot ? slotKey(activeSlot) === key : false
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={isRz}
                    onClick={() => onActive(key)}
                    className={`flex w-full items-center gap-2 px-1 py-2 text-left min-w-0 transition-colors ${
                      selected ? 'text-fs-text' : 'text-fs-muted hover:text-fs-text/85'
                    } ${isRz ? 'cursor-default opacity-80' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${selected ? 'bg-fs-turf' : 'bg-transparent'}`}
                    />
                    {isRz ? (
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">NFL RedZone</span>
                    ) : !game ? (
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {slot.sport.toUpperCase()} · screen {i + 1}
                      </span>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 flex items-center gap-1 truncate text-sm">
                          <span className="truncate">{game.away.abbr}</span>
                          <span className="fs-mono font-bold tabular-nums">{game.away.scoreDisplay || '–'}</span>
                          <span className="text-fs-muted-2">–</span>
                          <span className="fs-mono font-bold tabular-nums">{game.home.scoreDisplay || '–'}</span>
                          <span className="truncate">{game.home.abbr}</span>
                        </span>
                        <span className="shrink-0 fs-meta tabular-nums">
                          {game.status.shortDetail || game.status.detail || ''}
                        </span>
                      </>
                    )}
                    {!isRz && (
                      <span className="fs-meta shrink-0 tabular-nums" aria-hidden="true">
                        {i + 1}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {activeSlot && !isRedzoneSlot(activeSlot) && (
        <section aria-label="Active game statistics" className="fs-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-3">
            <h2 className="fs-title text-base">Statistics</h2>
            <span className="fs-meta">
              {activeSlot.sport.toUpperCase()} · screen {slots.indexOf(activeSlot) + 1} of{' '}
              {slots.length}
            </span>
          </div>
          <ActiveGameStats slot={activeSlot} game={gamesView[slotKey(activeSlot)] ?? null} />
        </section>
      )}
      <MultiviewPicker slots={slots} onAdd={onAdd} />
    </div>
  )

  return (
    <div className={hidden ? 'hidden' : ''} data-testid="multiview-workspace" aria-hidden={hidden || undefined}>
      {standalone && (
        <SectionHeader
          as="h1"
          eyebrow="Watch"
          title="Split screen"
          description={`Up to ${MAX_MULTIVIEW_SLOTS} games side by side — any mix of NFL, NBA, NHL, MLB and NFL RedZone. Each screen plays its own feed.`}
          action={toolbar}
        />
      )}
      {!standalone && <div className="mb-4">{toolbar}</div>}

      {slots.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
          {board}
          <MultiviewPicker slots={slots} onAdd={onAdd} />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
          <div className="min-w-0">{board}</div>
          <div className="min-w-0 xl:sticky xl:top-20">{sideColumn}</div>
        </div>
      )}
    </div>
  )
}
