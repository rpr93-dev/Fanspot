import { TTL, STALE } from '@/lib/cache/ttl'
import { swr, fetchOrCache } from '@/lib/cache/cacheService'
import { getTeamSchedule as providerGetSchedule } from '@/lib/providers/index'

export interface GameScheduleResult {
  upcoming: any | null
  lastFive: any[]
  upcomingEventId: string | null
  upcomingDate: string | null
}

export async function getSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
  origin?: string,
): Promise<GameScheduleResult> {
  const cacheKey = `schedule:${sport}:${teamId}`
  return fetchOrCache(
    cacheKey,
    TTL.SCHEDULE,
    async () => {
      const result = await providerGetSchedule(sport, teamId, teamAbbreviation, origin)
      const upcomingEventId = result.upcoming?.id ?? null
      const upcomingDate = result.upcoming
        ? result.upcoming.date.slice(0, 10).replace(/-/g, '')
        : null
      return { ...result, upcomingEventId, upcomingDate }
    },
  )
}

function apiUrl(path: string, origin?: string): string {
  return origin ? `${origin}${path}` : path
}

export async function getStandings(
  sport: string,
  teamAbbr: string,
  origin?: string,
): Promise<any> {
  const cacheKey = `standings:${sport}:${teamAbbr}`
  return fetchOrCache(
    cacheKey,
    TTL.STANDINGS,
    async () => {
      const res = await fetch(
        apiUrl(`/api/standings?sport=${sport}&team=${teamAbbr}`, origin),
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      return res.json()
    },
  )
}

export async function getOdds(
  sport: string,
  teamAbbr: string,
  eventId?: string,
  date?: string,
  origin?: string,
): Promise<any> {
  const cacheKey = `odds:${sport}:${teamAbbr}:${eventId || 'none'}:${date || 'none'}`
  return fetchOrCache(
    cacheKey,
    TTL.ODDS,
    async () => {
      let path = `/api/odds?sport=${sport}&team=${teamAbbr}`
      if (eventId && date) path += `&eventId=${encodeURIComponent(eventId)}&date=${date}`
      const res = await fetch(apiUrl(path, origin), { signal: AbortSignal.timeout(10000) })
      if (!res.ok) return null
      return res.json()
    },
  )
}

export async function getBoxScore(
  sport: string,
  eventId: string,
  origin?: string,
): Promise<any> {
  const cacheKey = `boxscore:${sport}:${eventId}`
  return swr(
    cacheKey,
    TTL.BOX_SCORE,
    STALE.BOX_SCORE,
    async () => {
      const res = await fetch(
        apiUrl(`/api/box-score?sport=${sport}&eventId=${eventId}`, origin),
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      return res.json()
    },
  )
}

export async function getRoster(
  sport: string,
  teamAbbr: string,
  origin?: string,
): Promise<any> {
  const cacheKey = `roster:${sport}:${teamAbbr}`
  return fetchOrCache(
    cacheKey,
    TTL.ROSTER,
    async () => {
      const res = await fetch(
        apiUrl(`/api/roster?sport=${sport}&team=${teamAbbr}`, origin),
        { signal: AbortSignal.timeout(15000) },
      )
      if (!res.ok) return null
      return res.json()
    },
  )
}
