import { validateSchedule } from '@/lib/schedule-types'
import * as espn from './espn'
import * as mlb from './mlb'
import * as nhl from './nhl'
import type { EspnEvent, EspnArticle } from '@/lib/sports-api'
import { getEspnAbbr } from './espn'

const LOG_PREFIX = '[provider]'

function log(provider: string, sport: string, team: string, problem?: string, fallbackUsed?: string) {
  if (problem) {
    console.warn(`${LOG_PREFIX} ${provider}/${sport}/${team}: ${problem}${fallbackUsed ? ` → fallback: ${fallbackUsed}` : ''}`)
  }
}

interface ScheduleResult {
  upcoming: EspnEvent | null
  lastFive: EspnEvent[]
}

function seasonTypeCoverage(events: EspnEvent[]): Set<number> {
  const types = new Set<number>()
  for (const e of events) {
    const t = e.seasonType?.type ?? e.season?.type
    if (t) types.add(t)
  }
  return types
}

function hasUpcomingGame(events: EspnEvent[]): boolean {
  const now = new Date()
  return events.some((e) => {
    const c = e.competitions?.[0]
    if (c?.status?.type?.completed || c?.status?.type?.state === 'post') return false
    if (c?.status?.type?.state === 'in') return true
    return new Date(e.date) > now
  })
}

function hasCompletedGames(events: EspnEvent[]): boolean {
  return events.some((e) => {
    const c = e.competitions?.[0]
    return c?.status?.type?.completed || c?.status?.type?.state === 'post'
  })
}

function computeResult(events: EspnEvent[]): ScheduleResult {
  const now = new Date()

  const completed = events
    .filter((e) => {
      const c = e.competitions?.[0]
      return c?.status?.type?.completed || c?.status?.type?.state === 'post'
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const lastFive = completed.slice(0, 5)

  const future = events
    .filter((e) => {
      const c = e.competitions?.[0]
      if (c?.status?.type?.completed || c?.status?.type?.state === 'post') return false
      if (c?.status?.type?.state === 'in') return false // live games handled separately
      return new Date(e.date) > now
    })

  // Live / in-progress game — prefer most recent started
  const live = events
    .filter((e) => e.competitions?.[0]?.status?.type?.state === 'in')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const upcoming = live[0] ?? future.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0] ?? null

  return { upcoming, lastFive }
}

const fallbackProviders: Record<string, typeof espn | typeof mlb | typeof nhl> = {
  MLB: mlb,
  NHL: nhl,
}

export async function getTeamSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
): Promise<ScheduleResult> {
  const teamAbbr = getEspnAbbr(teamId, teamAbbreviation)

  const espnResult = await espn.fetchTeamSchedule(sport, teamId, teamAbbreviation)
  const espnEvents = espnResult.events as EspnEvent[]

  let espnHasUpcoming = hasUpcomingGame(espnEvents)
  let espnHasCompleted = hasCompletedGames(espnEvents)

  // For NBA, also fetch Summer League games and merge
  let allEvents = [...espnEvents]
  if (sport === 'NBA') {
    const slResult = await espn.fetchSummerLeagueEvents(teamAbbr)
    if (slResult.events.length > 0) {
      const existingIds = new Set(allEvents.map((e) => e.id))
      for (const e of slResult.events) {
        if (!existingIds.has(e.id)) {
          allEvents.push(e)
          existingIds.add(e.id)
        }
      }
      if (!slResult.problems.length) {
        espnHasUpcoming = hasUpcomingGame(allEvents)
        espnHasCompleted = hasCompletedGames(allEvents)
      }
    }
    if (slResult.problems.length > 0) {
      log('ESPN', sport, teamAbbr, `Summer League: ${slResult.problems.join('; ')}`)
    }
  }

  let validation = validateSchedule(allEvents, sport, teamAbbr)
  const espnTypes = seasonTypeCoverage(allEvents)

  const issues: string[] = []

  if (!validation.valid) {
    issues.push(...validation.errors.slice(0, 5))
  }
  if (allEvents.length === 0) {
    issues.push('No events returned')
  }
  if (!espnHasUpcoming) {
    issues.push('Missing upcoming game')
  }
  if (!espnHasCompleted) {
    issues.push('No completed games')
  }

  if (sport === 'NFL') {
    if (!espnTypes.has(1)) issues.push('Missing preseason games')
    if (!espnTypes.has(3)) issues.push('Missing postseason games')
  }
  if (sport === 'NBA') {
    if (!espnTypes.has(1)) issues.push('Missing preseason games')
  }
  if (sport === 'NHL') {
    if (!espnTypes.has(1)) issues.push('Missing preseason games')
  }
  if (sport === 'MLB') {
    if (!espnTypes.has(1)) issues.push('Missing spring training games')
  }

  if (issues.length > 0) {
    log('ESPN', sport, teamAbbr, issues.join('; '))
  }

  if (validation.valid && espnHasCompleted) {
    return computeResult(allEvents)
  }

  const fallback = fallbackProviders[sport]
  if (!fallback) {
    if (allEvents.length > 0) {
      log('ESPN', sport, teamAbbr, 'Partial data accepted (no fallback available)')
      return computeResult(allEvents)
    }
    return { upcoming: null, lastFive: [] }
  }

  log('ESPN', sport, teamAbbr, 'Insufficient data, trying fallback', `${sport} API`)
  const fallbackResult = await fallback.fetchTeamSchedule(sport, teamId, teamAbbreviation)
  const fallbackEvents = fallbackResult.events as EspnEvent[]

  if (fallbackResult.problems.length > 0) {
    log(`${sport} API`, sport, teamAbbr, fallbackResult.problems.join('; '))
  }

  const merged = [...allEvents]
  const existingIds = new Set(merged.map((e) => e.id))

  for (const e of fallbackEvents) {
    if (!existingIds.has(e.id)) {
      merged.push(e)
      existingIds.add(e.id)
    }
  }

  validation = validateSchedule(merged, sport, teamAbbr)
  if (!validation.valid) {
    log('Merged', sport, teamAbbr, validation.errors.join('; '))
  }

  return computeResult(merged)
}

export async function getTeamNews(
  sport: string,
  teamId: string,
  teamName: string,
  teamAbbreviation: string,
): Promise<EspnArticle[]> {
  return espn.fetchTeamNews(sport, teamId, teamName, teamAbbreviation)
}
