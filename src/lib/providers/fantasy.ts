import type { FantasySport, EspnFantasyResponse, EspnFantasyPlayer, FantasyPlayerEnriched } from '@/lib/fantasy-types'
import { assertEspnShape, mapProTeamId, mapPosition } from '@/lib/fantasy-types'
import { ESPN_FANTASY_BASE, ESPN_SPORT_SLUGS, FANTASY_TTL_MS } from './fantasy-constants'
import { getSleeperByEspnId } from './sleeper'

const espnFantasyCache = new Map<string, { data: EspnFantasyResponse; expiresAt: number }>()

function cacheKey(sport: FantasySport, season: number): string {
  return `${sport}:${season}`
}

function getEspnFantasyUrl(sport: FantasySport, season: number, startIndex: number): string {
  const slug = ESPN_SPORT_SLUGS[sport]
  return `${ESPN_FANTASY_BASE}/${slug}/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info&startIndex=${startIndex}&count=50`
}

const MAX_PLAYERS: Record<string, number> = {
  nfl: 600,
  nba: 400,
  nhl: 400,
  mlb: 500,
}

async function fetchPage(sport: FantasySport, season: number, startIndex: number): Promise<EspnFantasyPlayer[]> {
  const url = getEspnFantasyUrl(sport, season, startIndex)
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    console.error(`[providers/fantasy] ESPN returned ${res.status} for ${sport}/${season} at startIndex=${startIndex}`)
    return []
  }
  const data: unknown = await res.json()
  assertEspnShape(data)
  return (data as EspnFantasyResponse).players ?? []
}

export async function fetchEspnFantasySport(
  sport: FantasySport,
  season: number,
): Promise<EspnFantasyResponse> {
  const key = cacheKey(sport, season)
  const cached = espnFantasyCache.get(key)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  try {
    const maxPlayers = MAX_PLAYERS[sport] ?? 500
    const PAGE_SIZE = 50
    const allPlayers: EspnFantasyPlayer[] = []

    const firstPage = await fetchPage(sport, season, 0)
    allPlayers.push(...firstPage)

    if (firstPage.length === PAGE_SIZE) {
      const totalPages = Math.ceil(maxPlayers / PAGE_SIZE)
      const remainingPages = []
      for (let i = 1; i < totalPages; i++) {
        remainingPages.push(i)
      }

      const results = await Promise.all(
        remainingPages.map((page) => fetchPage(sport, season, page * PAGE_SIZE)),
      )

      for (const pagePlayers of results) {
        allPlayers.push(...pagePlayers)
        if (pagePlayers.length < PAGE_SIZE) break
      }
    }

    const seen = new Set<number>()
    const deduped = allPlayers.filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })

    const data: EspnFantasyResponse = { players: deduped }

    espnFantasyCache.set(key, { data, expiresAt: Date.now() + FANTASY_TTL_MS })
    return data
  } catch (err) {
    const cached = espnFantasyCache.get(key)
    if (cached) {
      console.error(`[providers/fantasy] fetch failed for ${sport}/${season}, using stale cache`, err)
      return cached.data
    }
    throw err
  }
}

export function normalizeEspnPlayer(
  raw: EspnFantasyResponse['players'][number],
  sport: FantasySport,
): FantasyPlayerEnriched {
  const proTeamAbbr = mapProTeamId(sport, raw.player.proTeamId)
  const normalizedPosition = mapPosition(sport, raw.player.defaultPositionId)

  const seasonProjection = raw.player.stats
    .filter((s) => s.statSourceId === 1 && s.statSplitTypeId === 0)
    .sort((a, b) => b.seasonId - a.seasonId)[0]

  const actualStat = raw.player.stats
    .filter((s) => s.statSourceId === 0 && s.statSplitTypeId === 0)
    .sort((a, b) => b.seasonId - a.seasonId)[0]

  let projection
  if (seasonProjection) {
    projection = { points: seasonProjection.appliedTotal, stats: seasonProjection.stats }
  } else {
    const weeklyProjections = raw.player.stats
      .filter((s) => s.statSourceId === 1 && s.statSplitTypeId === 1)
    const latestSeason = weeklyProjections.reduce((max, s) => Math.max(max, s.seasonId), 0)
    if (latestSeason > 0) {
      const seasonWeeks = weeklyProjections.filter((s) => s.seasonId === latestSeason)
      const totalPoints = seasonWeeks.reduce((sum, s) => sum + (s.appliedTotal || 0), 0)
      if (totalPoints > 0) {
        const mergedStats: Record<string, number> = {}
        for (const w of seasonWeeks) {
          if (w.stats) {
            for (const [k, v] of Object.entries(w.stats)) {
              mergedStats[k] = (mergedStats[k] || 0) + v
            }
          }
        }
        projection = { points: totalPoints, stats: mergedStats }
      }
    }
  }

  const draftRanks = raw.player.draftRanksByRankType
  const pprRank = draftRanks.PPR?.rank
  const standardRank = draftRanks.STANDARD?.rank
  const auctionValue = draftRanks.PPR?.auctionValue ?? draftRanks.STANDARD?.auctionValue ?? 0

  let positionRank = 0
  if (pprRank) positionRank = pprRank
  else if (standardRank) positionRank = standardRank

  return {
    ...raw,
    proTeamAbbr,
    normalizedPosition,
    projection,
    seasonActuals: actualStat
      ? { points: actualStat.appliedTotal, stats: actualStat.stats }
      : undefined,
    pprRank,
    standardRank,
    auctionValue,
    positionRank,
  } as FantasyPlayerEnriched
}

export async function enrichWithSleeper(
  player: FantasyPlayerEnriched,
  sport: FantasySport,
  sleeperPlayers?: Record<string, any>,
): Promise<FantasyPlayerEnriched> {
  let sleeperPlayer: Record<string, any> | undefined
  if (sleeperPlayers) {
    sleeperPlayer = Object.values(sleeperPlayers).find(
      (sp: any) => sp.espn_id === player.id,
    )
  } else {
    sleeperPlayer = getSleeperByEspnId(sport, player.id) as any
  }
  if (sleeperPlayer) {
    player.sleeper = sleeperPlayer as any
    if (sleeperPlayer.team) {
      player.proTeamAbbr = sleeperPlayer.team.toUpperCase()
    }
  }
  return player
}

export function invalidateFantasyCache(sport?: FantasySport, season?: number): void {
  if (sport && season) {
    espnFantasyCache.delete(cacheKey(sport, season))
  } else if (sport) {
    for (const key of espnFantasyCache.keys()) {
      if (key.startsWith(`${sport}:`)) espnFantasyCache.delete(key)
    }
  } else {
    espnFantasyCache.clear()
  }
}

export function getFantasyCacheStats(): { key: string; expired: boolean }[] {
  return Array.from(espnFantasyCache.entries()).map(([key, entry]) => ({
    key,
    expired: Date.now() >= entry.expiresAt,
  }))
}
