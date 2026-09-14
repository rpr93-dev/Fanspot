import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { invalidParam, isAllowedSport } from '@/lib/api-validation'
import { normalizeSportKey } from '@/lib/models'
import { fetchStatLeaders } from '@/lib/leaders'

const LEADERS_TTL_MS = 60 * 60_000 // leaders move slowly; hourly refresh

/**
 * League stat leaders (top 5 per category), each linking to a player page.
 * Best-effort: categories that fail to resolve are omitted, never faked.
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

  try {
    // Empty boards are not cached: they usually mean a transient upstream
    // blip (or an offseason with no data yet), never a stable answer worth
    // pinning for an hour.
    const cached = getCached<{ boards: unknown[] }>(`stat-leaders:${sport}`)
    let result = cached && isFresh(cached.ts, LEADERS_TTL_MS) ? (cached.data as Awaited<ReturnType<typeof fetchStatLeaders>>) : null
    if (!result) {
      result = await fetchStatLeaders(sport)
      if (result.boards.length > 0) setCached(`stat-leaders:${sport}`, result)
    }
    return NextResponse.json(
      { sport, categories: result.boards, season: result.season, isPreviousSeason: result.isPreviousSeason, updatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch (err) {
    console.error('[stat-leaders] request failed:', err)
    return NextResponse.json(
      { error: 'LEADERS_UNAVAILABLE', message: 'Unable to load stat leaders' },
      { status: 500 },
    )
  }
}
