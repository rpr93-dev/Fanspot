import type { CanonicalPlayer, IntegrationLog } from './player-types'
import { FANTASY_POSITIONS_NFL } from './player-types'
import { PRO_TEAM_MAPPER } from '../fantasy-types'
import { SLEEPER_BASE, SLEEPER_PLAYERS_TTL_MS } from '../providers/fantasy-constants'
import { fetchOrCache, getCached, setCached } from '../cache/cacheService'

const SLEEPER_MASTER_CACHE_KEY = 'sleeper:master:nfl'

/**
 * ESPN gives every team defense a deterministic negative id: -16000 minus the pro team
 * id. Sleeper's DEF records carry no `espn_id`, and the two names never agree
 * ("Pittsburgh Steelers" vs "Steelers D/ST"), so deriving the id is the only exact
 * join available — name matching would fall through to fuzzy and mispair defenses.
 */
const ESPN_DST_ID_BASE = -16000

const PRO_TEAM_ID_BY_ABBR = new Map<string, number>(
  Object.entries(PRO_TEAM_MAPPER.nfl).map(([id, abbr]) => [abbr, Number(id)]),
)

function espnDstId(team: string): number | undefined {
  const proTeamId = PRO_TEAM_ID_BY_ABBR.get(team.toUpperCase())
  return proTeamId != null && proTeamId > 0 ? ESPN_DST_ID_BASE - proTeamId : undefined
}

const logs: IntegrationLog[] = []

function log(level: IntegrationLog['level'], source: string, message: string, details?: Record<string, unknown>) {
  const entry: IntegrationLog = { timestamp: Date.now(), level, source, message, details }
  logs.push(entry)
  const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]'
  console.log(`${prefix} [sleeper-master] ${message}`, details ?? '')
}

export function getSleeperMasterLogs(): IntegrationLog[] {
  return [...logs]
}

export async function fetchSleeperPlayersRaw(): Promise<Record<string, Record<string, unknown>>> {
  const url = `${SLEEPER_BASE}/players/nfl`
  log('info', 'sleeper', `Fetching all NFL players from Sleeper`)

  const data = await fetchOrCache(
    SLEEPER_MASTER_CACHE_KEY,
    SLEEPER_PLAYERS_TTL_MS,
    async () => {
      const res = await fetch(url, {
        headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'Fanspot-Bot/1.0' },
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        throw new Error(`Sleeper returned ${res.status}`)
      }
      const json: unknown = await res.json()
      if (typeof json !== 'object' || json === null) {
        throw new Error('Sleeper response not an object')
      }
      return json as Record<string, Record<string, unknown>>
    },
  )

  log('info', 'sleeper', `Received ${Object.keys(data).length} total players from Sleeper`)
  return data
}

/**
 * Heuristic retirement detector for the unreliable `active` flag in Sleeper's dump.
 *
 * The authoritative "still draftable this season" signal is the ESPN kona_player_info
 * dump, which only includes players that ESPN considers draftable for the requested
 * season. This heuristic just trims the most obviously retired names from the upstream
 * Sleeper master so they don't even reach the ESPN enrichment step (and waste cycles).
 *
 * Rules are deliberately conservative and gated on `!team` to avoid purging signed
 * veterans like Matthew Stafford (LAR, 17 yrs exp, 38yo) or Aaron Rodgers (PIT, 21
 * yrs exp, 42yo) who are still real, draftable players.
 *
 * The years_exp >= 18 guard catches stale-team outliers — Ben Roethlisberger, whom
 * Sleeper still has at team="PIT" but who is genuinely retired. It additionally
 * requires the absence of a depth chart slot, because that is the only field that
 * separates Roethlisberger from Aaron Rodgers: both are PIT quarterbacks in Sleeper's
 * data at 18+ years and 39+, and Sleeper's `status` reads "Active" for both. Only
 * Rodgers is listed on the depth chart.
 */
function likelyRetired(raw: Record<string, unknown>): boolean {
  const yearsExp = (raw.years_exp as number) ?? 0
  const team = (raw.team as string) || ''
  const age = (raw.age as number) ?? 0
  const onDepthChart = raw.depth_chart_order != null
  if (!team) {
    if (yearsExp >= 15) return true
    if (yearsExp >= 12 && age >= 33) return true
    if (yearsExp >= 10 && age >= 35) return true
  }
  if (yearsExp >= 18 && age >= 39 && !onDepthChart) return true
  return false
}

