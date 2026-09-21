/**
 * League stat leaders via the ESPN core API `leagues/.../leaders` endpoint.
 * Athlete/team $refs are resolved in parallel and cached (leaders move
 * slowly; athlete bios and team tables barely move at all).
 */

import { fetchOrCache } from '@/lib/cache/cacheService'
import { espnSportMap } from '@/lib/providers/espn'
import type { SportKey, StatLeader } from '@/lib/models'

export type LeaderGroup = 'offense' | 'defense'

export interface LeaderCategory {
  key: string
  label: string
  group: LeaderGroup
}

export const LEADER_CATEGORIES: Record<SportKey, LeaderCategory[]> = {
  NFL: [
    { key: 'passingYards', label: 'Pass Yds', group: 'offense' },
    { key: 'passingTouchdowns', label: 'Pass TD', group: 'offense' },
    { key: 'rushingYards', label: 'Rush Yds', group: 'offense' },
    { key: 'receivingYards', label: 'Rec Yds', group: 'offense' },
    { key: 'sacks', label: 'Sacks', group: 'defense' },
    { key: 'interceptions', label: 'INT', group: 'defense' },
    { key: 'totalTackles', label: 'Tackles', group: 'defense' },
  ],
  NBA: [
    { key: 'pointsPerGame', label: 'PPG', group: 'offense' },
    { key: 'reboundsPerGame', label: 'RPG', group: 'offense' },
    { key: 'assistsPerGame', label: 'APG', group: 'offense' },
    { key: 'stealsPerGame', label: 'SPG', group: 'defense' },
    { key: 'blocksPerGame', label: 'BPG', group: 'defense' },
  ],
  NHL: [
    { key: 'goals', label: 'Goals', group: 'offense' },
    { key: 'assists', label: 'Assists', group: 'offense' },
    { key: 'points', label: 'Points', group: 'offense' },
    { key: 'savePct', label: 'SV%', group: 'defense' },
    { key: 'wins', label: 'Goalie Wins', group: 'defense' },
  ],
  MLB: [
    { key: 'avg', label: 'AVG', group: 'offense' },
    { key: 'homeRuns', label: 'HR', group: 'offense' },
    { key: 'RBIs', label: 'RBI', group: 'offense' },
    { key: 'hits', label: 'Hits', group: 'offense' },
    { key: 'ERA', label: 'ERA', group: 'defense' },
    { key: 'strikeouts', label: 'SO', group: 'defense' },
  ],
}

/** Section headings per sport (MLB/NHL groups aren't offense/defense). */
export const LEADER_GROUP_LABELS: Record<SportKey, Record<LeaderGroup, string>> = {
  NFL: { offense: 'Offense', defense: 'Defense' },
  NBA: { offense: 'Offense', defense: 'Defense' },
  NHL: { offense: 'Skaters', defense: 'Goalies' },
  MLB: { offense: 'Batting', defense: 'Pitching' },
}

/** Season year the core API expects (mirrors the roster route's convention). */
export function leadersSeasonYear(sport: SportKey, now: Date = new Date()): number {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  switch (sport) {
    case 'NFL': return month >= 8 ? year : year - 1
    case 'NBA':
    case 'NHL': return month >= 10 ? year : year - 1
    case 'MLB': return year
  }
}

/** Athlete $ref -> numeric ESPN athlete id. */
export function parseAthleteId(ref: unknown): string | null {  if (typeof ref !== 'string') return null
  const m = /\/athletes\/(\d+)/.exec(ref)
  return m ? m[1] : null
}

/** Team $ref -> numeric ESPN team id. */
export function parseTeamRefId(ref: unknown): string | null {
  if (typeof ref !== 'string') return null
  const m = /\/teams\/(\d+)/.exec(ref)
  return m ? m[1] : null
}

const THREE_DECIMAL_CATS = new Set(['avg', 'onBasePct', 'slugAvg', 'OPS', 'savePct', 'FreeThrowPct', '3PointPct'])
const TWO_DECIMAL_CATS = new Set(['ERA', 'WHIP'])

/**
 * Leader display value. ESPN batting/pitching displayValues are composite
 * scouting lines ("177-565, 6 HR, ...") — useless in a leaders table. When
 * the display is composite, fall back to the numeric value with
 * category-appropriate precision (.313, 1.95, 44).
 */
export function formatLeaderValue(categoryKey: string, displayValue: unknown, valueNum: unknown): string {
  const display = typeof displayValue === 'string' ? displayValue : ''
  const num = typeof valueNum === 'number' && Number.isFinite(valueNum) ? valueNum : null
  if (!display.includes(',') || num == null) return display
  if (THREE_DECIMAL_CATS.has(categoryKey)) {
    return num < 1 ? num.toFixed(3).replace(/^0/, '') : num.toFixed(3)
  }
  if (TWO_DECIMAL_CATS.has(categoryKey)) return num.toFixed(2)
  return String(Math.round(num))
}

