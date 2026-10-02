'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { LIVE_STAT_ROWS } from '@/lib/scheduleWeek'
import { useEffect, useState } from 'react'

export interface GameCardSide {
  abbr: string
  name?: string
  logo?: string | null
  score?: string
  winner?: boolean | null
  record?: string | null
}

export type GameCardPhase = 'pre' | 'live' | 'final' | 'postponed' | 'delayed'

/**
 * The standard Fanspot game card — the NFL hub's basic card, reused by every
 * team sport (NBA/NHL/MLB). Two stacked team rows (logo · abbr · score) with a
 * status pill, an optional footer, and an optional live stat block. F1 has its
 * own race card and does not use this.
 */
export function GameCard({
  href,
  meta,
  phase,
  statusLabel,
  away,
  home,
  footer,
  liveStatsEventId,
  accent,
  className = '',
  prefetch,
}: {
  href?: string
  meta?: string | null
  phase: GameCardPhase
  statusLabel?: string | null
  away: GameCardSide
  home: GameCardSide
  footer?: ReactNode
  /** NFL only: live box-score stats come from the football summary feed. */
  liveStatsEventId?: string | null
  accent?: string
  className?: string
  prefetch?: boolean
}) {
  const isLive = phase === 'live'
  const isFinal = phase === 'final'

  const pillText = isLive
    ? `LIVE${statusLabel ? ` · ${statusLabel}` : ''}`
    : isFinal
      ? 'FINAL'
      : phase === 'postponed'
        ? 'PPD'
        : phase === 'delayed'
          ? 'DELAYED'
          : statusLabel || 'PRE'
  const pillClass = isFinal
    ? 'bg-white/10 text-fs-muted-2'
    : isLive
      ? 'bg-fs-red/20 text-fs-red animate-pulse'
      : 'bg-fs-gold/20 text-fs-gold'

  const inner = (
    <div
      className={`fs-panel p-4 sm:p-5 hover-card cursor-pointer transition-all duration-300 ${isLive ? 'ring-1 ring-fs-red/40' : ''} ${className}`}
      style={accent ? ({ '--tint': accent, '--tint-border': `${accent}26`, '--card-color': accent } as React.CSSProperties) : undefined}
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="fs-meta truncate">{meta}</span>
        <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${pillClass}`}>
          {pillText}
        </span>
      </div>

      <div className="space-y-3">
        <TeamRow side={away} phase={phase} />
        <div className="border-t border-fs-line" />
        <TeamRow side={home} phase={phase} />
      </div>

      {isLive && liveStatsEventId && (
        <div className="mt-3 pt-3 border-t border-fs-line">
          <LiveStatsBlock eventId={liveStatsEventId} />
        </div>
      )}

      {footer && (
        <div className="mt-3 pt-3 border-t border-fs-line">{footer}</div>
      )}
    </div>
  )

  if (!href) return inner
  return (
    <Link href={href} className="block group" prefetch={prefetch}>
      {inner}
    </Link>
  )
}

function TeamRow({ side, phase }: { side: GameCardSide; phase: GameCardPhase }) {
  const showW = side.winner === true && phase !== 'live'
  const dim = phase === 'final' && side.winner === false
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {side.logo ? (
          <img aria-hidden="true" src={side.logo} alt="" className="w-8 h-8 object-contain shrink-0" loading="lazy" />
        ) : (
          <span className="w-8 h-8 shrink-0" aria-hidden="true" />
        )}
        <span className="font-semibold text-sm truncate">{side.abbr}</span>
        {showW && <span className="text-[10px] font-bold text-fs-turf">W</span>}
        {phase === 'pre' && side.record && (
          <span className="fs-mono text-[10px] text-fs-muted-2 tabular-nums hidden sm:inline">{side.record}</span>
        )}
      </div>
      <span className={`text-lg font-bold tabular-nums shrink-0 ${dim ? 'text-fs-muted-2' : ''}`}>
        {side.score || '-'}
      </span>
    </div>
  )
}

function num(v: string | undefined): number {
  if (!v) return -1
  const m = String(v).trim().match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : -1
}

/**
 * Head-to-head live team stats for an NFL game in progress. Polls on the same
 * cadence as the schedule while the game runs; hides itself when empty.
 */
function LiveStatsBlock({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<{ away: Record<string, string>; home: Record<string, string> } | null>(null)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function grab() {
      try {
        const res = await fetch(`/api/live-stats?eventId=${eventId}`, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) setAttempts((a) => a + 1)
          return
        }
        const json = await res.json()
        if (!cancelled) {
          if (json?.stats) {
            setStats(json.stats)
            setAttempts(0)
          } else {
            setAttempts((a) => a + 1)
          }
        }
      } catch {
        /* keep last snapshot */
        if (!cancelled) setAttempts((a) => a + 1)
      }
    }
    grab()
    const id = setInterval(() => {
      if (!document.hidden) grab()
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [eventId])

  const rows = stats
    ? LIVE_STAT_ROWS.map((r) => ({ label: r.label, away: stats.away[r.key] ?? '', home: stats.home[r.key] ?? '' })).filter(
        (r) => r.away.trim() !== '' || r.home.trim() !== '',
      )
    : []

  if (rows.length === 0) {
    // Give up quietly after a few empty/failed polls instead of pulsing forever.
    if (attempts >= 3) return null
    return <p className="text-xs text-fs-muted-2 animate-pulse py-1">Loading live stats…</p>
  }

  return (
    <div className="space-y-0.5 py-1 tabular-nums">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2 text-xs leading-5">
          <span className={`text-right font-semibold ${num(r.away) >= num(r.home) ? 'text-fs-text' : 'text-fs-muted-2'}`}>
            {r.away || '—'}
          </span>
          <span className="text-center text-fs-muted-2 truncate">{r.label}</span>
          <span className={`text-left font-semibold ${num(r.home) > num(r.away) ? 'text-fs-text' : 'text-fs-muted-2'}`}>
            {r.home || '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
