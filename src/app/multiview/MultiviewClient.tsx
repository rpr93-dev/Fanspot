'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SectionHeader } from '@/components/feedback'
import { MultiviewTile } from '@/components/multiview/MultiviewTile'
import { MultiviewPicker } from '@/components/multiview/MultiviewPicker'
import {
  addMultiviewSlot,
  multiviewGridClass,
  parseMultiviewParam,
  removeMultiviewSlot,
  serializeMultiviewSlots,
  slotKey,
  type MultiviewSlot,
} from '@/lib/multiview'

const STORAGE_KEY = 'fanspot:multiview'

/**
 * Split-screen hub: up to 4 games (any mix of NFL/NBA/NHL/MLB + RedZone),
 * each tile an independent score header + stream. Selection lives in the URL
 * (`?games=nfl:..,nba:..`) so layouts are shareable, and the last layout is
 * restored from localStorage when no param is given.
 *
 * Audio: embeds are click-to-play per tile (browsers mix iframe audio, so
 * nothing auto-plays); Pause unmounts a tile's player to silence it without
 * losing its score header. Spotlight enlarges one tile without remounting
 * any player, so feeds keep playing across layout switches.
 */
export function MultiviewClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initial = useMemo(() => parseMultiviewParam(searchParams.get('games')), [searchParams])

  const [slots, setSlots] = useState<MultiviewSlot[]>(initial)
  const [hydrated, setHydrated] = useState(false)
  const [spotlight, setSpotlight] = useState<number | null>(null)
  const [paused, setPaused] = useState<Set<string>>(new Set())
  const [autoplay, setAutoplay] = useState(false)
  const [copied, setCopied] = useState(false)

  // Restore the last layout once (URL wins when present).
  useEffect(() => {
    if (initial.length > 0) {
      setHydrated(true)
      return
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSlots(parseMultiviewParam(raw))
    } catch {
      /* private mode — start empty */
    }
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep URL + storage in sync with the selection.
  const serialized = serializeMultiviewSlots(slots)
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, serialized)
    } catch {
      /* ignore */
    }
    const current = searchParams.get('games') ?? ''
    if (current !== serialized) {
      router.replace(serialized ? `/multiview?games=${encodeURIComponent(serialized)}` : '/multiview', {
        scroll: false,
      })
    }
  }, [hydrated, serialized, router, searchParams])

  const handleAdd = useCallback((slot: MultiviewSlot) => {
    setSlots((prev) => addMultiviewSlot(prev, slot))
  }, [])

  const handleRemove = useCallback(
    (index: number) => {
      setSlots((prev) => {
        const removed = prev[index]
        if (removed) {
          setPaused((p) => {
            const next = new Set(p)
            next.delete(slotKey(removed))
            return next
          })
        }
        return removeMultiviewSlot(prev, index)
      })
      setSpotlight((s) => (s === index ? null : s != null && s > index ? s - 1 : s))
    },
    [],
  )

  const togglePause = useCallback((slot: MultiviewSlot) => {
    setPaused((prev) => {
      const next = new Set(prev)
      const key = slotKey(slot)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the URL is still shareable */
    }
  }, [])

  const effectiveSpotlight = spotlight != null && spotlight < slots.length ? spotlight : null

  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <SectionHeader
          as="h1"
          eyebrow="Watch"
          title="Split screen"
          description="Up to four games side by side — RedZone plus the Steelers, Steelers plus Rams, an NFL game next to an NBA game, any mix. Each tile plays its own feed; pause a tile to silence it."
          action={
            slots.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="fs-btn" onClick={() => setAutoplay((a) => !a)} aria-pressed={autoplay} title="Start every tile's best feed at once">
                  {autoplay ? '⏸ Stop all' : '▶ Start all'}
                </button>
                <button type="button" className="fs-btn" onClick={copyLink}>
                  {copied ? '✓ Link copied' : '⧉ Copy link'}
                </button>
                <button
                  type="button"
                  className="fs-meta px-2 py-1 rounded-md hover:text-fs-text"
                  onClick={() => {
                    setSlots([])
                    setSpotlight(null)
                    setPaused(new Set())
                    setAutoplay(false)
                  }}
                >
                  Clear all
                </button>
              </div>
            ) : undefined
          }
        />

        {slots.length === 0 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
            <div className="fs-panel p-6 sm:p-8">
              <h2 className="fs-title text-xl">Pick games to fill the wall</h2>
              <p className="text-sm text-fs-muted mt-2 max-w-xl leading-relaxed">
                Add up to four screens from today&apos;s board — live games are listed first. Try{' '}
                <span className="text-fs-text font-semibold">NFL RedZone + your team</span>, two Sunday games
                side by side, or football next to basketball. Your layout is saved, and the URL updates as you
                add games so you can share it.
              </p>
              <p className="fs-meta mt-3">
                Streams are third-party embeds (via Streamed) — each tile starts on click so you control which
                feeds play audio.
              </p>
            </div>
            <MultiviewPicker slots={slots} onAdd={handleAdd} />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:items-start">
            <div className={effectiveSpotlight == null ? multiviewGridClass(slots.length) : 'grid gap-4 grid-cols-1'}>
              {slots.map((slot, i) => (
                <div key={slotKey(slot)} className={effectiveSpotlight === i ? 'xl:col-span-1' : undefined}>
                  <MultiviewTile
                    slot={slot}
                    autoplay={autoplay}
                    paused={paused.has(slotKey(slot))}
                    spotlighted={effectiveSpotlight === i}
                    canSpotlight={slots.length > 1}
                    onTogglePause={() => togglePause(slot)}
                    onToggleSpotlight={() =>
                      setSpotlight((s) => (s === i ? null : i))
                    }
                    onRemove={() => handleRemove(i)}
                  />
                </div>
              ))}
            </div>
            <div className="min-w-0 xl:sticky xl:top-20">
              <MultiviewPicker slots={slots} onAdd={handleAdd} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
