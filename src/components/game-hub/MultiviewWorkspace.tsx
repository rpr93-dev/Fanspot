'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
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
import { MAX_MULTIVIEW_SLOTS, slotKey, type MultiviewSlot } from '@/lib/multiview'

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
                ? 'Auto — responsive 1–2 columns'
                : l === 'stack'
                  ? 'Stack — one column'
                  : 'Focus — first screen spans the width'
            }
            className={`fs-chip ${layout === l ? 'fs-chip-active' : ''}`}
          >
            {MULTIVIEW_LAYOUT_LABELS[l]}
          </button>
        ))}
      </div>
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
        {slots.map((slot, i) => (
          <div
            key={slotKey(slot)}
            className={`min-w-0 ${effectiveSpotlight != null ? '' : multiviewTileClass(slots.length, i, layout)}`}
          >
            <MultiviewTile
              slot={slot}
              autoplay={autoplay}
              paused={paused.has(slotKey(slot))}
              spotlighted={effectiveSpotlight === i}
              canSpotlight={slots.length > 1}
              active={activeSlot ? slotKey(activeSlot) === slotKey(slot) : false}
              onSelectActive={() => onActive(slotKey(slot))}
              onTogglePause={() => onTogglePause(slot)}
              onToggleSpotlight={() => onSpotlight(effectiveSpotlight === i ? null : i)}
              onRemove={() => onRemove(i)}
            />
          </div>
        ))}
      </div>
    )

  const sideColumn = (
    <div className="min-w-0 space-y-4">
      {activeSlot && (
        <section aria-label="Active game statistics" className="fs-panel p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="fs-title text-base">Statistics</h2>
            <span className="fs-meta">{activeSlot.sport.toUpperCase()} · active screen</span>
          </div>
          <ActiveGameStats slot={activeSlot} />
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
