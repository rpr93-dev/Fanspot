'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  addMultiviewSlot,
  parseMultiviewParam,
  removeMultiviewSlot,
  serializeMultiviewSlots,
  slotKey,
  type MultiviewSlot,
} from '@/lib/multiview'

/** Shared localStorage key: the standalone split-screen page and the in-hub
 *  Multiview mode always agree on the last layout. */
export const MULTIVIEW_STORAGE_KEY = 'fanspot:multiview'

/**
 * Split-screen selection state used by both the `/multiview` page and the Game
 * Hub's Multiview mode: URL-supplied slots win, else the last layout is
 * restored from localStorage. Persisting + sharing one implementation keeps
 * the two surfaces in sync without a competing implementation.
 */
export function useMultiviewSelection(initialSlots: MultiviewSlot[] = []) {
  const [slots, setSlots] = useState<MultiviewSlot[]>(initialSlots)
  const [hydrated, setHydrated] = useState(false)
  const [spotlight, setSpotlight] = useState<number | null>(null)
  const [paused, setPaused] = useState<Set<string>>(new Set())
  const [autoplay, setAutoplay] = useState(false)
  /**
   * Audio focus — the one screen allowed to make noise. `null` (the default)
   * is the existing behaviour: every screen plays its own audio. Third-party
   * embeds cannot be muted from the page, so focusing one screen means the
   * others stop playing; the board says so rather than pretending to mute.
   */
  const [audioKey, setAudioKey] = useState<string | null>(null)

  useEffect(() => {
    if (initialSlots.length > 0) {
      setHydrated(true)
      return
    }
    try {
      const raw = localStorage.getItem(MULTIVIEW_STORAGE_KEY)
      if (raw) setSlots(parseMultiviewParam(raw))
    } catch {
      /* private mode — start empty */
    }
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(MULTIVIEW_STORAGE_KEY, serializeMultiviewSlots(slots))
    } catch {
      /* ignore */
    }
  }, [hydrated, slots])

  const add = useCallback((slot: MultiviewSlot) => {
    setSlots((prev) => addMultiviewSlot(prev, slot))
  }, [])

  const remove = useCallback((index: number) => {
    setSlots((prev) => {
      const removed = prev[index]
      if (removed) {
        setPaused((p) => {
          const next = new Set(p)
          next.delete(slotKey(removed))
          return next
        })
        const key = slotKey(removed)
        setAudioKey((a) => (a === key ? null : a))
      }
      return removeMultiviewSlot(prev, index)
    })
    setSpotlight((s) => (s === index ? null : s != null && s > index ? s - 1 : s))
  }, [])

  const clear = useCallback(() => {
    setSlots([])
    setSpotlight(null)
    setPaused(new Set())
    setAutoplay(false)
    setAudioKey(null)
  }, [])

  /**
   * Focus a screen's audio. Passing the focused key again hands the audio back
   * to every screen; focusing a tile also un-pauses it, so picking audio never
   * leaves a silent screen on stage.
   */
  const focusAudio = useCallback((key: string | null) => {
    setAudioKey((prev) => (key && prev === key ? null : key))
    if (key) {
      setPaused((p) => {
        if (!p.has(key)) return p
        const next = new Set(p)
        next.delete(key)
        return next
      })
    }
  }, [])

  const togglePause = useCallback((slot: MultiviewSlot) => {
    setPaused((prev) => {
      const next = new Set(prev)
      const key = slotKey(slot)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return {
    slots,
    add,
    remove,
    clear,
    spotlight,
    setSpotlight,
    paused,
    togglePause,
    autoplay,
    setAutoplay,
    audioKey,
    setAudioKey: focusAudio,
    hydrated,
  }
}