export function sleeperToCanonical(sleeperId: string, raw: Record<string, unknown>): CanonicalPlayer | null {
  const fullName = raw.full_name as string | undefined
  const firstName = raw.first_name as string | undefined
  const lastName = raw.last_name as string | undefined
  const position = (raw.position as string) || ''
  const team = (raw.team as string) || ''
  const sport = (raw.sport as string) || ''
  const active = (raw.active as boolean) ?? true
  const yearsExp = (raw.years_exp as number) ?? 0

  if (sport !== 'nfl') return null
  if (!active) return null

  // Team defenses are a fantasy position but not a person: Sleeper stores them with a
  // city/mascot split and no `full_name`, no age and no experience, so the person-shaped
  // validation and the retirement heuristic below both reject them outright.
  if (position === 'DEF') {
    if (!team || !firstName || !lastName) return null
    return {
      sleeperId,
      espnId: espnDstId(team),
      fullName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      position: 'D/ST',
      team,
      yearsExp: 0,
      rookie: false,
      active: true,
    }
  }

  if (!fullName || !firstName || !lastName) return null
  if (likelyRetired(raw)) {
    log('info', 'sleeper', `Skipping likely retired player: ${fullName} (years_exp=${yearsExp}, team=${team || 'FA'}, age=${raw.age})`)
    return null
  }

  const age = raw.age as number | undefined
  const college = raw.college as string | undefined
  const height = raw.height as string | undefined
  const weight = raw.weight as number | undefined

  return {
    sleeperId,
    espnId: raw.espn_id as number | undefined,
    gsisId: raw.gsis_id as string | undefined,
    pfrId: raw.pfr_id as string | undefined,
    fullName,
    firstName,
    lastName,
    position,
    team,
    age,
    yearsExp,
    rookie: yearsExp === 0,
    active,
    college,
    height,
    weight,
  }
}

export interface MasterPlayerList {
  players: CanonicalPlayer[]
  bySleeperId: Map<string, CanonicalPlayer>
  byEspnId: Map<number, CanonicalPlayer>
  byGsisId: Map<string, CanonicalPlayer>
  byPfrId: Map<string, CanonicalPlayer>
  rawBySleeperId: Map<string, Record<string, unknown>>
  count: number
  fantasyCount: number
}

export async function buildMasterPlayerList(): Promise<MasterPlayerList> {
  const raw = await fetchSleeperPlayersRaw()

  const players: CanonicalPlayer[] = []
  const bySleeperId = new Map<string, CanonicalPlayer>()
  const byEspnId = new Map<number, CanonicalPlayer>()
  const byGsisId = new Map<string, CanonicalPlayer>()
  const byPfrId = new Map<string, CanonicalPlayer>()
  const rawBySleeperId = new Map<string, Record<string, unknown>>()

  let skipped = 0
  let fantasyCount = 0

  for (const [id, rawPlayer] of Object.entries(raw)) {
    const canonical = sleeperToCanonical(id, rawPlayer)
    if (!canonical) {
      skipped++
      continue
    }

    players.push(canonical)
    bySleeperId.set(id, canonical)
    rawBySleeperId.set(id, rawPlayer)

    // ESPN ids for team defenses are negative (-16000 - proTeamId), so this guard
    // rejects only the 0/absent case rather than everything below zero.
    if (canonical.espnId != null && canonical.espnId !== 0) {
      byEspnId.set(canonical.espnId, canonical)
    }
    if (canonical.gsisId) {
      byGsisId.set(canonical.gsisId, canonical)
    }
    if (canonical.pfrId) {
      byPfrId.set(canonical.pfrId, canonical)
    }
    if (FANTASY_POSITIONS_NFL.has(canonical.position)) {
      fantasyCount++
    }
  }

  log('info', 'sleeper', `Master list: ${players.length} active players (${fantasyCount} fantasy-relevant), ${skipped} skipped`)

  return { players, bySleeperId, byEspnId, byGsisId, byPfrId, rawBySleeperId, count: players.length, fantasyCount }
}

export function clearMasterPlayerCache(): void {
  const cached = getCached<Record<string, Record<string, unknown>>>(SLEEPER_MASTER_CACHE_KEY)
  if (cached) {
    setCached(SLEEPER_MASTER_CACHE_KEY, cached.data)
  }
}
