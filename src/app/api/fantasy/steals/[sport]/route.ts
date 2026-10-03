import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, SCORING_FORMATS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { buildStealBoard, BOARD_POSITIONS, envAdjustedGap, type StealRow } from '@/lib/fantasy/steal-engine'
import { applyInjuryGate, DEFAULT_CROSS_CHECK_TOP } from '@/lib/fantasy/injury-gate'
import { getPlayerMomentum } from '@/lib/fantasy/news-momentum'
import { buildTeamEnvironment } from '@/lib/fantasy/environment'
import { getSchemeSignals } from '@/lib/fantasy/scheme-news'
import type { FantasySport, ScoringFormat, FantasyPlayerEnriched, AdpPlatform } from '@/lib/fantasy-types'
import { buildNbaDatabase } from '@/lib/fantasy/nba/nba-db'
import { buildNbaStealBoard, nbaRowMatchesPos } from '@/lib/fantasy/nba/nba-steal-engine'
import { NBA_POSITIONS, NBA_SCORING_FORMATS, isNbaScoring, nbaSeasonId } from '@/lib/fantasy/nba/nba-scoring'

const SORTS = ['gap', 'adp', 'proj', 'scheme'] as const
type SortKey = (typeof SORTS)[number]

const METHODOLOGY =
  'Gap = the point value the position assigns to the player\'s projected rank slot minus the point value of the slot their ADP points at — i.e. how many real fantasy points the market leaves on the table. The rank→points curve is fit against real prior-season scoring and flattened past each position\'s startable depth, so a 2-spot gap near the top of a position beats a 3-spot gap in the middle and deep-bench rank movements produce only small point deltas. The gap is normalized as a share of the player\'s own projection and weighted by the confidence score — a low-confidence waiver outlier cannot out-rank a stable, well-supported difference-maker with a smaller raw gap. Players under 5% roster share are gated off the board as unownable. Positive = falling past its projected value; negative = going ahead of projection. Conf is a 0-100 projection-confidence score from prior-season production, experience, role certainty, injury status, roster share and the team offensive environment. Environment is a 0-100 team offense score from Vegas implied points (per-position weighted: WR/TE full, RB 85%, QB full, K/D-ST neutral) plus an offseason scheme narrative shift of up to ±20 when coaching/coverage news points one way (a new coordinator, a pass-heavy system, or the opposite). Environment feeds confidence and the scheme sort — it never touches the raw gap. An availability gate runs after ranking: severe or long-term injuries and suspensions are moved to the Availability Watch rather than penalised inside the score, and Doubtful players are held out of the top 10. Headlines are only cross-checked for the top 30 rows of the first page; every other row reports only what the providers designate.'

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
        { error: 'sport-not-available', sport: lowerSport, message: `Steals for ${lowerSport.toUpperCase()} are not available yet.` },
        { status: 501 },
      )
    }

    if (lowerSport === 'nba') return await nbaSteals(req)

    const url = new URL(req.url)
    const scoringFormat = (url.searchParams.get('scoring') ?? url.searchParams.get('scoringFormat') ?? 'ppr') as ScoringFormat
    const adpPlatform = (url.searchParams.get('adpPlatform') ?? 'espn') as AdpPlatform
    const posParam = (url.searchParams.get('pos') ?? 'QB').toUpperCase()
    const sortParam = (url.searchParams.get('sort') ?? 'gap') as SortKey
    const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const teamFilter = url.searchParams.get('team')
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '40', 10) || 40, 1), 200)
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0)
    const seasonParam = url.searchParams.get('season')
    const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear()

    if (!(SCORING_FORMATS as readonly string[]).includes(scoringFormat)) {
      return NextResponse.json({ error: `invalid-scoring. Must be one of: ${SCORING_FORMATS.join(', ')}` }, { status: 400 })
    }
    if (!['espn', 'sleeper'].includes(adpPlatform)) {
      return NextResponse.json({ error: 'invalid-adpPlatform. Must be espn or sleeper' }, { status: 400 })
    }
    if (!(SORTS as readonly string[]).includes(sortParam)) {
      return NextResponse.json({ error: `invalid-sort. Must be one of: ${SORTS.join(', ')}` }, { status: 400 })
    }
    if (posParam !== 'ALL' && !(BOARD_POSITIONS as readonly string[]).includes(posParam)) {
      return NextResponse.json({ error: `invalid-pos. Must be ALL or one of: ${BOARD_POSITIONS.join(', ')}` }, { status: 400 })
    }
    if (isNaN(season)) {
      return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
    }

    const { players: unified } = await buildUnifiedDatabase({ season })

    const normalized: FantasyPlayerEnriched[] = unified.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )

    const environment = buildTeamEnvironment(normalized)
    const schemeSignals = lowerSport === 'nfl' ? await getSchemeSignals() : undefined

    const allRows = buildStealBoard(normalized, { scoringFormat, adpPlatform }, environment, schemeSignals)

    const counts: Record<string, number> = { ALL: allRows.length }
    for (const pos of BOARD_POSITIONS) {
      counts[pos] = allRows.filter((r) => r.pos === pos).length
    }

    let filtered = allRows
    if (posParam !== 'ALL') filtered = filtered.filter((r) => r.pos === posParam)
    if (teamFilter) filtered = filtered.filter((r) => r.team.toUpperCase() === teamFilter.toUpperCase())
    if (query) filtered = filtered.filter((r) => r.name.toLowerCase().includes(query))

    sortRows(filtered, sortParam)

    // The headline cross-check only runs near the top of the board, and only on the
    // first page — later pages reuse the same ordering without paying for it again.
    const { board, injuryWatch } = await applyInjuryGate(filtered, {
      sport: lowerSport,
      fetchHeadlines:
        offset === 0
          ? async (name, team, s) => (await getPlayerMomentum(name, team, s)).headlines
          : undefined,
    })

    const total = board.length
    const rows: StealRow[] = board.slice(offset, offset + limit)

    return NextResponse.json(
      {
        rows,
        injuryWatch,
        total,
        offset,
        limit,
        counts,
        positions: BOARD_POSITIONS,
        pos: posParam,
        sort: sortParam,
        scoring: scoringFormat,
        adpPlatform,
        season,
        tracked: board.length + injuryWatch.length,
        crossCheckedTop: offset === 0 ? DEFAULT_CROSS_CHECK_TOP : 0,
        generatedAt: new Date().toISOString(),
        methodology: METHODOLOGY,
        dataPipeline: 'unified-v1',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
    )
  } catch (err) {
    console.error('[api/fantasy/steals]', err)
    return NextResponse.json(
      { error: 'steals-fetch-failed', message: 'Unable to load steals board' },
      { status: 500 },
    )
  }
}

