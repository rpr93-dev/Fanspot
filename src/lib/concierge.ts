import { getEspnAbbr } from '@/lib/providers/espn'
import { teams } from '@/data/teams'

export interface ConciergeRequest {
  sport: string
  teamId: string
  teamAbbreviation: string
  pageType: 'team' | 'next-game' | 'past-game'
  focusAreas: string[]
  eventId?: string
}

export interface ConciergeSection {
  data: unknown
  available: boolean
  note?: string
}

export interface ConciergeContext {
  teamName: string
  teamAbbr: string
  sport: string
  sections: Record<string, ConciergeSection>
}

const TEAM_PAGE_FOCUS: Record<string, string[]> = {
  'Team News': ['news'],
  Injuries: ['injuries'],
  'Recent Form': ['recentForm'],
  'Win Probability Next Game': ['winProb'],
  'Roster Moves': ['rosterMoves'],
  Rumors: ['rumors'],
  'Key Player Stats': ['keyPlayerStats'],
  'Web Sources': ['webSources'],
}

const NEXT_GAME_FOCUS: Record<string, string[]> = {
  'Team Stats Comparison': ['teamStats'],
  'Key Matchups': ['keyMatchups'],
  'Injury Report': ['injuries'],
  'Recent Form (both teams)': ['recentFormBoth'],
  'Betting Line/Odds': ['odds'],
  'Historical Head-to-Head': ['headToHead'],
  'Web Sources': ['webSources'],
}

// All past-game sport-specific stats just need playerStats + linescores data
const PAST_GAME_STAT_KEYS = new Set([
  'playerStats', 'turningPoints',
])

function getPastGameFocus(sport: string): Record<string, string[]> {
  const sportKey = sport.toUpperCase()
  const anySportSpecific: Record<string, string[]> = {
    'Key Player Stats': ['playerStats'],
    'Key Turning Points': ['turningPoints'],
  }
  if (sportKey === 'NFL') {
    for (const a of ['Passing Yards', 'Rushing Yards', 'Touchdowns', 'Turnovers', 'Sacks']) {
      anySportSpecific[a] = ['playerStats']
    }
  } else if (sportKey === 'NBA') {
    for (const a of ['Points', 'Assists', 'Rebounds', 'Steals', 'Blocks']) {
      anySportSpecific[a] = ['playerStats']
    }
  } else if (sportKey === 'NHL') {
    for (const a of ['Goals', 'Assists', 'Shots on Goal', 'Hits', 'Penalty Minutes']) {
      anySportSpecific[a] = ['playerStats']
    }
  } else if (sportKey === 'MLB') {
    for (const a of ['Hits', 'Home Runs', 'RBI', 'Strikeouts', 'ERA', 'Batting Average']) {
      anySportSpecific[a] = ['playerStats']
    }
  }
  return anySportSpecific
}

function resolvePastGameFocus(sport: string, focusAreas: string[]): string[] {
  const map = getPastGameFocus(sport)
  const keys: string[] = []
  for (const area of focusAreas) {
    const mapped = map[area]
    if (mapped) keys.push(...mapped)
  }
  return [...new Set(keys)]
}

const focusKeysToSection: Record<string, string> = {}
for (const [area, keys] of Object.entries(TEAM_PAGE_FOCUS)) {
  for (const k of keys) focusKeysToSection[k] = area
}
for (const [area, keys] of Object.entries(NEXT_GAME_FOCUS)) {
  for (const k of keys) focusKeysToSection[k] = area
}

export function resolveFocusKeys(pageType: string, sport: string, focusAreas: string[]): string[] {
  if (pageType === 'past-game') return resolvePastGameFocus(sport, focusAreas)
  const map = pageType === 'team' ? TEAM_PAGE_FOCUS : NEXT_GAME_FOCUS
  const keys: string[] = []
  for (const area of focusAreas) {
    const mapped = map[area]
    if (mapped) keys.push(...mapped)
  }
  return [...new Set(keys)]
}

