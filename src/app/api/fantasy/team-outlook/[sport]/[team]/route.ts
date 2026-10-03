import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { buildPlayerOutlook, formatProjStats } from '@/lib/fantasy/steal-engine'
import { pickTeamStarters } from '@/lib/fantasy/team-starters'
import { resolveInjuryTier } from '@/lib/fantasy/injury-gate'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'
import { buildNbaDatabase } from '@/lib/fantasy/nba/nba-db'
import { computeNbaValues, nbaAdpFor, nbaInjury } from '@/lib/fantasy/nba/nba-steal-engine'
import { nbaSeasonId, nbaStatLineText } from '@/lib/fantasy/nba/nba-scoring'

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

    if (lowerSport === 'nba') return await nbaTeamOutlook(req, teamAbbr)

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
      { error: 'team-outlook-failed', message: 'Unable to load team outlook' },
      { status: 500 },
    )
  }
}

/** NBA rotations have no fixed depth chart in ESPN's feed: the outlook is the team's top
 *  five fantasy assets by projected points-league value, each with its per-game line. */
const NBA_OUTLOOK_SIZE = 5

async function nbaTeamOutlook(req: NextRequest, teamAbbr: string): Promise<NextResponse> {
  const seasonParam = req.nextUrl.searchParams.get('season')
  const season = seasonParam ? parseInt(seasonParam, 10) : nbaSeasonId()
  if (isNaN(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
  }
  const { players } = await buildNbaDatabase({ season })
  const projected = players.filter((p) => p.active && p.projection && p.projection.gp > 0)
  const { value } = computeNbaValues(projected, 'points')
  const overall = [...projected].sort((a, b) => (value.get(b.id) ?? 0) - (value.get(a.id) ?? 0))
  const overallRank = new Map(overall.map((p, i) => [p.id, i + 1]))

  const top = overall.filter((p) => p.team === teamAbbr).slice(0, NBA_OUTLOOK_SIZE)
  if (top.length === 0) {
    return NextResponse.json(
      { error: 'team-not-found', message: `No NBA fantasy projections found for ${teamAbbr}.` },
      { status: 404 },
    )
  }

  const starters = top.map((p) => {
    const injury = nbaInjury(p)
    const rank = overallRank.get(p.id) as number
    const adp = nbaAdpFor(p, 'points')
    const market =
      adp == null ? 'no draft rank' : adp > rank + 15 ? `drafted ~#${Math.round(adp)} — a value target` : adp < rank - 15 ? `drafted ~#${Math.round(adp)} — priced above projection` : `drafted ~#${Math.round(adp)}`
    return {
      pos: p.pos,
      player: {
        playerId: p.id,
        name: p.name,
        projectedPoints: Math.round(value.get(p.id) ?? 0),
        statLine: nbaStatLineText(p.projection),
        percentStarted: Math.round(p.percentStarted),
        injuryTier: injury.tier,
        injuryDetail: injury.detail || undefined,
        outlook: `${nbaStatLineText(p.projection)} — projected #${rank} overall, ${market}.`,
      },
      contender: null,
      unsettled: false,
      evidence: 'projection' as const,
      reason: '',
    }
  })

  return NextResponse.json(
    { sport: 'nba', team: teamAbbr, season, starters, generatedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
  )
}
