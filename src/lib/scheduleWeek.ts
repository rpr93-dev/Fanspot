import { scheduleTtlFor } from './cache/ttl'
import { getCached, setCached, isFresh } from './cache/cacheService'

export const NFL_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'

/** NFL season Y spans Aug(Y)-Feb(Y+1); Jan/Feb games belong to season Y-1. */
export function nflSeasonYear(now: Date = new Date()): number {
  return now.getMonth() + 1 <= 2 ? now.getFullYear() - 1 : now.getFullYear()
}

/**
 * All games for one NFL week (completed or not) from a single scoreboard
 * call. TTL follows the game clock (scheduleTtlFor): fast while any game is
 * live or inside the gameday window so the feed flips pre -> in -> post
 * promptly, slow for quiet weeks. Failed or empty fetches stay uncached.
 */
export async function fetchNflWeekEvents(week: number, season: number): Promise<any[]> {
  const key = `nfl:week_events:${season}:${week}`
  const peek = getCached<any[]>(key)
  if (peek && isFresh(peek.ts, scheduleTtlFor(peek.data))) return peek.data

  const res = await fetch(`${NFL_SCOREBOARD_URL}?week=${week}&season=${season}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`ESPN scoreboard error ${res.status}`)
  const data = await res.json()
  const events = (data?.events ?? []) as any[]
  if (events.length > 0) setCached(key, events)
  return events
}

/**
 * The league's current week number (1 during Week 1, ...) from the default
 * scoreboard window. Hourly cache — the week number only advances once a
 * week; game-level freshness is handled per-week by fetchNflWeekEvents.
 */
export async function fetchCurrentNflWeek(): Promise<number> {
  const key = 'nfl:current-week'
  const peek = getCached<number>(key)
  if (peek && isFresh(peek.ts, 3_600_000)) return peek.data
  try {
    const res = await fetch(NFL_SCOREBOARD_URL, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return 1
    const data = await res.json()
    const week = data?.week?.number
    const n = typeof week === 'number' && week >= 1 ? week : 1
    setCached(key, n)
    return n
  } catch {
    return 1
  }
}

export const gameStatus = (event: any) => event?.competitions?.[0]?.status?.type
export const isLiveGame = (event: any) => gameStatus(event)?.state === 'in'
export const isFinalGame = (event: any) =>
  gameStatus(event)?.completed === true || gameStatus(event)?.state === 'post'

/** Score shape varies across feeds: plain string vs { displayValue }. */
export function dispScore(score: unknown): string {
  if (score == null) return ''
  if (typeof score === 'object') return String((score as any).displayValue ?? '')
  return String(score)
}

/** Primetime slot detection (Thu/Sun/Mon evenings Eastern) from the UTC date. */
export function isPrimetime(dateStr: string): boolean {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d)
  const day = parts.find((p) => p.type === 'weekday')?.value
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '25', 10) % 24
  return (day === 'Thu' || day === 'Sun' || day === 'Mon') && hour >= 20
}

/**
 * Head-to-head live team stats from an ESPN summary boxscore: label rows with
 * away/home display strings, only keeping rows where at least one side has a
 * value.
 */
export const LIVE_STAT_ROWS = [
  { key: 'totalYards', label: 'Total Yds' },
  { key: 'netPassingYards', label: 'Pass Yds' },
  { key: 'rushingYards', label: 'Rush Yds' },
  { key: 'thirdDownEff', label: '3rd Down' },
  { key: 'possessionTime', label: 'Time of Poss' },
] as const

export function liveSideStats(boxScore: any): {
  away: Record<string, string>
  home: Record<string, string>
} | null {
  const teams = Array.isArray(boxScore?.teams) ? boxScore.teams : []
  const away = teams.find((t: any) => t?.homeAway === 'away')
  const home = teams.find((t: any) => t?.homeAway === 'home')
  if (!away || !home) return null
  const toMap = (t: any): Record<string, string> => {
    const m: Record<string, string> = {}
    for (const s of (t?.statistics ?? []) as any[]) {
      if (s?.name) m[s.name] = String(s.displayValue ?? '')
    }
    return m
  }
  return { away: toMap(away), home: toMap(home) }
}
