import { NextResponse } from 'next/server'

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
  }

  try {
    // Try the scoreboard endpoint first
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?event=${eventId}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    const events = data?.events ?? []
    let game = events.find((e: any) => e.id === eventId)

    // The scoreboard feed only carries the current window (last game → next
    // game). Upcoming games further out are missing there; the summary
    // endpoint has any event, so translate its header into the event shape.
    if (!game) {
      const sumUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`
      const sumRes = await fetch(sumUrl, { signal: AbortSignal.timeout(10000) })
      if (sumRes.ok) {
        const sum = await sumRes.json()
        game = normalizeSummaryEvent(sum)
      }
    }

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    }

    return NextResponse.json({ game })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
