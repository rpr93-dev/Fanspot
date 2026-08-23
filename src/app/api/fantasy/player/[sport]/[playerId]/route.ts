import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { computeMarketAdp, formatProjStats } from '@/lib/fantasy/steal-engine'
import { searchWeb } from '@/lib/wigolo'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'

/** Sleeper reports height as inches for some players and as a `6'2"` string for others. */
function formatHeight(raw: unknown): string | undefined {
  if (typeof raw === 'number') return `${Math.floor(raw / 12)}'${raw % 12}"`
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const asNumber = Number(raw)
  if (!Number.isNaN(asNumber) && asNumber > 0) return `${Math.floor(asNumber / 12)}'${asNumber % 12}"`
  return raw
}

function str(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

function num(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sport: string; playerId: string }> },
): Promise<NextResponse> {
  try {
    const { sport, playerId } = await params
    const lowerSport = sport.toLowerCase() as FantasySport

    if (!(SUPPORTED_SPORTS as readonly string[]).includes(lowerSport)) {
      return NextResponse.json({ error: `invalid-sport: ${sport}` }, { status: 400 })
    }
    if (!isFantasySportLive(lowerSport)) {
      return NextResponse.json({ error: 'sport-not-available', sport: lowerSport }, { status: 501 })
    }

    const id = parseInt(playerId, 10)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'invalid-playerId' }, { status: 400 })
    }

    const url = new URL(req.url)
    const seasonParam = url.searchParams.get('season')
    const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear()
    if (isNaN(season)) {
      return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
    }

    const { players: unified } = await buildUnifiedDatabase({ season })

    // Map every row once: the within-position ADP rank must be computed over the same
    // full pool the Steals board ranks, not just the requested player.
    const normalized = unified.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )
    const player = normalized.find((p) => p.id === id)

    if (!player) {
      return NextResponse.json({ error: 'player-not-found', playerId: id }, { status: 404 })
    }

    const marketAdp = computeMarketAdp(player, normalized)

    const s = player.sleeper as Record<string, unknown> | undefined
    const name = player.player.fullName
    const team = player.proTeamAbbr || 'FA'

    const news = await searchWeb(`${name} ${team === 'FA' ? '' : team}`.trim(), lowerSport, url.origin)

    return NextResponse.json(
      {
        playerId: id,
        name,
        pos: player.normalizedPosition,
        team,
        bio: {
          age: num(s?.age),
          yearsExp: num(s?.years_exp),
          height: formatHeight(s?.height),
          weight: str(s?.weight) ?? num(s?.weight)?.toString(),
          college: str(s?.college),
          jersey: str(s?.number) ?? num(s?.number)?.toString(),
          depthChartOrder: num(s?.depth_chart_order),
        },
        injury: {
          injured: player.player.injured ?? false,
          status: player.player.injuryStatus ?? 'ACTIVE',
        },
        projection: player.projection?.points
          ? { points: Math.round(player.projection.points), line: formatProjStats(player) }
          : null,
        lastSeason: player.seasonActuals
          ? { year: player.seasonActualsYear, points: Math.round(player.seasonActuals.points) }
          : null,
        market: {
          // Board-consistent within-position rank, plus the league-wide rank, both
          // labelled so the card can never contradict the board's ADP figure.
          adpRank: marketAdp.adpRank,
          overallAdpRank: marketAdp.overallAdpRank,
          adpLabel: marketAdp.label,
          adpSource: player.adpSource ?? 'espn',
          ownedPct: Math.round(player.player.ownership?.percentOwned ?? 0),
          startedPct: Math.round(player.player.ownership?.percentStarted ?? 0),
          auctionValue: Math.round(player.auctionValue ?? 0),
        },
        vegas: player.vegas?.teamImpliedPoints != null
          ? { teamImpliedPoints: player.vegas.teamImpliedPoints }
          : null,
        news: news.slice(0, 4).map((n) => ({
          title: n.title,
          url: n.url,
          source: n.source,
          snippet: n.snippet,
        })),
        newsSource: 'wigolo',
        generatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
    )
  } catch (err) {
    console.error('[api/fantasy/player]', err)
    return NextResponse.json(
      { error: 'player-fetch-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
