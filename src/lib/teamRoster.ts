import { espnSportMap } from '@/lib/providers/espn'
import { leadersSeasonYear } from '@/lib/leaders'
import { MLB_PITCHER_POSITIONS } from '@/lib/roster-stats'
import type { SportKey } from '@/lib/models'

/**
 * ESPN team roster with each athlete's current-season stats attached
 * (`seasonStats`, keyed by ESPN core-API stat name) and a `primaryStat` used
 * to rank players within a position group. Shared by /api/roster (roster
 * panel, injury feed) and /api/props (keyless per-game projections).
 */

export class RosterFetchError extends Error {
  constructor(public status: number) {
    super(`ESPN roster error ${status}`)
  }
}

function extractPrimaryValue(sport: SportKey, stats: Record<string, string>, positionAbbr: string): { value: number; label: string } {
  const pv = (n: string) => parseFloat((stats[n] ?? '').replace(/,/g, '')) || 0

  switch (sport) {
    case 'NBA':
      return { value: pv('points'), label: 'PTS' }
    case 'NHL':
      // Goalies score no points — rank them by games played instead.
      return positionAbbr === 'G' ? { value: pv('games'), label: 'GP' } : { value: pv('points'), label: 'PTS' }
    case 'NFL': {
      const fpts = pv('fantasyPoints')
      return fpts > 0 ? { value: fpts, label: 'FPTS' } : { value: pv('totalYards'), label: 'YDS' }
    }
    case 'MLB':
      // Rank by playing time so regulars lead each position group; rate stats
      // (ERA/OPS) put a 2-inning reliever or a 5-PA call-up on top.
      return MLB_PITCHER_POSITIONS.has(positionAbbr)
        ? { value: pv('innings'), label: 'IP' }
        : { value: pv('plateAppearances'), label: 'PA' }
  }
}

/** Flatten ESPN core-API stat categories into one name → displayValue map. */
function flattenSeasonStats(json: any): Record<string, string> {
  const seasonStats: Record<string, string> = {}
  for (const cat of json?.splits?.categories ?? []) {
    if (!Array.isArray(cat.stats)) continue
    for (const s of cat.stats) {
      if (!s.name || !s.displayValue) continue
      const existing = seasonStats[s.name]
      if (!existing) {
        seasonStats[s.name] = s.displayValue
        continue
      }
      // Same name in two categories (e.g. general + offense): keep the larger.
      const existingNum = parseFloat(existing.replace(/,/g, '')) || 0
      const newNum = parseFloat(String(s.displayValue).replace(/,/g, '')) || 0
      if (newNum > existingNum) seasonStats[s.name] = s.displayValue
    }
  }
  return seasonStats
}

export async function fetchTeamRoster(sportKey: SportKey, team: string): Promise<any> {
  const espnPath = espnSportMap[sportKey]
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${encodeURIComponent(team.toUpperCase())}/roster`,
    { signal: AbortSignal.timeout(15000) },
  )
  if (!res.ok) {
    console.error(`[roster] ESPN API error ${res.status} for ${sportKey}/${team.toUpperCase()}`)
    throw new RosterFetchError(res.status)
  }
  const data = await res.json()

  // Normalise to a flat athletes array (NFL groups by offense/defense/special teams).
  if (Array.isArray(data.athletes) && data.athletes[0]?.items) {
    data.athletes = data.athletes.flatMap((group: any) => (Array.isArray(group.items) ? group.items : []))
  }
  if (!Array.isArray(data.athletes) || data.athletes.length === 0) return data

  const [sportName, leagueName] = espnPath.split('/')
  const season = leadersSeasonYear(sportKey)
  const statsResults = await Promise.allSettled(
    data.athletes.map((a: any) => {
      if (!a.id) return Promise.resolve(null)
      const url = `https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/seasons/${season}/types/2/athletes/${a.id}/statistics?lang=en&region=us`
      return fetch(url, { signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    }),
  )

  data.athletes.forEach((athlete: any, i: number) => {
    const result = statsResults[i]
    const seasonStats = result.status === 'fulfilled' ? flattenSeasonStats(result.value) : {}
    const primary = extractPrimaryValue(sportKey, seasonStats, athlete?.position?.abbreviation ?? '')
    athlete.seasonStats = Object.keys(seasonStats).length > 0 ? seasonStats : null
    athlete.primaryStat = primary.value
    athlete.primaryStatLabel = primary.label
  })

  // Players with stats first, best first.
  data.athletes.sort((a: any, b: any) => (b.primaryStat ?? -1) - (a.primaryStat ?? -1))
  return data
}
