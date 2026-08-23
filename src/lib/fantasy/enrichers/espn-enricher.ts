import type { CanonicalPlayer, PlayerProjection, PlayerAdp, PlayerRankings, PlayerOwnership, IntegrationLog, PlayerMatchResult } from '../player-types'
import { PRO_TEAM_MAPPER, POSITION_MAPPER } from '../../fantasy-types'
import { ESPN_FANTASY_BASE } from '../../providers/fantasy-constants'
import { withBackoff } from '../../backoff'
import { matchEspnPlayerToMaster, type MatchContext, type UnmatchedEspnPlayer } from '../player-matching-engine'

const logs: IntegrationLog[] = []

function log(level: IntegrationLog['level'], source: string, message: string, details?: Record<string, unknown>) {
  const entry: IntegrationLog = { timestamp: Date.now(), level, source, message, details }
  logs.push(entry)
  console.log(`[${level.toUpperCase()}] [espn-enricher] ${message}`, details ?? '')
}

const espnUrlCache = new Map<string, { data: RawEspnPlayer[]; expiresAt: number }>()

/**
 * Keep the raw ESPN pages aligned with the unified database TTL (15 min): the raw
 * dump only changes when ESPN republishes projections/ADP, so a shorter cache here
 * would re-fetch it on every unified rebuild for no freshness gain.
 */
const ESPN_ENRICH_TTL_MS = 15 * 60 * 1000

/** ESPN caps a single kona_player_info response well below this; we paginate via the filter's offset. */
const ESPN_PAGE_SIZE = 500
const ESPN_MAX_PLAYERS = 2000

function getEspnFantasyUrl(season: number): string {
  return `${ESPN_FANTASY_BASE}/ffl/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`
}

/**
 * `X-Fantasy-Filter` is the only way to page past ESPN's default slice. Sorting by
 * percent-owned gives a stable total ordering across every player, whereas draft ranks
 * are sparse and would truncate the pool at the last drafted player.
 */
function buildFantasyFilter(limit: number, offset: number): string {
  return JSON.stringify({
    players: {
      limit,
      offset,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  })
}

interface RawEspnPlayer {
  id: number
  player: {
    id: number
    firstName: string
    lastName: string
    fullName: string
    defaultPositionId: number
    proTeamId: number
    active: boolean
    injured: boolean
    injuryStatus: string
    droppable: boolean
    eligibleSlots: number[]
    jersey: string
    ownership: {
      averageDraftPosition: number
      percentOwned: number
      percentStarted: number
      auctionValueAverage: number
      activityLevel: number
    }
    draftRanksByRankType: Partial<Record<'PPR' | 'STANDARD' | 'ROTO' | 'ECR', {
      rank: number
      auctionValue: number
      rankType: string
    }>>
    stats: Array<{
      statSourceId: number
      statSplitTypeId: number
      seasonId: number
      appliedTotal: number
      appliedAverage: number
      stats: Record<string, number>
    }>
  }
  ratings: Record<number, {
    positionalRanking: number
    totalRanking: number
    totalRating?: number
  }>
  draftAuctionValue: number
  onTeamId: number
  keeperValue: number
  keeperValueFuture: number
  status: string
}

interface EspnApiResponse {
  players: RawEspnPlayer[]
}

async function fetchEspnPage(season: number, offset: number, limit: number): Promise<RawEspnPlayer[]> {
  const url = getEspnFantasyUrl(season)
  const res = await withBackoff(async () => {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Fantasy-Filter': buildFantasyFilter(limit, offset),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) throw new Error(`ESPN returned ${r.status}`)
    return r
  })
  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') {
    throw new Error('ESPN response is not an object')
  }
  const resp = data as EspnApiResponse
  if (!Array.isArray(resp.players)) {
    throw new Error('ESPN response missing players array')
  }
  return resp.players
}

export interface EspnProjectionEntry {
  canonical: CanonicalPlayer
  projection: PlayerProjection
  seasonActuals?: { points: number; stats: Record<string, number>; seasonId: number }
  adp: PlayerAdp
  rankings: PlayerRankings
  ownership: PlayerOwnership
  espnTeamId: number
  espnPositionId: number
  espnPlayerId: number
  fullName: string
  injured: boolean
  injuryStatus: string
  matchStrategy: PlayerMatchResult['strategy']
  matchConfidence: number
}

export interface EspnEnrichmentResult {
  /** Keyed by Sleeper id so name/fuzzy matches survive a missing canonical ESPN id. */
  projections: Map<string, EspnProjectionEntry>
  unmatched: UnmatchedEspnPlayer[]
  totalFetched: number
  matchedCount: number
  byStrategy: Record<string, number>
}

export async function enrichFromEspn(
  ctx: MatchContext,
  season: number,
): Promise<EspnEnrichmentResult> {
  const cacheKey = `espn:enrich:nfl:${season}`
  const cached = espnUrlCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    log('info', 'espn', `Using cached ESPN data for season ${season}`)
    return processEspnPlayers(cached.data, ctx, season)
  }

  log('info', 'espn', `Fetching ESPN fantasy data for season ${season}`)
  const allPlayers: RawEspnPlayer[] = []

  const firstPage = await fetchEspnPage(season, 0, ESPN_PAGE_SIZE)
  allPlayers.push(...firstPage)

  if (firstPage.length >= ESPN_PAGE_SIZE) {
    const offsets: number[] = []
    for (let o = firstPage.length; o < ESPN_MAX_PLAYERS; o += ESPN_PAGE_SIZE) {
      offsets.push(o)
    }
    const results = await Promise.all(
      offsets.map((o) =>
        fetchEspnPage(season, o, ESPN_PAGE_SIZE).catch((err) => {
          log('warn', 'espn', `Page at offset ${o} failed: ${err instanceof Error ? err.message : String(err)}`)
          return [] as RawEspnPlayer[]
        }),
      ),
    )
    for (const page of results) allPlayers.push(...page)
  }

  const seen = new Set<number>()
  const deduped = allPlayers.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })

  log('info', 'espn', `Fetched ${deduped.length} unique players from ESPN`)

  espnUrlCache.set(cacheKey, { data: deduped, expiresAt: Date.now() + ESPN_ENRICH_TTL_MS })

  return processEspnPlayers(deduped, ctx, season)
}

