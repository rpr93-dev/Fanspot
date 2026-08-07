import type {
  UnifiedPlayer,
  PlayerInjury,
  IntegrationLog,
} from './player-types'
import { FANTASY_POSITIONS_NFL } from './player-types'
import { buildMasterPlayerList, getSleeperMasterLogs, clearMasterPlayerCache, type MasterPlayerList } from './sleeper-master'
import { buildMatchContext, logUnmatchedPlayers, type MatchContext } from './player-matching-engine'
import { enrichFromEspn, getEspnEnricherLogs, type EspnEnrichmentResult } from './enrichers/espn-enricher'
import { enrichInjuries, getInjuryEnricherLogs, mapInjuryStatus, type InjuryEnrichmentResult } from './enrichers/injury-enricher'
import { enrichVegas, getVegasEnricherLogs, type VegasEnrichmentResult } from './enrichers/vegas-enricher'
import { PRO_TEAM_MAPPER } from '../fantasy-types'
import type { AdpSource } from '../fantasy-types'
import { validateUnifiedDatabase, type ValidationReport } from './validation'

export type { MasterPlayerList, MatchContext }

const logs: IntegrationLog[] = []

function log(level: IntegrationLog['level'], source: string, message: string, details?: Record<string, unknown>) {
  logs.push({ timestamp: Date.now(), level, source, message, details })
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]'
  console.log(`${prefix} [unified-db] ${message}`, details ?? '')
}

export function getUnifiedDbLogs(): IntegrationLog[] {
  return [...logs, ...getSleeperMasterLogs(), ...getEspnEnricherLogs(), ...getInjuryEnricherLogs(), ...getVegasEnricherLogs()]
}

export interface BuildOptions {
  season?: number
  cacheOnly?: boolean
  skipEnrichment?: boolean
}

export interface BuildReport {
  masterCount: number
  fantasyCount: number
  enrichedCount: number
  unmatchedCount: number
  matchingStats: { total: number; byStrategy: Record<string, number>; avgConfidence: number }
  validation: ValidationReport
  buildTimeMs: number
}

let lastBuildReport: BuildReport | null = null
let unifiedCache: UnifiedPlayer[] | null = null
let cacheExpiresAt = 0

const UNIFIED_DB_TTL_MS = 2 * 60 * 1000

export function getLastBuildReport(): BuildReport | null {
  return lastBuildReport
}

