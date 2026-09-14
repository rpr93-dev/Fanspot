import { NextResponse } from 'next/server'
import { TTL } from '@/lib/cache/ttl'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { liveSideStats } from '@/lib/scheduleWeek'

/** Compact head-to-head team stat lines for a single game (live or final),
 *  derived from the ESPN summary boxscore with a live-cadence cache. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
  }

  try {
    const data = await fetchOrCache(
      `gamestats:${eventId}`,
      TTL.LIVE_SCORE,
      async () => {
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`,
          { signal: AbortSignal.timeout(10000) },
        )
        if (!res.ok) throw new Error(`ESPN summary error ${res.status}`)
        return await res.json()
      },
    )

    const sides = liveSideStats(data?.boxscore)
    const status = data?.header?.competitions?.[0]?.status?.type ?? null
    return NextResponse.json({
      status: status
        ? {
            state: status.state,
            completed: status.completed,
            shortDetail: status.shortDetail,
            detail: status.detail,
          }
        : null,
      stats: sides,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
