import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import {
  buildAuctionBoard,
  clampSettings,
  AUCTION_POSITIONS,
  DEFAULT_STARTERS,
} from '@/lib/fantasy/auction-engine'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'

const METHODOLOGY =
  'Value over replacement. Replacement level is the projection of the last player at each position the league will actually start, given the team count and starter slots. A player is worth $1 plus their projection above that line, priced at the league-wide rate of (total money - $1 per roster slot) divided by total value over replacement. Market is ESPN\u2019s average winning bid rescaled to this league\u2019s money supply, since ESPN does not publish the budget behind its averages. Surplus is value minus market: positive means the model expects the player to go cheaper than they are worth. These are modelled figures, not quoted prices.'

export async function GET(
  req: NextRequest,
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
        {
          error: 'sport-not-available',
          sport: lowerSport,
          message: `Auction values for ${lowerSport.toUpperCase()} are not available yet.`,
        },
        { status: 501 },
      )
    }

    const url = new URL(req.url)
    const settings = clampSettings({
      budget: url.searchParams.get('budget') ?? undefined,
      teams: url.searchParams.get('teams') ?? undefined,
      rosterSize: url.searchParams.get('rosterSize') ?? undefined,
    })

    const posParam = (url.searchParams.get('pos') ?? 'ALL').toUpperCase()
    const limit = Math.max(1, Math.min(300, Number(url.searchParams.get('limit')) || 50))
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
    const team = url.searchParams.get('team')?.toUpperCase() ?? null
    const search = url.searchParams.get('search')?.toLowerCase().trim() ?? ''

    if (posParam !== 'ALL' && !(AUCTION_POSITIONS as readonly string[]).includes(posParam)) {
      return NextResponse.json(
        { error: `invalid-pos: ${posParam}. Must be ALL or one of: ${AUCTION_POSITIONS.join(', ')}` },
        { status: 400 },
      )
    }

    const season = Number(url.searchParams.get('season')) || undefined
    const db = await buildUnifiedDatabase({ season })
    const normalized = db.players.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )

    const { rows, injuryWatch, assumptions } = buildAuctionBoard(normalized, settings)

    let filtered = rows
    if (posParam !== 'ALL') filtered = filtered.filter((r) => r.pos === posParam)
    if (team) filtered = filtered.filter((r) => r.team === team)
    if (search) filtered = filtered.filter((r) => r.name.toLowerCase().includes(search))

    // Best bargains first. Rows with no market price cannot be ranked by surplus, so
    // they sort last rather than being dropped or treated as a zero-surplus buy.
    filtered = [...filtered].sort((a, b) => {
      if (a.surplus == null && b.surplus == null) return b.value - a.value
      if (a.surplus == null) return 1
      if (b.surplus == null) return -1
      return b.surplus - a.surplus
    })

    const total = filtered.length
    const page = filtered.slice(offset, offset + limit)

    return NextResponse.json(
      {
        sport: lowerSport,
        rows: page,
        injuryWatch: posParam === 'ALL' ? injuryWatch : injuryWatch.filter((r) => r.pos === posParam),
        total,
        offset,
        limit,
        settings,
        starters: DEFAULT_STARTERS,
        assumptions,
        methodology: METHODOLOGY,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      },
    )
  } catch (err) {
    console.error('[api/fantasy/auction] error:', err)
    return NextResponse.json(
      { error: 'auction-board-failed', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