const NBA_METHODOLOGY =
  'NBA positions are fluid, so the board ranks league-wide: projected overall rank against ADP overall rank (ESPN STANDARD rank for points leagues, ROTO rank for categories, live ADP as fallback). Points = ESPN default points scoring (PTS 1, 3PM 1, FGM 2, FGA -1, FTM 1, FTA -1, REB 1, AST 2, STL 4, BLK 4, TO -2) on the season projection. Categories = 9-cat z-score value: per-game PTS, REB, AST, STL, BLK, 3PM, TO (negative) and volume-weighted FG%/FT% impact, z-scored over the ~156-player draftable pool, then scaled by projected games / 82. Gap = the value the rank curve assigns to the projected slot minus the value at the ADP slot; the curve is fit to last season’s real values and flattens past the top 150 (12 teams × 13). The gap is normalized to the startable value spread and weighted by confidence (durability = last season’s games / 82, minutes stability, injury, roster share, experience). Position filters use multi-position eligibility. Severe injuries and suspensions move to the Availability Watch; Doubtful players are held out of the top 10.'

async function nbaSteals(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const scoring = url.searchParams.get('scoring') ?? url.searchParams.get('scoringFormat') ?? 'points'
  const posParam = (url.searchParams.get('pos') ?? 'ALL').toUpperCase()
  const sortParam = (url.searchParams.get('sort') ?? 'gap') as SortKey
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const teamFilter = url.searchParams.get('team')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '40', 10) || 40, 1), 200)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0)
  const seasonParam = url.searchParams.get('season')
  const season = seasonParam ? parseInt(seasonParam, 10) : nbaSeasonId()

  if (!isNbaScoring(scoring)) {
    return NextResponse.json({ error: `invalid-scoring. NBA must be one of: ${NBA_SCORING_FORMATS.join(', ')}` }, { status: 400 })
  }
  if (!(SORTS as readonly string[]).includes(sortParam) || sortParam === 'scheme') {
    return NextResponse.json({ error: 'invalid-sort. NBA must be one of: gap, adp, proj' }, { status: 400 })
  }
  if (posParam !== 'ALL' && !(NBA_POSITIONS as readonly string[]).includes(posParam)) {
    return NextResponse.json({ error: `invalid-pos. Must be ALL or one of: ${NBA_POSITIONS.join(', ')}` }, { status: 400 })
  }
  if (isNaN(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'invalid-season' }, { status: 400 })
  }

  const { players } = await buildNbaDatabase({ season })
  const allRows = buildNbaStealBoard(players, { scoring })

  const counts: Record<string, number> = { ALL: allRows.length }
  for (const pos of NBA_POSITIONS) counts[pos] = allRows.filter((r) => nbaRowMatchesPos(r, pos)).length

  let filtered = allRows.filter((r) => nbaRowMatchesPos(r, posParam))
  if (teamFilter) filtered = filtered.filter((r) => r.team.toUpperCase() === teamFilter.toUpperCase())
  if (query) filtered = filtered.filter((r) => r.name.toLowerCase().includes(query))
  sortRows(filtered, sortParam)

  const { board, injuryWatch } = await applyInjuryGate(filtered, {
    sport: 'nba',
    fetchHeadlines:
      offset === 0 ? async (name, team, s) => (await getPlayerMomentum(name, team, s)).headlines : undefined,
  })

  return NextResponse.json(
    {
      rows: board.slice(offset, offset + limit),
      injuryWatch,
      total: board.length,
      offset,
      limit,
      counts,
      positions: NBA_POSITIONS,
      pos: posParam,
      sort: sortParam,
      scoring,
      adpPlatform: 'espn',
      season,
      tracked: board.length + injuryWatch.length,
      crossCheckedTop: offset === 0 ? DEFAULT_CROSS_CHECK_TOP : 0,
      generatedAt: new Date().toISOString(),
      methodology: NBA_METHODOLOGY,
      dataPipeline: 'nba-espn-v1',
    },
    { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
  )
}

function sortRows(rows: StealRow[], sort: SortKey): void {
  // `gap` now means the confidence-weighted, projection-normalized steal score
  // (stealScore), not raw rank spots or even raw point value.
  if (sort === 'gap') rows.sort((a, b) => b.stealScore - a.stealScore || b.valueGap - a.valueGap || a.posRank - b.posRank)
  else if (sort === 'adp') rows.sort((a, b) => a.adpRank - b.adpRank)
  else if (sort === 'proj') rows.sort((a, b) => a.posRank - b.posRank)
  else rows.sort((a, b) => envAdjustedGap(b) - envAdjustedGap(a) || b.gap - a.gap)
}
