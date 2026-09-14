import { NextRequest, NextResponse } from 'next/server'
import { getTopStories } from '@/lib/news/top-stories'
import { STORY_LEAGUES, type StoryLeague } from '@/lib/news/story-ranking'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 60)

    const leagueParam = url.searchParams.get('leagues')
    let leagues: readonly StoryLeague[] = STORY_LEAGUES
    if (leagueParam) {
      const requested = leagueParam.split(',').map((l) => l.trim().toLowerCase())
      const invalid = requested.filter((l) => !(STORY_LEAGUES as readonly string[]).includes(l))
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `invalid-league: ${invalid.join(', ')}. Must be one of: ${STORY_LEAGUES.join(', ')}` },
          { status: 400 },
        )
      }
      leagues = requested as StoryLeague[]
    }

    const rankingParam = (url.searchParams.get('ranking') ?? 'significance').toLowerCase()
    if (rankingParam !== 'significance' && rankingParam !== 'balanced') {
      return NextResponse.json(
        { error: 'invalid-ranking: must be one of: significance, balanced' },
        { status: 400 },
      )
    }
    const ranking = rankingParam as 'significance' | 'balanced'

    const result = await getTopStories(leagues, limit, ranking)

    return NextResponse.json(
      {
        ...result,
        leagues,
        ranking,
        methodology:
          ranking === 'balanced'
            ? 'Recency-weighted feed: significance blended with age (36h half-life) plus favorite-team boosts applied client-side. Deduplicated; speculative coverage is halved.'
            : 'Ranked by significance, not recency: event type (trade, signing, season-ending injury, retirement, coaching change), whether a widely-followed player is named, and source prominence. Recency is only a tiebreaker, and speculative coverage (rumours, mock drafts, "could") is halved.',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' } },
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'top-stories-failed', message: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    )
  }
}
