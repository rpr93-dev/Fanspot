import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, SCORING_FORMATS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { buildStealBoard, BOARD_POSITIONS, envAdjustedGap, type StealRow } from '@/lib/fantasy/steal-engine'
import { applyInjuryGate, DEFAULT_CROSS_CHECK_TOP } from '@/lib/fantasy/injury-gate'
import { getPlayerMomentum } from '@/lib/fantasy/news-momentum'
import { buildTeamEnvironment } from '@/lib/fantasy/environment'
import { getSchemeSignals } from '@/lib/fantasy/scheme-news'
import type { FantasySport, ScoringFormat, FantasyPlayerEnriched, AdpPlatform } from '@/lib/fantasy-types'

const SORTS = ['gap', 'adp', 'proj', 'scheme'] as const
type SortKey = (typeof SORTS)[number]

const METHODOLOGY =
  'Gap = ADP rank − projected rank, computed within position over every player the platform treats as draftable at that position. Positive = falling past its projected value; negative = going ahead of projection. Conf is a 0-100 projection-confidence score from prior-season production, experience, role certainty, injury status, roster share and the team offensive environment. Environment is a 0-100 team offense score from Vegas implied points (per-position weighted: WR/TE full, RB 85%, QB full, K/D-ST neutral) plus an offseason scheme narrative shift of up to ±20 when coaching/coverage news points one way (a new coordinator, a pass-heavy system, or the opposite). Environment feeds confidence and the scheme sort — it never touches the raw gap. An availability gate runs after ranking: severe or long-term injuries and suspensions are moved to the Availability Watch rather than penalised inside the score, and Doubtful players are held out of the top 10. Headlines are only cross-checked for the top 30 rows of the first page; every other row reports only what the providers designate.'

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
      { error: 'steals-fetch-failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

function sortRows(rows: StealRow[], sort: SortKey): void {
  if (sort === 'gap') rows.sort((a, b) => b.gap - a.gap || a.posRank - b.posRank)
  else if (sort === 'adp') rows.sort((a, b) => a.adpRank - b.adpRank)
  else if (sort === 'proj') rows.sort((a, b) => a.posRank - b.posRank)
  else rows.sort((a, b) => envAdjustedGap(b) - envAdjustedGap(a) || b.gap - a.gap)
}
