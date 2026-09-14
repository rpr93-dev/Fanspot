import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'
import { invalidParam, isKnownEspnSport, isValidEventId } from '@/lib/api-validation'
import { normalizeSportKey } from '@/lib/models'
import { normalizePlays } from '@/lib/plays'

/**
 * Normalized play-by-play for a game. Empty list when the provider carries
 * no usable play data (pre-game, unsupported shape) — the client hides the
 * Plays tab. Live games cache briefly; finals cache long.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sportParam = searchParams.get('sport')
  const eventId = searchParams.get('eventId')

  if (!sportParam || !eventId) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing sport or eventId' }, { status: 400 })
  }
  if (!isKnownEspnSport(sportParam)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  if (!isValidEventId(eventId)) {
    return invalidParam('eventId must be numeric')
  }
  const sport = normalizeSportKey(sportParam)!
  const espnPath = espnSportMap[sport]

  const key = `plays:${sport}:${eventId}`
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${encodeURIComponent(eventId)}`,
      { signal: AbortSignal.timeout(15000) },
    )
    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ eventId, sport, plays: [], status: null })
      }
      throw new Error(`ESPN summary error ${res.status}`)
    }
    const summary = await res.json()
    const statusType = summary?.header?.competitions?.[0]?.status?.type ?? null
    const isLive = statusType?.state === 'in'

    const peek = getCached<any>(key)
    if (peek && isFresh(peek.ts, isLive ? TTL.LIVE_SCORE : TTL.BOX_SCORE)) {
      return NextResponse.json(peek.data, {
        headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' },
      })
    }

    const plays = normalizePlays(sport, summary)
    const payload = {
      eventId,
      sport,
      plays,
      status: statusType
        ? { state: statusType.state, completed: statusType.completed, shortDetail: statusType.shortDetail }
        : null,
    }
    // Don't pin empty pre-game results: the first whistle should flip the tab on.
    if (plays.length > 0 || statusType?.completed) setCached(key, payload)
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' },
    })
  } catch (err) {
    console.error('[plays] request failed:', err)
    return NextResponse.json({ error: 'PLAYS_UNAVAILABLE', message: 'Unable to load play-by-play' }, { status: 500 })
  }
}
