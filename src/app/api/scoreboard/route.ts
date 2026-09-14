import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { getCached, setCachedChecked, isFresh } from '@/lib/cache/cacheService'
import { TTL, scheduleTtlFor } from '@/lib/cache/ttl'
import { invalidParam, isKnownEspnSport, isValidDate } from '@/lib/api-validation'
import { todayKey } from '@/lib/models'

/** Fetch one league's scoreboard day from ESPN (raw shape, cached). */
export async function fetchScoreboardDay(sport: string, date: string): Promise<any> {
  const espnPath = espnSportMap[sport.toUpperCase()]
  const key = `scoreboard:${sport.toUpperCase()}:${date}`
  const peek = getCached<any>(key)
  if (peek) {
    // Gameday-aware TTL: today's board refreshes fast while games are live or
    // approaching; historical dates are effectively immutable.
    const ttl = date === todayKey() ? scheduleTtlFor(peek.data?.events) : TTL.SCHEDULE
    if (isFresh(peek.ts, ttl)) return peek.data
  }
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${encodeURIComponent(date)}`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (!res.ok) throw new Error(`ESPN scoreboard error ${res.status}`)
  const data = await res.json()
  setCachedChecked(key, data)
  return data
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const date = searchParams.get('date') // YYYYMMDD

  if (!sport || !date) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing sport or date parameter' }, { status: 400 })
  }
  if (!isKnownEspnSport(sport)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  if (!isValidDate(date)) {
    return invalidParam('date must be YYYYMMDD')
  }

  try {
    const data = await fetchScoreboardDay(sport, date)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    })
  } catch (err) {
    console.error('[scoreboard] request failed:', err)
    return NextResponse.json({ error: 'SCOREBOARD_UNAVAILABLE', message: 'Unable to load scoreboard' }, { status: 500 })
  }
}