export async function buildUnifiedDatabase(options: BuildOptions = {}): Promise<{
  players: UnifiedPlayer[]
  report: BuildReport
}> {
  const startTime = Date.now()

  if (unifiedCache && Date.now() < cacheExpiresAt && options.cacheOnly !== true) {
    log('info', 'cache', 'Returning cached unified database')
    return { players: unifiedCache, report: lastBuildReport as BuildReport }
  }

  const master = await buildMasterPlayerList()
  log('info', 'pipeline', `Master list: ${master.count} total, ${master.fantasyCount} fantasy-relevant`)

  const season = options.season ?? new Date().getFullYear()

  const ctx = buildMatchContext(master)

  let espnResult: EspnEnrichmentResult | undefined
  let injuryResult: InjuryEnrichmentResult | undefined
  let vegasResult: VegasEnrichmentResult | undefined

  if (!options.skipEnrichment) {
    espnResult = await enrichFromEspn(ctx, season)
    log('info', 'pipeline', `ESPN enriched ${espnResult.matchedCount}/${espnResult.totalFetched} players`, {
      byStrategy: espnResult.byStrategy,
    })

    if (espnResult.unmatched.length > 0) {
      logUnmatchedPlayers(espnResult.unmatched)
    }

    const espnInjuryMap = new Map<number, { injured: boolean; injuryStatus: string }>()
    for (const [, entry] of espnResult.projections) {
      espnInjuryMap.set(entry.espnPlayerId, { injured: entry.injured, injuryStatus: entry.injuryStatus })
    }

    injuryResult = await enrichInjuries(master.players, espnInjuryMap)
    vegasResult = await enrichVegas(master.players, season)
  }

  const unified: UnifiedPlayer[] = []
  const playerSet = new Set<string>()
  const teamConflictLog: string[] = []

  for (const canonical of master.players) {
    if (playerSet.has(canonical.sleeperId)) {
      log('warn', 'dedup', `Duplicate sleeper ID: ${canonical.sleeperId} (${canonical.fullName})`)
      continue
    }
    playerSet.add(canonical.sleeperId)

    if (!canonical.active) {
      log('info', 'pipeline', `Skipping inactive player: ${canonical.fullName} (sleeperId=${canonical.sleeperId})`)
      continue
    }

    if (!FANTASY_POSITIONS_NFL.has(canonical.position)) continue

    const player: UnifiedPlayer = {
      canonical,
      lastUpdated: { sleeper: Date.now() },
    }

    const rawSleeper = master.rawBySleeperId.get(canonical.sleeperId)
    player.rawSleeper = rawSleeper

    if (espnResult) {
      const espnEntry = espnResult.projections.get(canonical.sleeperId)
      if (espnEntry) {
        player.projection = espnEntry.projection
        player.seasonActuals = espnEntry.seasonActuals
        player.adp = espnEntry.adp
        player.rankings = espnEntry.rankings
        player.ownership = espnEntry.ownership
        player.resolvedEspnId = canonical.espnId ?? espnEntry.espnPlayerId
        player.match = { strategy: espnEntry.matchStrategy, confidence: espnEntry.matchConfidence }
        player.lastUpdated.espn = Date.now()
        player.lastUpdated.projections = Date.now()
        player.lastUpdated.adp = Date.now()

        const teamAbbr = PRO_TEAM_MAPPER.nfl?.[espnEntry.espnTeamId]
        if (teamAbbr && teamAbbr !== canonical.team) {
          teamConflictLog.push(`Team conflict: ${canonical.fullName} - Sleeper: ${canonical.team}, ESPN: ${teamAbbr}`)
        }
        player.proTeamAbbr = canonical.team || teamAbbr
        player.normalizedPosition = canonical.position

        if (espnEntry.injured || espnEntry.injuryStatus !== 'ACTIVE') {
          player.injury = {
            status: mapInjuryStatus(espnEntry.injuryStatus),
            injured: espnEntry.injured,
          }
        }
      }
    }

    // Removed the internal-projection-from-search_rank fallback.
    // Previously players absent from ESPN's kona_player_info dump (which is the case
    // for retired players like Tom Brady, Ben Roethlisberger, Cam Newton, ...)
    // received synthesized projections derived purely from their Sleeper search_rank.
    // Since retired-but-still-famous players keep a low search_rank from random fan
    // searches, they generated fake projections + ADP and ended up being scored as
    // draft steals. ESPN's kona_player_info only returns players it considers
    // draftable for the requested season, so the absence of an ESPN entry is itself
    // the strongest "relevant for this season" signal available to us. Players
    // without an ESPN entry are now skipped — no projection means no steal score.

    if (injuryResult) {
      const sleeperInjury = injuryResult.injuries.get(canonical.sleeperId)
      if (sleeperInjury && sleeperInjury.status !== 'unknown') {
        if (!player.injury || player.injury.status === 'unknown') {
          player.injury = sleeperInjury
        }
      }
    }

    if (vegasResult) {
      const v = vegasResult.vegas.get(canonical.sleeperId)
      if (v) player.vegas = v
    }

    unified.push(player)
  }

  if (teamConflictLog.length > 0) {
    for (const msg of teamConflictLog.slice(0, 10)) {
      log('warn', 'team-conflict', msg)
    }
    if (teamConflictLog.length > 10) {
      log('warn', 'team-conflict', `... and ${teamConflictLog.length - 10} more team conflicts`)
    }
  }

  const matchedPlayers = unified.filter((p) => p.match != null)
  const matchingStats = {
    total: matchedPlayers.length,
    byStrategy: matchedPlayers.reduce<Record<string, number>>((acc, p) => {
      const key = p.match?.strategy ?? 'unknown'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
    avgConfidence: matchedPlayers.length > 0
      ? matchedPlayers.reduce((s, p) => s + (p.match?.confidence ?? 0), 0) / matchedPlayers.length
      : 0,
  }

  const validation = validateUnifiedDatabase(unified)
  if (validation.issues.length > 0) {
    log('warn', 'validation', `Validation found ${validation.issues.length} issues`)
    for (const issue of validation.issues.slice(0, 5)) {
      log('warn', 'validation', issue)
    }
  }

  const buildTimeMs = Date.now() - startTime

  const report: BuildReport = {
    masterCount: master.count,
    fantasyCount: unified.length,
    enrichedCount: espnResult?.matchedCount ?? 0,
    unmatchedCount: espnResult?.unmatched.length ?? 0,
    matchingStats,
    validation,
    buildTimeMs,
  }

  lastBuildReport = report
  unifiedCache = unified
  cacheExpiresAt = Date.now() + UNIFIED_DB_TTL_MS

  log('info', 'pipeline', `Build complete: ${unified.length} unified players in ${buildTimeMs}ms`)

  return { players: unified, report }
}

export function invalidateUnifiedDb(): void {
  unifiedCache = null
  cacheExpiresAt = 0
  clearMasterPlayerCache()
  log('info', 'cache', 'Unified database cache invalidated')
}

export function unifiedToFantasyPlayerEnriched(
  unified: UnifiedPlayer,
): Record<string, unknown> {
  const resolvedEspnId = unified.canonical.espnId ?? unified.resolvedEspnId
  const syntheticEspnId = resolvedEspnId == null
  const espnId = resolvedEspnId ?? Math.abs([...unified.canonical.sleeperId].reduce((h, c) => h * 31 + c.charCodeAt(0), 0)) + 100000
  const pos = unified.canonical.position
  const posId: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, 'D/ST': 16 }
  const defaultPositionId = posId[pos] ?? 0

  const searchRank = unified.rawSleeper?.search_rank as number | undefined
  const realRank = unified.adp?.ppr ?? unified.rankings?.ppr
  const pprRank = realRank ?? searchRank
  const adpSource: AdpSource = realRank != null ? 'espn' : 'popularity_fallback'

  const sleeperData = unified.rawSleeper ?? {
    player_id: unified.canonical.sleeperId,
    first_name: unified.canonical.firstName,
    last_name: unified.canonical.lastName,
    full_name: unified.canonical.fullName,
    position: unified.canonical.position,
    team: unified.canonical.team,
    age: unified.canonical.age,
    years_exp: unified.canonical.yearsExp,
    espn_id: unified.canonical.espnId,
    search_rank: searchRank,
  }

  return {
    id: espnId,
    player: {
      id: espnId,
      fullName: unified.canonical.fullName,
      firstName: unified.canonical.firstName,
      lastName: unified.canonical.lastName,
      defaultPositionId,
      proTeamId: 0,
      active: unified.canonical.active,
      injured: unified.injury?.injured ?? false,
      // No fallback to ACTIVE: a player nobody reported on has an unknown status, and
      // claiming otherwise would let the boards describe them as healthy.
      injuryStatus: unified.injury?.status ?? 'unknown',
      ownership: {
        averageDraftPosition: pprRank ?? 999,
        percentOwned: unified.ownership?.percentOwned ?? 0,
        percentStarted: unified.ownership?.percentStarted ?? 0,
        auctionValueAverage: unified.ownership?.auctionValueAverage ?? 0,
        activityLevel: unified.ownership?.activityLevel ?? 0,
      },
      draftRanksByRankType: {
        PPR: unified.adp?.ppr ? { rank: unified.adp.ppr, auctionValue: unified.adp.auction ?? 0, rankType: 'PPR' } : undefined,
        STANDARD: unified.adp?.standard ? { rank: unified.adp.standard, auctionValue: 0, rankType: 'STANDARD' } : undefined,
      } as Record<string, unknown>,
      stats: [],
      eligibleSlots: [],
      droppable: true,
      jersey: '',
    },
    normalizedPosition: unified.normalizedPosition ?? unified.canonical.position,
    proTeamAbbr: unified.proTeamAbbr || unified.canonical.team,
    pprRank,
    adpSource,
    syntheticEspnId,
    standardRank: unified.adp?.standard ?? unified.rankings?.standard,
    auctionValue: unified.adp?.auction ?? 0,
    projection: unified.projection
      ? { points: unified.projection.points, stats: unified.projection.stats }
      : undefined,
    sleeper: sleeperData,
    vegas: unified.vegas?.teamImpliedPoints != null ? unified.vegas : undefined,
    seasonActuals: unified.seasonActuals
      ? { points: unified.seasonActuals.points, stats: unified.seasonActuals.stats }
      : undefined,
    seasonActualsYear: unified.seasonActuals?.seasonId,
    matchStrategy: unified.match?.strategy,
    matchConfidence: unified.match?.confidence,
    draftAuctionValue: unified.adp?.auction ?? 0,
    droppedByEliminatedTeam: false,
    keeperValue: 0,
    keeperValueFuture: 0,
    lineupLocked: false,
    onTeamId: 0,
    ratings: {},
    rosterLocked: false,
    status: '',
    tradeLocked: false,
    waiverProcessDate: '',
    positionRank: unified.rankings?.position ?? 0,
  }
}
