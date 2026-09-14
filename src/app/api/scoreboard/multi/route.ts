import { NextResponse } from 'next/server'
import { normalizeEvent, normalizeSportKey, SPORT_KEYS, type NormalizedGame, type SportKey } from '@/lib/models'
import { invalidParam, isValidDate } from '@/lib/api-validation'
import { fetchScoreboardDay } from '../route'

/**
 * Multi-league scoreboard in a single request: the global scoreboard strip
 * and homepage need all four leagues at once. One request instead of four,
 * normalized server-side so clients consume Fanspot shapes directly.
 * Partial failure is tolerated — a league that fails returns an empty list
 * with an error note rather than failing the whole response.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const sportsParam = searchParams.get('sports')

  if (!date) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing date parameter' }, { status: 400 })
  }
  if (!isValidDate(date)) {
    return invalidParam('date must be YYYYMMDD')
  }

  let sports: SportKey[] = [...SPORT_KEYS]
  if (sportsParam) {
    const parsed = sportsParam.split(',').map((s) => normalizeSportKey(s.trim()))
    if (parsed.some((s) => s == null)) {
      return invalidParam('sports must be a comma-separated subset of NFL,NBA,NHL,MLB')
    }
    sports = [...new Set(parsed as SportKey[])]
  }

  const results = await Promise.all(
    sports.map(async (sport) => {
      try {
        const data = await fetchScoreboardDay(sport, date)
        const events = Array.isArray(data?.events) ? data.events : []
        const games: NormalizedGame[] = []
        for (const e of events) {
          const g = normalizeEvent(sport, e)
          if (g) games.push(g)
        }
        return { sport, games, error: null as string | null }
      } catch (err) {
        console.error(`[scoreboard/multi] ${sport} failed:`, err)
        return { sport, games: [] as NormalizedGame[], error: 'SCOREBOARD_UNAVAILABLE' as string | null }
      }
    }),
  )

  const leagues: Record<string, NormalizedGame[]> = {}
  const errors: Record<string, string> = {}
  for (const r of results) {
    leagues[r.sport] = r.games
    if (r.error) errors[r.sport] = r.error
  }

  return NextResponse.json(
    { date, leagues, errors, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
  )
}
