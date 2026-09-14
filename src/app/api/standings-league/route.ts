import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'
import { invalidParam, isAllowedSport } from '@/lib/api-validation'
import { normalizeSportKey } from '@/lib/models'
import { normalizeStandingsChildren, groupStandingsRows } from '@/lib/standings'

/**
 * Full-league standings, normalized to Fanspot shapes (team rows clickable
 * via teamId). The existing /api/standings route stays team-scoped for the
 * team dashboard; this one serves league hubs.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sportParam = searchParams.get('sport')

  if (!sportParam) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing sport' }, { status: 400 })
  }
  if (!isAllowedSport(sportParam)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  const sport = normalizeSportKey(sportParam)!
  const espnPath = espnSportMap[sport]

  try {
    const payload = await fetchOrCache(
      `standings-league:${sport}`,
      TTL.STANDINGS,
      async () => {
        const res = await fetch(
          `https://site.web.api.espn.com/apis/v2/sports/${espnPath}/standings`,
          { signal: AbortSignal.timeout(15000) },
        )
        if (!res.ok) throw new Error(`ESPN standings error ${res.status}`)
        const data = await res.json()
        const rows = normalizeStandingsChildren(data?.children ?? [], sport)
        if (rows.length === 0) throw new Error('ESPN returned no standings rows')
        return {
          sport,
          groups: groupStandingsRows(rows),
          updatedAt: new Date().toISOString(),
        }
      },
    )
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    })
  } catch (err) {
    console.error('[standings-league] request failed:', err)
    return NextResponse.json(
      { error: 'STANDINGS_UNAVAILABLE', message: 'Unable to load standings' },
      { status: 500 },
    )
  }
}
