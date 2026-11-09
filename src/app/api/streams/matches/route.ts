import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import {
  STREAM_CATEGORY,
  isValidWatchSport,
  shapeStreamFreeMatch,
  type StreamMatch,
} from '@/lib/streams'

/**
 * GET /api/streams/matches?sport=nfl|nba|nhl|mlb|f1&scope=live|all
 *   Match listings from the StreamFree directory (free, keyless). Live scope
 *   caches 60s, full-day listings 5min. Upstream failures 502 with a message
 *   so the watch page can show a retry state instead of a dead player.
 */

const STREAMFREE = 'https://streamfree.top'
const LIVE_TTL_MS = 60_000
const ALL_TTL_MS = 5 * 60_000
const MAX_MATCHES = 200

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const sport = (url.searchParams.get('sport') ?? '').toLowerCase()
  const scope = (url.searchParams.get('scope') ?? 'all').toLowerCase()
  if (!isValidWatchSport(sport)) {
    return NextResponse.json(
      { error: 'INVALID_PARAM', message: 'sport must be one of: nfl, nba, nhl, mlb, f1' },
      { status: 400 },
    )
  }
  if (scope !== 'live' && scope !== 'all') {
    return NextResponse.json(
      { error: 'INVALID_PARAM', message: 'scope must be live or all' },
      { status: 400 },
    )
  }

  const key = `streams:matches:${sport}:${scope}`
  const ttl = scope === 'live' ? LIVE_TTL_MS : ALL_TTL_MS
  const cached = getCached<StreamMatch[]>(key)
  if (cached && isFresh(cached.ts, ttl)) {
    return NextResponse.json({ matches: cached.data, cached: true })
  }

  try {
    const category = STREAM_CATEGORY[sport]
    const upstream = `${STREAMFREE}/api/v1/streams?category=${encodeURIComponent(category)}`
    const res = await fetch(upstream, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`StreamFree ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body?.streams)) throw new Error('StreamFree bad shape')
    const matches = body.streams
      .map(shapeStreamFreeMatch)
      .filter((m: StreamMatch | null): m is StreamMatch => m !== null)
      .filter((m: StreamMatch) => (scope === 'live' ? m.live === true : true))
      .sort((a: StreamMatch, b: StreamMatch) => Number(b.popular) - Number(a.popular) || a.date - b.date)
      .slice(0, MAX_MATCHES)
    setCached(key, matches)
    return NextResponse.json({ matches, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: 'STREAMS_UNAVAILABLE', message: 'Stream listings are down right now — try again in a bit.' },
      { status: 502 },
    )
  }
}
