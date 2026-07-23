import { getSchedule, getStandings, getOdds, getRoster, getBoxScore } from './gameService'
import { getNews } from './newsService'
import { teams } from '@/data/teams'
import { getEspnAbbr } from '@/lib/providers/espn'

export interface DashboardData {
  team: {
    id: string
    name: string
    abbreviation: string
    sport: string
    conference: string
    division: string
    colors: { primary: string; secondary: string }
  }
  schedule: {
    upcoming: any | null
    lastFive: any[]
    upcomingEventId: string | null
    upcomingDate: string | null
  }
  standings: any
  roster: any
  news: any[]
  odds: any
  boxScore: any | null
  lastUpdated: string
}

export async function getTeamDashboard(
  sport: string,
  teamId: string,
  options?: {
    eventId?: string
    includeRoster?: boolean
    includeNews?: boolean
    includeBoxScore?: boolean
    origin?: string
  },
): Promise<DashboardData> {
  const team = teams.find((t) => t.id === teamId && t.sport === sport.toUpperCase())
  if (!team) throw new Error(`Team not found: ${sport}/${teamId}`)

  const abbr = getEspnAbbr(team.id, team.abbreviation)
  const origin = options?.origin

  const schedule = await getSchedule(sport, team.id, team.abbreviation, origin)

  const standingsPromise = getStandings(sport, abbr, origin)
  let oddsPromise: Promise<any> = Promise.resolve(null)

  if (schedule.upcomingEventId && schedule.upcomingDate) {
    oddsPromise = getOdds(sport, abbr, schedule.upcomingEventId, schedule.upcomingDate, origin)
  } else {
    oddsPromise = getOdds(sport, abbr, undefined, undefined, origin)
  }

  let newsPromise: Promise<any[]> = Promise.resolve([])
  if (options?.includeNews !== false) {
    newsPromise = getNews(sport, team.name, origin)
  }

  let rosterPromise: Promise<any> = Promise.resolve(null)
  if (options?.includeRoster !== false) {
    rosterPromise = getRoster(sport, abbr, origin)
  }

  let boxScorePromise: Promise<any> = Promise.resolve(null)
  if (options?.includeBoxScore && options.eventId) {
    boxScorePromise = getBoxScore(sport, options.eventId, origin)
  }

  const [standings, odds, news, roster, boxScore] = await Promise.all([
    standingsPromise,
    oddsPromise,
    newsPromise,
    rosterPromise,
    boxScorePromise,
  ])

  return {
    team: {
      id: team.id,
      name: team.name,
      abbreviation: team.abbreviation,
      sport: team.sport,
      conference: team.conference,
      division: team.division,
      colors: { primary: team.colors.primary, secondary: team.colors.secondary },
    },
    schedule,
    standings,
    roster,
    news,
    odds,
    boxScore,
    lastUpdated: new Date().toISOString(),
  }
}
