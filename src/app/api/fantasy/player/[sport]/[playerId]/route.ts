import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { formatProjStats } from '@/lib/fantasy/steal-engine'
import { searchWeb } from '@/lib/wigolo'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'
import { buildNbaDatabase } from '@/lib/fantasy/nba/nba-db'
import { nbaFantasyPoints, nbaSeasonId, nbaStatLineText } from '@/lib/fantasy/nba/nba-scoring'

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
    if (lowerSport === 'nba') return await nbaPlayer(id, url)

    const seasonParam = url.searchParams.get('season')
    const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear()
    if (isNaN(season)) {
      return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
    }

    const { players: unified } = await buildUnifiedDatabase({ season })

    let player: FantasyPlayerEnriched | undefined
    for (const u of unified) {
      const normalized = unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched
      if (normalized.id === id) {
        player = normalized
        break
      }
    }

    if (!player) {
      return NextResponse.json({ error: 'player-not-found', playerId: id }, { status: 404 })
    }

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
          adpRank: player.pprRank,
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
      { error: 'player-fetch-failed', message: 'Unable to load fantasy player' },
      { status: 500 },
    )
  }
}

async function nbaPlayer(id: number, url: URL): Promise<NextResponse> {
  const seasonParam = url.searchParams.get('season')
  const season = seasonParam ? parseInt(seasonParam, 10) : nbaSeasonId()
  if (isNaN(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
  }
  const { players } = await buildNbaDatabase({ season })
  const p = players.find((x) => x.id === id)
  if (!p) return NextResponse.json({ error: 'player-not-found', playerId: id }, { status: 404 })

  const s = p.sleeper
  const news = await searchWeb(`${p.name} ${p.team === 'FA' ? '' : p.team} NBA`.trim(), 'nba', url.origin)
  const injured = p.injured || (p.injuryStatus !== 'ACTIVE' && p.injuryStatus !== 'unknown')

  return NextResponse.json(
    {
      playerId: id,
      name: p.name,
      pos: p.eligible.join('/') || p.pos,
      team: p.team,
      bio: {
        age: s?.age,
        yearsExp: s?.yearsExp,
        height: formatHeight(s?.height),
        weight: s?.weight,
        college: s?.college,
        jersey: s?.number,
      },
      injury: {
        injured,
        status: p.injuryStatus === 'unknown' ? (s?.injuryStatus ?? 'ACTIVE') : p.injuryStatus,
      },
      projection: p.projection
        ? { points: Math.round(nbaFantasyPoints(p.projection)), line: `${nbaStatLineText(p.projection)} over ${p.projection.gp} GP` }
        : null,
      lastSeason: p.prior ? { year: p.priorSeason, points: Math.round(nbaFantasyPoints(p.prior)) } : null,
      market: {
        adpRank: p.standardRank ?? p.adp,
        adpSource: 'espn',
        ownedPct: Math.round(p.percentOwned),
        startedPct: Math.round(p.percentStarted),
        auctionValue: Math.round(p.auctionValueAverage),
      },
      vegas: null,
      outlook: p.outlook,
      news: news.slice(0, 4).map((n) => ({ title: n.title, url: n.url, source: n.source, snippet: n.snippet })),
      newsSource: 'wigolo',
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
  )
}
