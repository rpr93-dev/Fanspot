import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase } from '@/lib/fantasy/unified-db'
import { unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'

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

    if (!isFantasySportLive(lowerSport)) {
      return NextResponse.json(
        { error: 'sport-not-available', sport: lowerSport, message: `Fantasy data for ${lowerSport.toUpperCase()} is not available yet.` },
        { status: 501 },
      )
    }

    const url = new URL(_req.url)
    const seasonParam = url.searchParams.get('season')
    const currentYear = new Date().getFullYear()
    const season = seasonParam ? parseInt(seasonParam, 10) : currentYear

    if (isNaN(season)) {
      return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
    }

    const { players: unified, report } = await buildUnifiedDatabase({ season })

    const normalized: FantasyPlayerEnriched[] = unified.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )

    const response = NextResponse.json(
      {
        players: normalized,
        count: normalized.length,
        season,
        source: 'unified:sleeper+espn',
        fetchedAt: new Date().toISOString(),
        pipeline: {
          masterCount: report.masterCount,
          enrichedCount: report.enrichedCount,
          unmatchedCount: report.unmatchedCount,
          buildTimeMs: report.buildTimeMs,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      },
    )
    return response
  } catch (err) {
    console.error('[api/fantasy/players]', err)
    return NextResponse.json(
      { error: 'fantasy-fetch-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