function processEspnPlayers(
  rawPlayers: RawEspnPlayer[],
  ctx: MatchContext,
  season: number,
): EspnEnrichmentResult {
  const projections = new Map<string, EspnProjectionEntry>()
  const unmatched: UnmatchedEspnPlayer[] = []
  const byStrategy: Record<string, number> = {}
  const fallbackAudit: string[] = []

  let matchedCount = 0

  for (const raw of rawPlayers) {
    const descriptor: UnmatchedEspnPlayer = {
      espnId: raw.player.id,
      fullName: raw.player.fullName,
      firstName: raw.player.firstName,
      lastName: raw.player.lastName,
      position: POSITION_MAPPER.nfl[raw.player.defaultPositionId] ?? 'UNKNOWN',
      team: PRO_TEAM_MAPPER.nfl[raw.player.proTeamId] ?? 'FA',
    }

    // Exact ESPN id first; only then name+position -> name+team -> fuzzy.
    const matchResult = matchEspnPlayerToMaster(descriptor, ctx)
    if (!matchResult) {
      unmatched.push(descriptor)
      continue
    }

    const master = matchResult.canonical
    if (!master.active) continue

    // A later ESPN row can outrank an earlier one for the same Sleeper player
    // (e.g. duplicate ESPN entries). Keep the highest-confidence match.
    const existing = projections.get(master.sleeperId)
    if (existing && existing.matchConfidence >= matchResult.confidence) continue

    if (!existing) matchedCount++
    byStrategy[matchResult.strategy] = (byStrategy[matchResult.strategy] ?? 0) + 1
    if (matchResult.strategy !== 'espn-id') {
      fallbackAudit.push(
        `${master.fullName} (${master.position}/${master.team}) <- ESPN ${raw.player.id} "${raw.player.fullName}" via ${matchResult.strategy} @ ${matchResult.confidence.toFixed(2)}`,
      )
    }

    const seasonProjection = raw.player.stats
      .filter((s) => s.statSourceId === 1 && s.statSplitTypeId === 0)
      .sort((a, b) => b.seasonId - a.seasonId)[0]

    let projection: PlayerProjection | undefined
    if (seasonProjection) {
      projection = {
        points: seasonProjection.appliedTotal,
        stats: seasonProjection.stats,
        source: 'espn',
      }
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
          projection = { points: totalPoints, stats: mergedStats, source: 'espn' }
        }
      }
    }

    const seasonActuals = extractSeasonActuals(raw, season)

    const draftRanks = raw.player.draftRanksByRankType ?? {}
    const adp: PlayerAdp = {
      ppr: draftRanks.PPR?.rank,
      standard: draftRanks.STANDARD?.rank,
      auction: draftRanks.PPR?.auctionValue ?? draftRanks.STANDARD?.auctionValue,
    }
    const rankings: PlayerRankings = {
      ppr: draftRanks.PPR?.rank,
      standard: draftRanks.STANDARD?.rank,
    }
    const ownership: PlayerOwnership = {
      percentOwned: raw.player.ownership?.percentOwned ?? 0,
      percentStarted: raw.player.ownership?.percentStarted ?? 0,
      auctionValueAverage: raw.player.ownership?.auctionValueAverage ?? 0,
      activityLevel: raw.player.ownership?.activityLevel ?? 0,
    }

    projections.set(master.sleeperId, {
      canonical: master,
      projection: projection ?? { points: 0, stats: {}, source: 'espn' },
      seasonActuals,
      adp,
      rankings,
      ownership,
      espnTeamId: raw.player.proTeamId,
      espnPositionId: raw.player.defaultPositionId,
      espnPlayerId: raw.player.id,
      fullName: raw.player.fullName,
      injured: raw.player.injured ?? false,
      injuryStatus: raw.player.injuryStatus ?? 'ACTIVE',
      matchStrategy: matchResult.strategy,
      matchConfidence: matchResult.confidence,
    })
  }

  log('info', 'espn', `Enriched ${matchedCount} players, ${unmatched.length} unmatched`, { byStrategy })

  if (fallbackAudit.length > 0) {
    log('info', 'espn-match-fallback', `${fallbackAudit.length} players matched by fallback strategy`)
    for (const line of fallbackAudit.slice(0, 50)) {
      console.log(`  [espn-match-fallback] ${line}`)
    }
  }

  return { projections, unmatched, totalFetched: rawPlayers.length, matchedCount, byStrategy }
}

/**
 * `statSourceId 0` is realized production. Only seasons before the target season are
 * considered: the target season's own actuals row exists but reads 0.0 until games are
 * played, and a real 0 for the last completed season is meaningful — it's what
 * `missedRecentSeason` keys off.
 */
function extractSeasonActuals(
  raw: RawEspnPlayer,
  season: number,
): { points: number; stats: Record<string, number>; seasonId: number } | undefined {
  const lastCompleted = raw.player.stats
    .filter((s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.seasonId < season)
    .sort((a, b) => b.seasonId - a.seasonId)[0]

  if (!lastCompleted) return undefined
  return {
    points: lastCompleted.appliedTotal ?? 0,
    stats: lastCompleted.stats ?? {},
    seasonId: lastCompleted.seasonId,
  }
}
