const gameStateMap: Record<string, boolean> = {
  OFF: true,
  FINAL: true,
  TRUE: true,
}

import { deduplicateById } from '@/lib/schedule-types'

function toEspnEvent(g: any, teamAbbr: string): any {
  const isHome = g.homeTeam?.abbrev?.toUpperCase() === teamAbbr.toUpperCase()
  const ourTeam = isHome ? g.homeTeam : g.awayTeam
  const oppTeam = isHome ? g.awayTeam : g.homeTeam
  const isFinal = gameStateMap[g.gameState] || false
  const ourScore = ourTeam?.score
  const oppScore = oppTeam?.score

  const teamName = (t: any) => {
    if (t?.placeName?.default && t?.commonName?.default) {
      return `${t.placeName.default} ${t.commonName.default}`
    }
    return t?.abbrev ?? ''
  }

  return {
    id: `nhl-${g.id}`,
    date: g.startTimeUTC || g.gameDate,
    name: `${teamName(g.awayTeam)} at ${teamName(g.homeTeam)}`,
    shortName: `${g.awayTeam?.abbrev} @ ${g.homeTeam?.abbrev}`,
    seasonType: { id: String(g.gameType), type: g.gameType, name: g.gameType === 1 ? 'Preseason' : g.gameType === 2 ? 'Regular Season' : 'Playoffs' },
    season: { year: Math.floor((g.season || 0) / 10000), type: g.gameType },
    competitions: [{
      competitors: [
        {
          id: String(ourTeam?.id ?? 0),
          team: { id: String(ourTeam?.id ?? 0), abbreviation: ourTeam?.abbrev ?? teamAbbr, displayName: teamName(ourTeam) },
          score: ourScore != null ? { value: ourScore, displayValue: String(ourScore) } : undefined,
          winner: isFinal && ourScore != null && oppScore != null ? ourScore > oppScore : undefined,
          homeAway: isHome ? 'home' : 'away',
        },
        {
          id: String(oppTeam?.id ?? 0),
          team: { id: String(oppTeam?.id ?? 0), abbreviation: oppTeam?.abbrev ?? '', displayName: teamName(oppTeam) },
          score: oppScore != null ? { value: oppScore, displayValue: String(oppScore) } : undefined,
          winner: isFinal && oppScore != null && ourScore != null ? oppScore > ourScore : undefined,
          homeAway: isHome ? 'away' : 'home',
        },
      ],
      venue: g.venue?.default ? { fullName: g.venue.default } : undefined,
      status: {
        type: {
          id: isFinal ? '3' : '1',
          name: isFinal ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
          state: isFinal ? 'post' : 'pre',
          completed: isFinal,
          description: isFinal ? 'Final' : new Date(g.startTimeUTC || g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
          detail: isFinal ? 'Final' : new Date(g.startTimeUTC || g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
          shortDetail: isFinal ? 'Final' : new Date(g.startTimeUTC || g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
        },
      },
    }],
  }
}

function getMonthsToFetch(teamAbbr: string, sport: string): string[] {
  const now = new Date()
  const months: string[] = []

  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  if (sport === 'NHL') {
    for (let offset = -12; offset <= 6; offset++) {
      const d = new Date(currentYear, currentMonth - 1 + offset, 1)
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      months.push(`${y}-${m}`)
    }
  }

  return months
}

export async function fetchTeamSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
): Promise<{ events: any[]; problems: string[] }> {
  const problems: string[] = []
  const abbr = teamAbbreviation.toUpperCase()

  const months = getMonthsToFetch(abbr, sport)
  let allGames: any[] = []
  const seenIds = new Set<string>()

  const results = await Promise.all(
    months.map(async (month) => {
      try {
        const url = `https://api-web.nhle.com/v1/club-schedule/${abbr}/month/${month}`
        const res = await fetch(url, { next: { revalidate: 300 } })
        if (!res.ok) {
          problems.push(`NHL API ${month} returned ${res.status}`)
          return []
        }
        const data = await res.json()
        return data?.games ?? []
      } catch (err) {
        problems.push(`NHL API ${month} failed: ${err}`)
        return []
      }
    })
  )

  for (const games of results) {
    for (const g of games) {
      if (!seenIds.has(String(g.id))) {
        allGames.push(g)
        seenIds.add(String(g.id))
      }
    }
  }

  const events = allGames.map((g) => toEspnEvent(g, abbr))
  const unique = deduplicateById(events)

  return { events: unique, problems }
}
