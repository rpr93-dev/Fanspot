const mlbTeamIds: Record<string, number> = {
  LAA: 108, AZ: 109, BAL: 110, BOS: 111, CHC: 112, CIN: 113,
  CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, LAD: 119,
  WSH: 120, NYM: 121, ATH: 133, PIT: 134, SD: 135, SEA: 136,
  SF: 137, STL: 138, TB: 139, TEX: 140, TOR: 141, MIN: 142,
  PHI: 143, ATL: 144, CWS: 145, MIA: 146, NYY: 147, MIL: 158,
}

const gameTypeMap: Record<string, number> = {
  S: 1, E: 1, R: 2, P: 3, D: 3, F: 3, L: 3, W: 3, C: 3,
}

function toEspnEvent(g: any, teamAbbr: string): any {
  const isHome = g.teams?.home?.team?.abbreviation?.toUpperCase() === teamAbbr.toUpperCase()
  const ourTeam = isHome ? g.teams?.home : g.teams?.away
  const oppTeam = isHome ? g.teams?.away : g.teams?.home
  const isFinal = g.status?.abstractGameState === 'Final'
  const ourScore = ourTeam?.score
  const oppScore = oppTeam?.score

  return {
    id: `mlb-${g.gamePk}`,
    date: g.gameDate,
    name: `${oppTeam?.team?.name} at ${ourTeam?.team?.name}`,
    shortName: `${oppTeam?.team?.abbreviation} @ ${ourTeam?.team?.abbreviation}`,
    seasonType: { id: String(gameTypeMap[g.gameType] ?? 2), type: gameTypeMap[g.gameType] ?? 2, name: g.gameType === 'S' ? 'Spring Training' : g.gameType === 'R' ? 'Regular Season' : 'Postseason' },
    season: { year: parseInt(g.season), type: gameTypeMap[g.gameType] ?? 2 },
    competitions: [{
      competitors: [
        {
          id: String(ourTeam?.team?.id ?? 0),
          team: { id: String(ourTeam?.team?.id ?? 0), abbreviation: ourTeam?.team?.abbreviation ?? teamAbbr, displayName: ourTeam?.team?.name ?? '' },
          score: ourScore != null ? { value: ourScore, displayValue: String(ourScore) } : undefined,
          winner: isFinal ? (ourScore != null && oppScore != null ? ourScore > oppScore : undefined) : undefined,
          homeAway: isHome ? 'home' : 'away',
        },
        {
          id: String(oppTeam?.team?.id ?? 0),
          team: { id: String(oppTeam?.team?.id ?? 0), abbreviation: oppTeam?.team?.abbreviation ?? '', displayName: oppTeam?.team?.name ?? '' },
          score: oppScore != null ? { value: oppScore, displayValue: String(oppScore) } : undefined,
          winner: isFinal ? (oppScore != null && ourScore != null ? oppScore > ourScore : undefined) : undefined,
          homeAway: isHome ? 'away' : 'home',
        },
      ],
      venue: g.venue ? { fullName: g.venue.name } : undefined,
      status: {
        type: {
          id: isFinal ? '3' : '1',
          name: isFinal ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
          state: isFinal ? 'post' : 'pre',
          completed: isFinal,
          description: isFinal ? 'Final' : new Date(g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
          detail: isFinal ? 'Final' : new Date(g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
          shortDetail: isFinal ? 'Final' : new Date(g.gameDate).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }),
        },
      },
    }],
  }
}

export async function fetchTeamSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
): Promise<{ events: any[]; problems: string[] }> {
  const problems: string[] = []
  const abbr = teamAbbreviation.toUpperCase()
  const mlbId = mlbTeamIds[abbr]

  if (!mlbId) {
    return { events: [], problems: [`No MLB Stats API team ID for ${abbr}`] }
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const seasons = [currentYear, currentYear - 1]

  let allGames: any[] = []

  for (const season of seasons) {
    try {
      const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&teamId=${mlbId}`
      const res = await fetch(url, { next: { revalidate: 300 } })
      if (!res.ok) {
        problems.push(`MLB Stats API season=${season} returned ${res.status}`)
        continue
      }
      const data = await res.json()
      if (data?.dates) {
        for (const date of data.dates) {
          if (date.games) {
            allGames = [...allGames, ...date.games]
          }
        }
      }
      if (!data?.dates || data.dates.length === 0) {
        problems.push(`MLB Stats API season=${season} returned 0 dates`)
      }
    } catch (err) {
      problems.push(`MLB Stats API season=${season} failed: ${err}`)
    }
  }

  const events = allGames.map((g) => toEspnEvent(g, abbr))

  const seen = new Set<string>()
  const unique = events.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  return { events: unique, problems }
}
