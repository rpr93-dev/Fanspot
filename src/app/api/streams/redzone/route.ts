import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import {
  STREAM_CATEGORY,
  easternTimeParts,
  findRedzoneStream,
  isRedzoneWindow,
  type StreamMatch,
} from '@/lib/streams'
import { isLiveGame } from '@/lib/scheduleWeek'
import { fetchScoreboardDay } from '../../scoreboard/route'
import { shape } from '../matches/route'

/**
 * GET /api/streams/redzone
 *   The NFL RedZone channel is only surfaced while Sunday games are actually
 *   being played. Returns { live: false, reason } unless the Eastern-time
 *   broadcast window is open AND at least one NFL game is in progress, in
 *   which case it resolves the Streamed "Redzone - Week N" listing.
 *
 *   Reasons: outside-window | no-live-games | no-listing | unavailable.
 */

const STREAMED = 'https://streamed.pk'
const MATCH_TTL_MS = 60_000

/** Resolve the current RedZone listing from Streamed (60s memo). */
async function fetchRedzoneMatch(): Promise<StreamMatch | null> {
  const key = 'streams:redzone:match'
  const cached = getCached<StreamMatch | null>(key)
  if (cached && isFresh(cached.ts, MATCH_TTL_MS)) return cached.data

  const res = await fetch(`${STREAMED}/api/matches/${STREAM_CATEGORY.nfl}`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Streamed ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body)) throw new Error('Streamed bad shape')
  const matches = body
    .map(shape)
    .filter((m): m is StreamMatch => m !== null)
  const match = findRedzoneStream(matches)
  setCached(key, match)
  return match
}

export async function GET(): Promise<NextResponse> {
  const now = new Date()
  if (!isRedzoneWindow(now)) {
    return NextResponse.json({ live: false, reason: 'outside-window', match: null })
  }

  // RedZone only matters while games are in progress — gate on a live NFL game.
  const { dateKey } = easternTimeParts(now)
  let hasLiveGame = false
  let scoreboardFailed = false
  try {
    const data = await fetchScoreboardDay('NFL', dateKey)
    const events = Array.isArray(data?.events) ? data.events : []
    hasLiveGame = events.some(isLiveGame)
  } catch (err) {
    console.error('[streams/redzone] scoreboard failed:', err)
    scoreboardFailed = true
  }
  if (!hasLiveGame) {
    return NextResponse.json({
      live: false,
      reason: scoreboardFailed ? 'unavailable' : 'no-live-games',
      match: null,
    })
  }

  try {
    const match = await fetchRedzoneMatch()
    if (!match) return NextResponse.json({ live: false, reason: 'no-listing', match: null })
    return NextResponse.json(
      { live: true, match },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    )
  } catch (err) {
    console.error('[streams/redzone] listing failed:', err)
    return NextResponse.json({ live: false, reason: 'unavailable', match: null })
  }
}
