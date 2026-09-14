import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { getCached, setCachedChecked, isFresh } from '@/lib/cache/cacheService'
import { TTL, scheduleTtlFor } from '@/lib/cache/ttl'
import { invalidParam, isKnownEspnSport, isValidEventId } from '@/lib/api-validation'

/** Translate an ESPN summary `header` (any event, any date) into the event
 *  shape the scoreboard feed returns, so client code works unchanged. */
function normalizeSummaryEvent(sum: any): any | null {
  const header = sum?.header
  const comp = header?.competitions?.[0]
  const eventId = header?.id
  const eventDate = comp?.date ?? header?.date
  if (!header || !comp || !eventId || !eventDate) return null

  const gameInfoVenue = sum?.gameInfo?.venue
  const venue = comp.venue ?? (gameInfoVenue
    ? {
        fullName: gameInfoVenue.fullName,
        city: gameInfoVenue.address?.city,
        state: gameInfoVenue.address?.state,
      }
    : undefined)

  const weekNumber = typeof header.week === 'number' ? header.week : header.week?.number
  const seasonType = header.season?.type ?? comp.season?.type ?? null

  return {
    id: eventId,
    name: comp.name ?? header.name,
    shortName: comp.shortName ?? header.shortName,
    date: eventDate,
    week: weekNumber != null ? { number: weekNumber, text: `Week ${weekNumber}` } : undefined,
    season: { year: header.season?.year, type: seasonType },
    seasonType: seasonType != null ? { type: seasonType, id: String(seasonType) } : undefined,
    competitions: [{
      status: comp.status,
      competitors: (comp.competitors ?? []).map((c: any) => ({
        homeAway: c.homeAway,
        score: c.score ?? '',
        team: {
          id: c.team?.id,
          abbreviation: c.team?.abbreviation,
          displayName: c.team?.displayName ?? c.team?.name,
          name: c.team?.name,
          logo: c.team?.logo ?? c.team?.logos?.[0]?.href,
        },
      })),
      ...(venue ? { venue } : {}),
    }],
  }
}

async function fetchGame(sport: string, eventId: string): Promise<any | null> {
  const espnPath = espnSportMap[sport.toUpperCase()]
  // The scoreboard feed only carries the current window (last game → next
  // game). Upcoming games further out are missing there; the summary
  // endpoint has any event, so translate its header into the event shape.
  const sbRes = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?event=${encodeURIComponent(eventId)}`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (sbRes.ok) {
    const data = await sbRes.json()
    const found = (data?.events ?? []).find((e: any) => e.id === eventId)
    if (found) return found
  } else if (sbRes.status !== 404) {
    throw new Error(`ESPN scoreboard error ${sbRes.status}`)
  }

  const sumRes = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${encodeURIComponent(eventId)}`,
    { signal: AbortSignal.timeout(10000) },
  )
  if (!sumRes.ok) {
    if (sumRes.status === 404) return null
    throw new Error(`ESPN summary error ${sumRes.status}`)
  }
  return normalizeSummaryEvent(await sumRes.json())
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')
  const sportParam = searchParams.get('sport') ?? 'NFL'

  if (!eventId) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing eventId' }, { status: 400 })
  }
  if (!isValidEventId(eventId)) {
    return invalidParam('eventId must be numeric')
  }
  if (!isKnownEspnSport(sportParam)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  const sport = sportParam.toUpperCase()

  if (!espnSportMap[sport]) {
    return NextResponse.json({ error: 'INVALID_SPORT', message: 'Invalid sport' }, { status: 400 })
  }

  try {
    // Game-clock-aware TTL: live games refresh fast, finals cache long.
    const key = `game:${sport}:${eventId}`
    const peek = getCached<any>(key)
    if (peek) {
      const probe = peek.data?.game ? [peek.data.game] : []
      if (isFresh(peek.ts, scheduleTtlFor(probe))) {
        return NextResponse.json(peek.data, {
          headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
        })
      }
    }
    const game = await fetchGame(sport, eventId)
    if (!game) {
      return NextResponse.json({ error: 'GAME_NOT_FOUND', message: 'Game not found' }, { status: 404 })
    }
    const payload = { game, sport }
    setCachedChecked(key, payload)
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    })
  } catch (err) {
    console.error('[game] request failed:', err)
    return NextResponse.json({ error: 'GAME_UNAVAILABLE', message: 'Unable to load game' }, { status: 500 })
  }
}
