import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { scheduleTtlFor } from '@/lib/cache/ttl'

/** Carries the upstream status through fetchOrCache so error responses stay uncached and exact. */
class EspnStatusError extends Error {
  status: number
  constructor(status: number) {
    super(`ESPN API error ${status}`)
    this.status = status
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')
  const season = searchParams.get('season')
  const source = searchParams.get('source')
  const dates = searchParams.get('dates')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  let url: string
  if (source === 'scoreboard') {
    url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`
    const params = new URLSearchParams()
    if (dates) params.set('dates', dates)
    const qs = params.toString()
    if (qs) url += `?${qs}`
  } else {
    url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/schedule`
    if (season) url += `?season=${season}`
  }

  try {
    // Route-level cache: the client schedule poll re-runs the full ESPN fan-out
    // (up to 6 of these proxy calls, ~2 MB JSON) from every open tab every
    // 300s (F1); failures stay uncached so the next poll retries.
    // The TTL follows the game clock (scheduleTtlFor): a flat 6h TTL drops
    // live games from the dashboard — a feed cached pre-kickoff still marks
    // the game `pre`, and once its date passes it matches neither the future
    // list nor the live list, so the game vanishes until the cache expires.
    const key = `schedule:${sport.toUpperCase()}:${team.toUpperCase()}:${season ?? ''}:${source ?? ''}:${dates ?? ''}`
    const peek = getCached<any>(key)
    if (peek && isFresh(peek.ts, scheduleTtlFor(peek.data?.events))) {
      return NextResponse.json(peek.data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      throw new EspnStatusError(res.status)
    }
    const data = await res.json()
    setCached(key, data)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    if (err instanceof EspnStatusError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
