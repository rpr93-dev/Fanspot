'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_GAME_HUB_PREFS,
  GAME_HUB_PREFS_KEY,
  parseGameHubPrefs,
  serializeGameHubPrefs,
  type GameHubPrefs,
} from '@/lib/gameHub'

/**
 * Persisted Game Hub layout prefs (mode, split ratio, sidebar, multiview
 * layout). Starts from the server-safe defaults so hydration matches, then
 * reads localStorage once — the same pattern as the split-screen client, so a
 * stored layout never causes a hydration mismatch.
 */
export function useGameHubPrefs() {
  const [prefs, setPrefs] = useState<GameHubPrefs>(DEFAULT_GAME_HUB_PREFS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GAME_HUB_PREFS_KEY)
      if (raw) setPrefs(parseGameHubPrefs(raw))
    } catch {
      /* private mode — keep defaults */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(GAME_HUB_PREFS_KEY, serializeGameHubPrefs(prefs))
    } catch {
      /* ignore quota / private mode */
    }
  }, [hydrated, prefs])

  const patch = useCallback((p: Partial<GameHubPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...p }))
  }, [])

  const reset = useCallback(() => {
    setPrefs({ ...DEFAULT_GAME_HUB_PREFS })
  }, [])

  return { prefs, patch, reset, hydrated }
}
