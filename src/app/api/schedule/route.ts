import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'

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
    // 300s (F1). TTL.SCHEDULE matches the gameService path's cache so both
    // routes serve equally fresh data; failures stay uncached so the next
    // poll retries.
    const data = await fetchOrCache(
      `schedule:${sport.toUpperCase()}:${team.toUpperCase()}:${season ?? ''}:${source ?? ''}:${dates ?? ''}`,
      TTL.SCHEDULE,
      async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!res.ok) {
          throw new EspnStatusError(res.status)
        }
        return res.json()
      }
    )
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    if (err instanceof EspnStatusError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
