import { NextRequest, NextResponse } from 'next/server'
import { getSleeperPlayers } from '@/lib/providers/sleeper'
import { SUPPORTED_SPORTS } from '@/lib/providers/fantasy-constants'
import type { FantasySport } from '@/lib/fantasy-types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sport: string }> },
): Promise<NextResponse> {
  try {
    const { sport } = await params
    const lowerSport = sport.toLowerCase() as FantasySport

    if (!(SUPPORTED_SPORTS as readonly string[]).includes(lowerSport)) {
      return NextResponse.json(
        { error: `invalid-sport: ${sport}. Must be one of: ${SUPPORTED_SPORTS.join(', ')}` },
        { status: 400 },
      )
    }

    const players = await getSleeperPlayers(lowerSport)
    const count = Object.keys(players).length

    const response = NextResponse.json(
      { players, count, fetchedAt: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      },
    )
    return response
  } catch (err) {
    console.error('[api/fantasy/sleeper-players]', err)
    return NextResponse.json(
      { error: 'sleeper-fetch-failed' },
      { status: 500 },
    )
  }
}
