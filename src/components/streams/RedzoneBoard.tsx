'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { StreamMatch } from '@/lib/streams'

export interface RedzoneState {
  live: boolean
  reason?: string
  match: StreamMatch | null
}

/**
 * Polls the gated RedZone endpoint. The server only reports `live` while
 * Sunday games are in progress inside the RedZone broadcast window, so every
 * caller can simply render when `live` is true. Returns null while loading;
 * polls every 60s while live, else every 2 minutes.
 */
export function useRedzone(): RedzoneState | null {
  const [state, setState] = useState<RedzoneState | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      let next: RedzoneState | null = null
      try {
        const res = await fetch('/api/streams/redzone', { signal: AbortSignal.timeout(15_000) })
        if (res.ok) {
          const body = await res.json()
          next = { live: body?.live === true, reason: body?.reason, match: body?.match ?? null }
        }
      } catch {
        /* keep the last good state */
      }
      if (!cancelled && next) setState(next)
      if (!cancelled) timer = setTimeout(tick, next?.live ? 60_000 : 120_000)
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return state
}

const RED = '#E01B2E'

/**
 * Compact RedZone entry shown alongside live games (home Live Now and the NFL
 * hub). Renders nothing unless RedZone is actually live, so it never becomes a
 * dead link on a quiet afternoon.
 */
export function RedzoneCard({ className = '' }: { className?: string }) {
  const rz = useRedzone()
  if (!rz?.live || !rz.match) return null
  return (
    <Link
      href="/nfl/redzone"
      prefetch={false}
      aria-label="Open NFL RedZone"
      className={`fs-panel group relative flex items-center gap-3 p-3 overflow-hidden transition hover:brightness-125 ${className}`}
      style={{ '--tint': RED, '--tint-border': `${RED}44` } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: `linear-gradient(180deg, ${RED}, #7a0f1c)` }}
      />
      <span
        aria-hidden="true"
        className="shrink-0 grid place-items-center rounded-lg px-2 py-1 text-[10px] font-black tracking-wider text-white"
        style={{ backgroundColor: RED }}
      >
        REDZONE
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">NFL RedZone · every Sunday game</span>
        <span className="fs-meta block truncate">{rz.match.title}</span>
      </span>
      <span className="fs-mono text-xs font-bold tabular-nums shrink-0 text-fs-red inline-flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
        LIVE
      </span>
    </Link>
  )
}

/** Full-width RedZone banner for the NFL hub; null unless live. */
export function RedzoneBanner({ className = '' }: { className?: string }) {
  const rz = useRedzone()
  if (!rz?.live || !rz.match) return null
  return (
    <Link
      href="/nfl/redzone"
      prefetch={false}
      aria-label="Open NFL RedZone"
      className={`fs-panel group relative flex flex-wrap items-center gap-3 p-4 overflow-hidden transition hover:brightness-125 ${className}`}
      style={{ '--tint': RED, '--tint-border': `${RED}55` } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: `linear-gradient(180deg, ${RED}, #7a0f1c)` }}
      />
      <span
        aria-hidden="true"
        className="shrink-0 grid place-items-center rounded-lg px-2.5 py-1.5 text-[11px] font-black tracking-wider text-white"
        style={{ backgroundColor: RED }}
      >
        REDZONE
      </span>
      <span className="min-w-0 flex-1">
        <span className="fs-title block text-base">NFL RedZone is live</span>
        <span className="fs-meta block truncate">
          Every Sunday game, one feed — {rz.match.title}
        </span>
      </span>
      <span className="fs-btn shrink-0">Watch RedZone →</span>
    </Link>
  )
}
