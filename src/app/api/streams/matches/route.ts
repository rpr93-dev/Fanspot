import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { STREAM_CATEGORY, isValidWatchSport, type StreamMatch } from '@/lib/streams'

/**
 * GET /api/streams/matches?sport=nfl|nba|nhl|mlb|f1&scope=live|all
 *   Match listings from the Streamed directory (free, keyless). Live scope
 *   caches 60s, full-day listings 5min. Upstream failures 502 with a message
 *   so the watch page can show a retry state instead of a dead player.
 */

const STREAMED = 'https://streamed.pk'
const LIVE_TTL_MS = 60_000
const ALL_TTL_MS = 5 * 60_000
const MAX_MATCHES = 200

export function shape(m: any): StreamMatch | null {
  if (!m || typeof m.id !== 'string' || typeof m.title !== 'string') return null
  const sources = Array.isArray(m.sources)
    ? m.sources
        .filter((s: any) => typeof s?.source === 'string' && typeof s?.id === 'string')
        .map((s: any) => ({ source: s.source, id: s.id }))
    : []
  if (sources.length === 0) return null
  return {
    id: m.id,
    title: m.title,
    category: typeof m.category === 'string' ? m.category : '',
    date: typeof m.date === 'number' ? m.date : 0,
    popular: m.popular === true,
    poster: typeof m.poster === 'string' ? m.poster : null,
    teams:
      m.teams?.home?.name || m.teams?.away?.name
        ? {
            home: { name: m.teams?.home?.name ?? '' },
            away: { name: m.teams?.away?.name ?? '' },
          }
        : null,
    sources: sources.slice(0, 12),
  }
}

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
    // Streamed exposes /matches/live (cross-sport) plus per-sport listings;
    // live scope filters the live feed to this sport's category client-side.
    const upstream =
      scope === 'live'
        ? `${STREAMED}/api/matches/live`
        : `${STREAMED}/api/matches/${STREAM_CATEGORY[sport as keyof typeof STREAM_CATEGORY]}`
    const res = await fetch(upstream, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`Streamed ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body)) throw new Error('Streamed bad shape')
    const want = STREAM_CATEGORY[sport as keyof typeof STREAM_CATEGORY]
    const matches = body
      .map(shape)
      .filter((m): m is StreamMatch => m !== null)
      .filter((m) => (scope === 'live' ? m.category === want : true))
      .sort((a, b) => Number(b.popular) - Number(a.popular) || a.date - b.date)
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
