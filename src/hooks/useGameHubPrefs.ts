'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_GAME_HUB_PREFS,
  GAME_HUB_PREFS_KEY,
  LEGACY_GAME_HUB_PREFS_KEY,
  parseGameHubPrefs,
  serializeGameHubPrefs,
  type GameHubMode,
  type GameHubPrefs,
  type GameHubShell,
} from '@/lib/gameHub'

/**
 * Read-only snapshot of the persisted shell + mode. Used by callers that need
 * to know how the hub is rendering without owning (or fighting over) the
 * prefs — e.g. `GameView` keeping the v2 Watch companion on the game overview
 * instead of jumping a final game to the box score. Never writes.
 */
export function readGameHubShell(): { shell: GameHubShell; mode: GameHubMode } {
  const fallback = { shell: DEFAULT_GAME_HUB_PREFS.shell, mode: DEFAULT_GAME_HUB_PREFS.mode }
  if (typeof window === 'undefined') return fallback
  try {
    const prefs = parseGameHubPrefs(localStorage.getItem(GAME_HUB_PREFS_KEY))
    return { shell: prefs.shell, mode: prefs.mode }
  } catch {
    return fallback
  }
}

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
      let raw = localStorage.getItem(GAME_HUB_PREFS_KEY)
      if (!raw) {
        // First visit since v2 became the main shell: import the legacy blob,
        // but force its shell to v2 so nobody stays pinned to the old layout.
        raw = localStorage.getItem(LEGACY_GAME_HUB_PREFS_KEY)
        if (raw) setPrefs(parseGameHubPrefs(raw, { resetShell: true }))
      } else {
        setPrefs(parseGameHubPrefs(raw))
      }
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
