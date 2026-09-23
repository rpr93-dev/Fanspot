'use client'

import { useEffect, useRef } from 'react'

/**
 * Centralized live polling: one visibility-aware timer per hook instance.
 * `getInterval` may return null to stop polling (e.g. game went final).
 * Skips ticks while the tab is hidden; cleans up on unmount.
 */
export function useLivePoll(
  poll: () => void | Promise<void>,
  getInterval: () => number | null,
  deps: unknown[] = [],
): void {
  const pollRef = useRef(poll)
  const intervalRef = useRef(getInterval)
  pollRef.current = poll
  intervalRef.current = getInterval

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (!document.hidden) {
        try {
          await pollRef.current()
        } catch {
          /* keep last snapshot — errors surface via component state */
        }
      }
      if (stopped) return
      const next = intervalRef.current()
      if (next == null) return
      timer = setTimeout(tick, next)
    }

    const first = intervalRef.current()
    if (first != null) {
      // Immediate first poll, then cadence-driven.
      void tick()
    }
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

