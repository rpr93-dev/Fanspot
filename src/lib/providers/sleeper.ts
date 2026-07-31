import type { FantasySport, SleeperPlayer } from '@/lib/fantasy-types'
import { SLEEPER_BASE, SLEEPER_PLAYERS_TTL_MS } from './fantasy-constants'

const sleeperPlayersCache = new Map<FantasySport, { data: Record<string, SleeperPlayer>; expiresAt: number }>()

export async function getSleeperPlayers(sport: FantasySport): Promise<Record<string, SleeperPlayer>> {
  const cached = sleeperPlayersCache.get(sport)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  try {
    const url = `${SLEEPER_BASE}/players/${sport}`
    const res = await fetch(url, {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'Fanspot-Bot/1.0',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      console.error(`[providers/sleeper] fetch error for ${sport}: ${res.status}`)
      if (cached) return cached.data
      return {}
    }

    const data: unknown = await res.json()

    if (typeof data !== 'object' || data === null) {
      console.error(`[providers/sleeper] invalid response for ${sport}: not an object`)
      if (cached) return cached.data
      return {}
    }

    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length < 100) {
      console.error(`[providers/sleeper] suspiciously few players for ${sport}: ${entries.length}`)
      if (cached) return cached.data
    }

    const players = data as Record<string, SleeperPlayer>
    sleeperPlayersCache.set(sport, { data: players, expiresAt: Date.now() + SLEEPER_PLAYERS_TTL_MS })
    return players
  } catch (err) {
    console.error(`[providers/sleeper] fetch error for ${sport}:`, err)
    if (cached) return cached.data
    return {}
  }
}

let espnIdLookupCache = new Map<FantasySport, Map<number, SleeperPlayer>>()

export function getSleeperByEspnId(sport: FantasySport, espnId: number): SleeperPlayer | undefined {
  const cache = espnIdLookupCache.get(sport)
  if (cache) return cache.get(espnId)

  const players = sleeperPlayersCache.get(sport)?.data
  if (!players || Object.keys(players).length === 0) return undefined

  const lookup = new Map<number, SleeperPlayer>()
  for (const player of Object.values(players)) {
    if (player.espn_id > 0) {
      lookup.set(player.espn_id, player)
    }
  }
  espnIdLookupCache.set(sport, lookup)
  return lookup.get(espnId)
}

export function clearSleeperCache(sport?: FantasySport): void {
  if (sport) {
    sleeperPlayersCache.delete(sport)
    espnIdLookupCache.delete(sport)
  } else {
    sleeperPlayersCache.clear()
    espnIdLookupCache.clear()
  }
}

export function getSleeperCacheStats(): { entries: number; expired: boolean }[] {
  return Array.from(sleeperPlayersCache.entries()).map(([sport, entry]) => ({
    sport,
    entries: Object.keys(entry.data).length,
    expired: Date.now() >= entry.expiresAt,
  }))
}
