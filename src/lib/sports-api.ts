/**
 * Sports data API — entry point for the dashboard.
 * Delegates to the provider system internally.
 *
 * Public API (used by page.tsx):
 *   getTeamSchedule, getTeamNews, getEspnAbbr
 *   + exported types: EspnEvent, EspnArticle, EspnCompetitor, etc.
 */

export interface EspnScore {
  value: number
  displayValue: string
}

export interface EspnTeam {
  id: string
  abbreviation: string
  displayName: string
  logo?: string
}

export interface EspnCompetitor {
  id: string
  team: EspnTeam
  score?: EspnScore
  winner?: boolean
  homeAway: 'home' | 'away'
}

export interface EspnSeasonType {
  id: string
  type: number
  name: string
  abbreviation?: string
}

export interface EspnVenue {
  fullName: string
  address?: { city: string; state: string }
}

export interface EspnOddsItem {
  provider: { name: string }
  details: string
  overUnder: string
  spread: number
  homeTeamOdds: { moneyLine: number }
  awayTeamOdds: { moneyLine: number }
}

export interface EspnEvent {
  id: string
  name: string
  shortName: string
  date: string
  seasonType?: EspnSeasonType
  season?: { year: number; type: number; slug?: string }
  competitions: Array<{
    competitors: EspnCompetitor[]
    venue?: EspnVenue
    odds?: EspnOddsItem[]
    status: {
      type: {
        id: string
        name: string
        state: string
        completed: boolean
        description: string
        detail: string
        shortDetail: string
      }
    }
  }>
}

export interface EspnArticle {
  headline: string
  description: string
  published: string
  links: { web: { href: string } }
  images?: Array<{ url: string }>
  categories?: Array<{
    id: string
    type: string
    team?: { id: string; abbreviation: string; displayName: string }
  }>
}

import { getTeamSchedule as orchestratorSchedule, getTeamNews as orchestratorNews } from '@/lib/providers'
import { getEspnAbbr as espnAbbrLookup } from '@/lib/providers/espn'

export function getEspnAbbr(teamId: string, teamAbbreviation: string): string {
  return espnAbbrLookup(teamId, teamAbbreviation)
}

export async function getTeamSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
): Promise<{ upcoming: EspnEvent | null; lastFive: EspnEvent[] }> {
  try {
    return await orchestratorSchedule(sport, teamId, teamAbbreviation)
  } catch (err) {
    console.error(`[sports-api] getTeamSchedule error for ${sport}/${teamAbbreviation}:`, err)
    return { upcoming: null, lastFive: [] }
  }
}

export async function getTeamNews(
  sport: string,
  teamId: string,
  teamName: string,
  teamAbbreviation: string,
): Promise<EspnArticle[]> {
  try {
    return await orchestratorNews(sport, teamId, teamName, teamAbbreviation)
  } catch (err) {
    console.error(`[sports-api] getTeamNews error for ${sport}/${teamAbbreviation}:`, err)
    return []
  }
}


