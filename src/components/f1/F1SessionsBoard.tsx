'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { sessionState } from '@/lib/f1'

export interface F1SessionItem {
  id: string
  name: string
  type: string
  dateStart: string
  dateEnd: string
  state: 'upcoming' | 'live' | 'final'
  round: number
  grandPrix: string
  location: string
}

/** "in 2d 4h" / "in 3h 12m" / "in 47m 12s" — mirrors the hub's countdown. */
function countdown(ms: number): string {
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  const secs = Math.floor((ms % 60_000) / 1000)
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h ${mins}m`
  if (mins > 0) return `in ${mins}m ${secs}s`
  return `in ${secs}s`
}

/** Short chip for a session type (RACE / SPRINT / QUALI / PRACTICE). */
export function f1SessionChip(type: string): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('race') && !t.includes('sprint')) return 'RACE'
  if (t.includes('sprint')) return 'SPRINT'
  if (t.includes('qualifying') || t.includes('quali')) return 'QUALI'
  if (t.includes('practice') || t.includes('warm')) return 'PRACTICE'
  return 'F1'
}

/**
 * Every session of the current Grand Prix weekend (practice / sprint /
 * qualifying / race), with live/upcoming state. Sourced from the weekend API's
 * OpenF1 sessions when available, else the Jolpica fallback schedule — so the
 * sessions still surface while OpenF1 is locked during a live session. Returns
 * null while loading, [] when there's no upcoming weekend. Re-derives state on
 * a 30s clock so a session flips to live without a refetch.
 */
export function useF1Sessions(): F1SessionItem[] | null {
  const [items, setItems] = useState<F1SessionItem[] | null>(null)
  const [, setClock] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      let next: F1SessionItem[] | null = null
      try {
        const schedRes = await fetch('/api/f1/schedule', { signal: AbortSignal.timeout(15_000) })
        const sched = schedRes.ok ? await schedRes.json() : null
        const round = sched?.next
        if (round) {
          const wRes = await fetch(`/api/f1/weekend?round=${encodeURIComponent(String(round.round))}`, {
            signal: AbortSignal.timeout(15_000),
          })
          const w = wRes.ok ? await wRes.json() : null
          const grandPrix = w?.race?.name ?? round.name ?? 'Grand Prix'
          const location =
            w?.race?.locality ?? round.locality ?? w?.race?.country ?? round.country ?? ''

          const raw: { key: number | null; name: string; type: string; dateStart: string; dateEnd: string }[] = []
          const openf1 = Array.isArray(w?.sessions) ? w.sessions : []
          if (openf1.length > 0) {
            for (const s of openf1) {
              raw.push({
                key: s.key ?? null,
                name: s.name,
                type: s.type ?? s.name,
                dateStart: s.dateStart,
                dateEnd: s.dateEnd,
              })
            }
          } else {
            const jolpica = Array.isArray(w?.race?.sessions) ? w.race.sessions : []
            jolpica.forEach((s: any, i: number) => {
              const start = `${s.date}T${s.time ?? '00:00:00Z'}`
              const end = new Date(Date.parse(start) + 3_600_000).toISOString()
              raw.push({ key: -(i + 1), name: s.name, type: s.name, dateStart: start, dateEnd: end })
            })
          }

          next = raw
            .map((s) => ({
              id: s.key != null ? `${round.round}:${s.key}` : `${round.round}:${s.name}`,
              name: s.name,
              type: s.type,
              dateStart: s.dateStart,
              dateEnd: s.dateEnd,
              state: sessionState(s.dateStart, s.dateEnd),
              round: Number(round.round),
              grandPrix,
              location,
            }))
            .sort((a, b) => Date.parse(a.dateStart) - Date.parse(b.dateStart))
        } else {
          next = []
        }
      } catch {
        /* keep the last good list */
      }
      if (!cancelled && next) setItems(next)
      if (!cancelled) {
        const hasLive = next?.some((s) => s.state === 'live')
        timer = setTimeout(tick, hasLive ? 30_000 : 120_000)
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Recompute state on the clock so a session goes live/upcoming on its own.
  useEffect(() => {
    const t = setInterval(() => setClock((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  return items ? items.map((s) => ({ ...s, state: sessionState(s.dateStart, s.dateEnd) })) : null
}

/** One F1 session as a card (chip · name · GP/location · LIVE/countdown). */
export function F1SessionCard({ session, className }: { session: F1SessionItem; className?: string }) {
  const live = session.state === 'live'
  const ms = Date.parse(session.dateStart) - Date.now()
  const when = live ? 'LIVE' : Number.isFinite(ms) && ms > 0 ? countdown(ms) : 'Soon'
  return (
    <Link
      href={`/f1/round/${session.round}`}
      prefetch={false}
      aria-label={`${session.name} at the ${session.grandPrix}`}
      className={`fs-panel flex items-center gap-3 p-3 transition hover:brightness-125 ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className="shrink-0 grid place-items-center rounded-lg px-2 py-1 text-[10px] font-black tracking-wider text-white"
        style={{ backgroundColor: '#E10600' }}
      >
        {f1SessionChip(session.type)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">
          {session.name} · {session.grandPrix}
        </span>
        <span className="fs-meta block truncate">{session.location}</span>
      </span>
      <span
        className={`fs-mono text-xs font-bold tabular-nums shrink-0 ${live ? 'text-fs-red' : 'text-fs-gold'}`}
        title={new Date(session.dateStart).toString()}
      >
        {live ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          when
        )}
      </span>
    </Link>
  )
}
