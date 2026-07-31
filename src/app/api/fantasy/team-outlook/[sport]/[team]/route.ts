import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { buildPlayerOutlook, formatProjStats } from '@/lib/fantasy/steal-engine'
import { pickTeamStarters } from '@/lib/fantasy/team-starters'
import { resolveInjuryTier } from '@/lib/fantasy/injury-gate'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sport: string; team: string }> },
): Promise<NextResponse> {
  try {
    const { sport, team } = await params
    const lowerSport = sport.toLowerCase() as FantasySport
    const teamAbbr = team.toUpperCase()

    if (!(SUPPORTED_SPORTS as readonly string[]).includes(lowerSport)) {
      return NextResponse.json({ error: `invalid-sport: ${sport}` }, { status: 400 })
    }
    if (!isFantasySportLive(lowerSport)) {
      return NextResponse.json(
        {
          error: 'sport-not-available',
          sport: lowerSport,
          message: `Fantasy outlook for ${teamAbbr} is not available — the pipeline has no ${lowerSport.toUpperCase()} projection data yet.`,
        },
        { status: 501 },
      )
    }

    const seasonParam = req.nextUrl.searchParams.get('season')
    const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear()
    if (isNaN(season)) {
      return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
    }

    const { players: unified } = await buildUnifiedDatabase({ season })
    const all: FantasyPlayerEnriched[] = unified.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )
    const byId = new Map(all.map((p) => [p.id, p]))

    const starters = pickTeamStarters(all, teamAbbr).map((pick) => {
      if (!pick.player) {
        return { pos: pick.pos, player: null, unsettled: false, reason: pick.reason }
      }
      const p = byId.get(pick.player.playerId) as FantasyPlayerEnriched
      const sleeper = p.sleeper as Record<string, unknown> | undefined
      const injury = resolveInjuryTier({
        espnStatus: p.player.injuryStatus,
        espnInjured: p.player.injured,
        sleeperStatus: typeof sleeper?.injury_status === 'string' ? sleeper.injury_status : undefined,
        bodyPart: typeof sleeper?.injury_body_part === 'string' ? sleeper.injury_body_part : undefined,
        notes: typeof sleeper?.injury_notes === 'string' ? sleeper.injury_notes : undefined,
      })

      return {
        pos: pick.pos,
        player: {
          playerId: pick.player.playerId,
          name: pick.player.name,
          projectedPoints: Math.round(pick.player.projectedPoints),
          statLine: formatProjStats(p),
          depthChartOrder: pick.player.depthChartOrder,
          percentStarted: Math.round(pick.player.percentStarted),
          injuryTier: injury.tier,
          injuryDetail: injury.detail || undefined,
          outlook: buildPlayerOutlook(p, all),
        },
        contender: pick.contender ? { playerId: pick.contender.playerId, name: pick.contender.name } : null,
        unsettled: pick.unsettled,
        evidence: pick.evidence,
        reason: pick.reason,
      }
    })

    return NextResponse.json(
      { sport: lowerSport, team: teamAbbr, season, starters, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'team-outlook-failed', message: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    )
  }
}