const ATHLETE_TTL_MS = 6 * 60 * 60 * 1000
const TEAM_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** ESPN's core API intermittently 404s on valid paths — retry with backoff. */
async function fetchJson(url: string): Promise<any | null> {
  const delays = [500, 1500]
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (res.ok) return await res.json()
      if (attempt === delays.length) return null
    } catch {
      if (attempt === delays.length) return null
    }
    await new Promise((r) => setTimeout(r, delays[attempt]))
  }
  return null
}

/** Bounded parallel map: full bursts trip the provider's connection limits. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

async function resolveAthlete(athleteRef: string): Promise<{
  name: string
  position: string | null
  headshot: string | null
  teamRef: string | null
} | null> {
  const data = await fetchOrCache(
    `leaders:athlete:${athleteRef}`,
    ATHLETE_TTL_MS,
    () => fetchJson(athleteRef),
  )
  if (!data) return null
  return {
    name: typeof data.displayName === 'string' ? data.displayName : '',
    position: typeof data.position?.abbreviation === 'string' ? data.position.abbreviation : null,
    headshot: typeof data.headshot?.href === 'string' ? data.headshot.href : null,
    teamRef: typeof data.team?.['$ref'] === 'string' ? data.team['$ref'] : null,
  }
}

async function resolveTeamAbbr(sport: SportKey, teamRef: string): Promise<string | null> {
  const abbr = await fetchOrCache(
    `leaders:team:${sport}:${teamRef}`,
    TEAM_TTL_MS,
    async () => {
      const data = await fetchJson(teamRef)
      const raw = data?.abbreviation
      return typeof raw === 'string' && raw ? raw.toUpperCase() : null
    },
  )
  return abbr ?? null
}

export interface LeaderBoard {
  key: string
  label: string
  group: LeaderGroup
  leaders: StatLeader[]
}

/** Boards in category order, split into offense then defense sections. */
export function groupLeaderBoards(boards: LeaderBoard[]): { group: LeaderGroup; boards: LeaderBoard[] }[] {
  const out: { group: LeaderGroup; boards: LeaderBoard[] }[] = []
  for (const group of ['offense', 'defense'] as const) {
    const mine = boards.filter((b) => b.group === group)
    if (mine.length > 0) out.push({ group, boards: mine })
  }
  const ungrouped = boards.filter((b) => b.group !== 'offense' && b.group !== 'defense')
  if (ungrouped.length > 0) out.push({ group: 'offense', boards: ungrouped })
  return out
}

const LEADERS_PER_CATEGORY = 5

export interface LeaderBoardsResult {
  boards: LeaderBoard[]
  /** Season year the numbers come from. */
  season: number
  /** True when the current season has no data yet and these are last season's. */
  isPreviousSeason: boolean
}

async function boardsForSeason(sport: SportKey, season: number): Promise<LeaderBoard[]> {
  // Site-API map is "football/nfl"; the core API needs "football/leagues/nfl".
  const [sportName, leagueName] = espnSportMap[sport].split('/')
  const data = await fetchJson(
    `https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/seasons/${season}/types/2/leaders`,
  )
  const categories: any[] = Array.isArray(data?.categories) ? data.categories : []
  const wanted = LEADER_CATEGORIES[sport]

  const boards = await mapLimit(wanted, 3, async ({ key, label, group }) => {
      const cat = categories.find((c) => c?.name === key)
      const raw: any[] = Array.isArray(cat?.leaders) ? cat.leaders.slice(0, LEADERS_PER_CATEGORY) : []
      const leaders = await mapLimit(raw, 5, async (entry, i): Promise<StatLeader | null> => {
          const athleteRef = entry?.athlete?.['$ref']
          const playerId = parseAthleteId(athleteRef)
          if (!athleteRef || !playerId) return null
          const athlete = await resolveAthlete(athleteRef)
          if (!athlete || !athlete.name) return null
          const teamAbbr = athlete.teamRef ? await resolveTeamAbbr(sport, athlete.teamRef).catch(() => null) : null
          return {
            category: key,
            label,
            playerId,
            playerName: athlete.name,
            teamAbbr,
            value: formatLeaderValue(key, entry?.displayValue, entry?.value),
            valueNum: typeof entry?.value === 'number' ? entry.value : null,
            rank: i + 1,
          }
        })
      return { key, label, group, leaders: leaders.filter((l): l is StatLeader => l != null) }
    },
  )
  return boards.filter((b) => b.leaders.length > 0)
}

/**
 * Current-season boards; when the season hasn't started (no data yet),
 * falls back to last season's final boards rather than showing nothing.
 * The result flags which season the numbers come from — never mislabeled.
 */
export async function fetchStatLeaders(sport: SportKey): Promise<LeaderBoardsResult> {
  const season = leadersSeasonYear(sport)
  const current = await boardsForSeason(sport, season)
  if (current.length > 0) return { boards: current, season, isPreviousSeason: false }
  const previous = await boardsForSeason(sport, season - 1)
  return { boards: previous, season: season - 1, isPreviousSeason: true }
}