export async function buildConciergeContext(
  req: ConciergeRequest,
  origin: string,
): Promise<ConciergeContext> {
  const abbr = getEspnAbbr(req.teamId, req.teamAbbreviation)
  const team = teams.find(t => t.id === req.teamId && t.sport === req.sport.toUpperCase())
  const focusKeys = resolveFocusKeys(req.pageType, req.sport, req.focusAreas)
  const sections: Record<string, ConciergeSection> = {}

  const fetchJson = async (path: string): Promise<any> => {
    try {
      const res = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) })
      return res.ok ? res.json() : null
    } catch { return null }
  }

  const basePath = `/api/schedule?sport=${req.sport}&team=${abbr}`

  if (focusKeys.includes('recentForm') || focusKeys.includes('recentFormBoth')) {
    const schedule = await fetchJson(basePath)
    if (schedule?.events) {
      const completed = schedule.events
        .filter((e: any) => e.competitions?.[0]?.status?.type?.completed)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5)
        .map((e: any) => {
          const comp = e.competitions?.[0]
          const ourTeam = comp?.competitors?.find((c: any) => c.team.abbreviation === abbr)
          const opp = comp?.competitors?.find((c: any) => c.team.abbreviation !== abbr)
          return {
            date: e.date,
            opponent: opp?.team?.displayName ?? 'Unknown',
            result: ourTeam?.winner ? 'W' : 'L',
            score: ourTeam?.score?.displayValue && opp?.score?.displayValue
              ? `${ourTeam.score.displayValue}-${opp.score.displayValue}` : null,
          }
        })
      const upcoming = schedule.events
        .filter((e: any) => {
          const c = e.competitions?.[0]
          if (c?.status?.type?.completed) return false
          return new Date(e.date) > new Date()
        })
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 1)
        .map((e: any) => {
          const comp = e.competitions?.[0]
          const opp = comp?.competitors?.find((c: any) => c.team.abbreviation !== abbr)
          return {
            date: e.date,
            opponent: opp?.team?.displayName ?? 'Unknown',
            location: comp?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.abbreviation === abbr ? 'home' : 'away',
          }
        })

      sections['Recent Form'] = {
        available: completed.length > 0,
        data: { lastFive: completed, nextGame: upcoming[0] ?? null },
      }
    } else {
      sections['Recent Form'] = { available: false, data: null, note: 'Schedule data unavailable' }
    }
  }

  if (focusKeys.includes('winProb')) {
    let oddsUrl = `/api/odds?sport=${req.sport}&team=${abbr}`
    const schedule = await fetchJson(basePath)
    if (schedule?.events) {
      const upcoming = schedule.events
        .filter((e: any) => {
          const c = e.competitions?.[0]
          if (c?.status?.type?.completed) return false
          return new Date(e.date) > new Date()
        })
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
      if (upcoming?.id) {
        const gameDate = upcoming.date.slice(0, 10).replace(/-/g, '')
        oddsUrl += `&eventId=${upcoming.id}&date=${gameDate}`
      }
    }
    const oddsRes = await fetchJson(oddsUrl)
    if (oddsRes?.odds) {
      sections['Win Probability Next Game'] = {
        available: true,
        data: oddsRes.odds,
      }
    } else {
      sections['Win Probability Next Game'] = {
        available: false, data: null, note: 'Odds not yet posted for next game',
      }
    }
  }

  if (focusKeys.includes('odds')) {
    let oddsUrl = `/api/odds?sport=${req.sport}&team=${abbr}`
    const schedule = await fetchJson(basePath)
    if (schedule?.events) {
      const upcoming = schedule.events
        .filter((e: any) => {
          const c = e.competitions?.[0]
          if (c?.status?.type?.completed) return false
          return new Date(e.date) > new Date()
        })
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
      if (upcoming?.id) {
        const gameDate = upcoming.date.slice(0, 10).replace(/-/g, '')
        oddsUrl += `&eventId=${upcoming.id}&date=${gameDate}`
      }
    }
    const oddsRes = await fetchJson(oddsUrl)
    sections['Betting Line/Odds'] = {
      available: !!oddsRes?.odds,
      data: oddsRes?.odds ?? null,
      note: oddsRes?.odds ? undefined : 'Odds not yet available',
    }
  }

  if (focusKeys.includes('news')) {
    const news = await fetchJson(`/api/news-search?team=${encodeURIComponent(team?.name ?? '')}&sport=${req.sport}`)
    if (news?.articles?.length) {
      sections['Team News'] = {
        available: true,
        data: news.articles.slice(0, 8),
      }
    } else {
      sections['Team News'] = { available: false, data: null, note: 'No recent news found' }
    }
  }

  if (focusKeys.includes('injuries')) {
    const news = await fetchJson(`/api/news-search?team=${encodeURIComponent(team?.name ?? '')}&sport=${req.sport}`)
    const injuryArticles = news?.articles?.filter((a: any) =>
      /injured?|injury|out\s+for|sidelined|IR|DTD|questionable|probable/i.test(a.title || a.snippet || '')
    ) ?? []
    if (injuryArticles.length > 0) {
      sections['Injury Report'] = {
        available: true,
        data: injuryArticles.slice(0, 5),
      }
    } else {
      sections['Injury Report'] = { available: false, data: null, note: 'No recent injury news' }
    }
  }

  if (focusKeys.includes('rosterMoves') || focusKeys.includes('rumors')) {
    const news = await fetchJson(`/api/news-search?team=${encodeURIComponent(team?.name ?? '')}&sport=${req.sport}`)
    const moveArticles = news?.articles?.filter((a: any) =>
      /trade|traded|signs?|signed|signing|release[d]?|waive[d]?|cut\s*|contract|extension|deal/i.test(a.title || '')
    ) ?? []
    if (moveArticles.length > 0) {
      if (focusKeys.includes('rosterMoves')) {
        sections['Roster Moves'] = { available: true, data: moveArticles.slice(0, 5) }
      }
      if (focusKeys.includes('rumors')) {
        const rumorArticles = news.articles.filter((a: any) =>
          /report|source|insider|rumor|expected|planning/i.test(a.title || '')
        ) ?? []
        sections['Rumors'] = {
          available: rumorArticles.length > 0,
          data: rumorArticles.slice(0, 5),
          note: rumorArticles.length > 0 ? undefined : 'No recent rumors found',
        }
      }
    } else {
      if (focusKeys.includes('rosterMoves')) {
        sections['Roster Moves'] = { available: false, data: null, note: 'No recent transactions' }
      }
      if (focusKeys.includes('rumors')) {
        sections['Rumors'] = { available: false, data: null, note: 'No recent rumors found' }
      }
    }
  }

  if (focusKeys.includes('keyPlayerStats')) {
    const roster = await fetchJson(`/api/roster?sport=${req.sport}&team=${abbr}`)
    if (roster?.athletes?.length) {
      const topPlayers = roster.athletes
        .filter((a: any) => a.primaryStat > 0)
        .slice(0, 10)
        .map((a: any) => ({
          name: a.fullName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`,
          position: a.position?.abbreviation ?? '',
          primaryStat: a.primaryStat,
          primaryStatLabel: a.primaryStatLabel,
          jersey: a.jersey,
        }))
      sections['Key Player Stats'] = {
        available: topPlayers.length > 0,
        data: topPlayers,
        note: topPlayers.length > 0 ? undefined : 'Player stats not yet available for this season',
      }
    } else {
      sections['Key Player Stats'] = { available: false, data: null, note: 'Roster data unavailable' }
    }
  }

  if (focusKeys.includes('teamStats') || focusKeys.includes('keyMatchups')) {
    const schedule = await fetchJson(basePath)
    let oppAbbr: string | null = null
    let gameDate: string | null = null
    if (schedule?.events) {
      const upcoming = schedule.events
        .filter((e: any) => {
          const c = e.competitions?.[0]
          if (c?.status?.type?.completed) return false
          return new Date(e.date) > new Date()
        })
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
      if (upcoming) {
        oppAbbr = upcoming.competitions?.[0]?.competitors
          ?.find((c: any) => c.team.abbreviation !== abbr)?.team?.abbreviation ?? null
        gameDate = upcoming.date.slice(0, 10).replace(/-/g, '')
      }
    }
    if (oppAbbr) {
      const oppSchedule = await fetchJson(`/api/schedule?sport=${req.sport}&team=${oppAbbr}`)
      const oppCompleted = oppSchedule?.events
        ?.filter((e: any) => e.competitions?.[0]?.status?.type?.completed)
        ?.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        ?.slice(0, 5)
        ?.map((e: any) => {
          const comp = e.competitions?.[0]
          const opp = comp?.competitors?.find((c: any) => c.team.abbreviation !== oppAbbr)
          const t = comp?.competitors?.find((c: any) => c.team.abbreviation === oppAbbr)
          return {
            date: e.date,
            opponent: opp?.team?.displayName ?? 'Unknown',
            result: t?.winner ? 'W' : 'L',
            score: t?.score?.displayValue && opp?.score?.displayValue
              ? `${t.score.displayValue}-${opp.score.displayValue}` : null,
          }
        }) ?? []

      if (focusKeys.includes('teamStats')) {
        const ourRoster = await fetchJson(`/api/roster?sport=${req.sport}&team=${abbr}`)
        const oppRoster = await fetchJson(`/api/roster?sport=${req.sport}&team=${oppAbbr}`)
        sections['Team Stats Comparison'] = {
          available: true,
          data: {
            opponent: oppAbbr,
            ourTopPlayers: ourRoster?.athletes?.filter((a: any) => a.primaryStat > 0)?.slice(0, 5)?.map((a: any) => ({
              name: a.fullName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`,
              position: a.position?.abbreviation ?? '',
              primaryStat: a.primaryStat,
              primaryStatLabel: a.primaryStatLabel,
            })) ?? [],
            oppTopPlayers: oppRoster?.athletes?.filter((a: any) => a.primaryStat > 0)?.slice(0, 5)?.map((a: any) => ({
              name: a.fullName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`,
              position: a.position?.abbreviation ?? '',
              primaryStat: a.primaryStat,
              primaryStatLabel: a.primaryStatLabel,
            })) ?? [],
            opponentRecentForm: oppCompleted,
          },
        }
      }

      if (focusKeys.includes('keyMatchups')) {
        sections['Key Matchups'] = {
          available: true,
          data: { opponent: oppAbbr, opponentRecentForm: oppCompleted },
        }
      }

      if (focusKeys.includes('recentFormBoth') && oppCompleted.length > 0) {
        sections['Recent Form (both teams)'] = {
          available: true,
          data: { opponentRecentForm: oppCompleted },
        }
      }
    } else {
      if (focusKeys.includes('teamStats')) {
        sections['Team Stats Comparison'] = {
          available: false, data: null, note: 'No upcoming opponent found',
        }
      }
      if (focusKeys.includes('keyMatchups')) {
        sections['Key Matchups'] = {
          available: false, data: null, note: 'No upcoming opponent found',
        }
      }
    }
  }

  if (focusKeys.includes('headToHead')) {
    sections['Historical Head-to-Head'] = {
      available: false, data: null,
      note: 'Head-to-head data not available from current data sources',
    }
  }

  if (req.eventId && (focusKeys.includes('playerStats') || focusKeys.includes('turningPoints'))) {
    const bs = await fetchJson(`/api/box-score?sport=${req.sport}&eventId=${req.eventId}`)
    if (bs?.boxScore) {
      const { teams: bsTeams, playerStats } = bs.boxScore

      if (focusKeys.includes('turningPoints') && bsTeams?.length >= 2) {
        const home = bsTeams.find((t: any) => t.homeAway === 'home')
        const away = bsTeams.find((t: any) => t.homeAway === 'away')
        const turningData = {
          linescores: { home: home?.linescores ?? [], away: away?.linescores ?? [] },
          finalScore: {
            home: home?.linescores?.reduce((a: number, b: number) => a + b, 0) ?? 0,
            away: away?.linescores?.reduce((a: number, b: number) => a + b, 0) ?? 0,
          },
        }
        const pastGameFocus = getPastGameFocus(req.sport)
        for (const area of req.focusAreas) {
          if (pastGameFocus[area]?.includes('turningPoints')) {
            sections[area] = { available: true, data: turningData }
          }
        }
      }

      if (focusKeys.includes('playerStats') && playerStats?.length) {
        const allPlayers = playerStats.flatMap((t: any) =>
          t.categories?.flatMap((c: any) =>
            c.athletes?.map((a: any) => ({
              teamAbbr: t.teamAbbr,
              name: a.displayName,
              position: a.position,
              stats: a.stats,
              label: c.label,
            })) ?? []
          ) ?? []
        )
        const ourTeamAbbr = playerStats.find((t: any) =>
          t.teamAbbr === abbr || bsTeams?.find((bt: any) => bt.abbreviation === t.teamAbbr)?.abbreviation === abbr
        )?.teamAbbr ?? abbr
        const filtered = allPlayers.filter((p: any) => p.teamAbbr === ourTeamAbbr)
        const statPlayers = filtered.slice(0, 15)
        const statSection = {
          available: statPlayers.length > 0,
          data: statPlayers,
          note: statPlayers.length > 0 ? undefined : 'No player stats available',
        }
        // Store under each focus area name that maps to playerStats
        const pastGameFocus = getPastGameFocus(req.sport)
        for (const area of req.focusAreas) {
          if (pastGameFocus[area]?.includes('playerStats')) {
            sections[area] = statSection
          }
        }
      }
    } else {
      const pastGameFocus = getPastGameFocus(req.sport)
      for (const area of req.focusAreas) {
        if (!sections[area]) {
          sections[area] = { available: false, data: null, note: 'Box score data unavailable' }
        }
      }
    }
  }

  const rosterData = await fetchJson(`/api/roster?sport=${req.sport}&team=${abbr}`)
  if (rosterData?.athletes?.length) {
    sections['Team Roster'] = {
      available: true,
      data: rosterData.athletes.map((a: any) => ({
        name: a.fullName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`,
        position: a.position?.abbreviation ?? '',
        jersey: a.jersey,
      })),
    }
  } else {
    sections['Team Roster'] = {
      available: false, data: null, note: 'Roster data unavailable',
    }
  }

  if (focusKeys.includes('webSources')) {
    const name = team?.name ?? req.teamAbbreviation
    const wigoloRes = await fetchJson(`/api/wigolo?q=${encodeURIComponent(`${name} ${req.sport}`)}&sport=${req.sport}&content=true`)
    if (wigoloRes?.results?.length) {
      sections['Web Sources'] = {
        available: true,
        data: wigoloRes.results.slice(0, 5),
      }
    } else {
      sections['Web Sources'] = {
        available: false, data: null, note: 'No web sources found for this team',
      }
    }
  }

  const allFocusSectionNames = req.focusAreas
  const available = new Set(Object.keys(sections).filter(k => sections[k]?.available))

  return {
    teamName: team?.name ?? req.teamAbbreviation,
    teamAbbr: abbr,
    sport: req.sport,
    sections,
  }
}
