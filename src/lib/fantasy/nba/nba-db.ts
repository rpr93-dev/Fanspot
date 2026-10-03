/**
 * NBA fantasy player database.
 *
 * ESPN's `fba` kona_player_info dump is the master list — Sleeper's NBA dump has no
 * `espn_id`, so the NFL pipeline's Sleeper-first design cannot work here. Sleeper is
 * joined only as an optional bio/injury supplement, and only on an exact normalized
 * name + team key that is unique on BOTH sides. There is no fuzzy fallback: a wrong
 * join would attach someone else's injury to a player, which is worse than no join.
 */

import { fetchEspnPage, type RawEspnPlayer } from '../enrichers/espn-enricher'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { SLEEPER_BASE, SLEEPER_PLAYERS_TTL_MS } from '@/lib/providers/fantasy-constants'
import {
  makeStatLine,
  nbaEligiblePositions,
  nbaPrimaryPosition,
  nbaSeasonId,
  nbaTeamAbbr,
  normalizeNbaName,
  sleeperNbaTeam,
  type NbaPosition,
  type NbaStatLine,
} from './nba-scoring'

export interface NbaSleeperInfo {
  sleeperId: string
  age?: number
  yearsExp?: number
  injuryStatus?: string
  injuryBodyPart?: string
  injuryNotes?: string
  status?: string
  height?: string
  weight?: string
  college?: string
  number?: string
}

export interface NbaPlayer {
  id: number
  name: string
  team: string
  proTeamId: number
  pos: NbaPosition
  eligible: NbaPosition[]
  active: boolean
  injured: boolean
  injuryStatus: string
  /** Season projection (statSourceId 1, split 0, current season). */
  projection?: NbaStatLine
  /** Last completed season's actuals (statSourceId 0, split 0, season - 1). */
  prior?: NbaStatLine
  priorSeason: number
  standardRank?: number
  rotoRank?: number
  standardAuction?: number
  rotoAuction?: number
  /** ESPN live-draft average pick. */
  adp?: number
  auctionValueAverage: number
  percentOwned: number
  percentStarted: number
  outlook?: string
  sleeper?: NbaSleeperInfo
}

const NBA_DB_TTL_MS = 15 * 60 * 1000
const ESPN_PAGE_SIZE = 500
/** ESPN only projects ~350 NBA players; two pages sorted by roster share cover them all. */
const ESPN_MAX_PLAYERS = 1000

const cache = new Map<string, { players: NbaPlayer[]; expiresAt: number }>()
const inFlight = new Map<string, Promise<NbaPlayer[]>>()

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** Pure: one raw ESPN fba row -> NbaPlayer, or null when it isn't a real NBA player. */
export function parseEspnNbaPlayer(raw: RawEspnPlayer, season: number): NbaPlayer | null {
  const p = raw.player
  if (!p) return null
  const pos = nbaPrimaryPosition(p.defaultPositionId)
  if (!pos) return null

  const stats = p.stats ?? []
  const pick = (source: number, seasonId: number) =>
    stats.find((s) => s.statSourceId === source && s.statSplitTypeId === 0 && s.seasonId === seasonId)?.stats
  const projection = makeStatLine(pick(1, season))
  const prior = makeStatLine(pick(0, season - 1), 0)

  const ranks = p.draftRanksByRankType ?? {}
  const own = p.ownership ?? ({} as RawEspnPlayer['player']['ownership'])
  const adp = num(own.averageDraftPosition)

  return {
    id: p.id,
    name: p.fullName,
    team: nbaTeamAbbr(p.proTeamId),
    proTeamId: p.proTeamId,
    pos,
    eligible: nbaEligiblePositions(p.defaultPositionId, p.eligibleSlots),
    active: p.active !== false,
    injured: p.injured === true,
    // ESPN omits the field for players nobody reported on — unknown, not ACTIVE.
    injuryStatus: typeof p.injuryStatus === 'string' && p.injuryStatus ? p.injuryStatus : 'unknown',
    projection,
    prior: prior && prior.gp > 0 ? prior : undefined,
    priorSeason: season - 1,
    standardRank: num(ranks.STANDARD?.rank),
    rotoRank: num(ranks.ROTO?.rank),
    standardAuction: num(ranks.STANDARD?.auctionValue),
    rotoAuction: num(ranks.ROTO?.auctionValue),
    adp: adp != null && adp > 0 ? adp : undefined,
    auctionValueAverage: num(own.auctionValueAverage) ?? 0,
    percentOwned: num(own.percentOwned) ?? 0,
    percentStarted: num(own.percentStarted) ?? 0,
    outlook: str((p as unknown as Record<string, unknown>).seasonOutlook),
  }
}

type SleeperRow = Record<string, unknown>

function joinKey(name: string, team: string): string {
  return `${normalizeNbaName(name)}|${team}`
}

/**
 * Pure: attaches Sleeper bio/injury to ESPN players on an exact normalized name + team
 * key, only where that key is unique among ESPN players AND among Sleeper players.
 * Returns the number of players joined.
 */
export function joinSleeperNba(players: NbaPlayer[], sleeperRows: SleeperRow[]): number {
  const espnCount = new Map<string, number>()
  for (const p of players) {
    if (p.team === 'FA') continue
    const k = joinKey(p.name, p.team)
    espnCount.set(k, (espnCount.get(k) ?? 0) + 1)
  }

  const sleeperByKey = new Map<string, SleeperRow[]>()
  for (const row of sleeperRows) {
    const team = sleeperNbaTeam(str(row.team))
    const name =
      str(row.full_name) ?? [str(row.first_name), str(row.last_name)].filter(Boolean).join(' ')
    if (!team || !name) continue
    const k = joinKey(name, team)
    const list = sleeperByKey.get(k)
    if (list) list.push(row)
    else sleeperByKey.set(k, [row])
  }

  let joined = 0
  for (const p of players) {
    if (p.team === 'FA') continue
    const k = joinKey(p.name, p.team)
    if (espnCount.get(k) !== 1) continue
    const matches = sleeperByKey.get(k)
    if (!matches || matches.length !== 1) continue
    const s = matches[0]
    p.sleeper = {
      sleeperId: str(s.player_id) ?? '',
      age: num(s.age),
      yearsExp: num(s.years_exp),
      injuryStatus: str(s.injury_status),
      injuryBodyPart: str(s.injury_body_part),
      injuryNotes: str(s.injury_notes),
      status: str(s.status),
      height: str(s.height),
      weight: str(s.weight),
      college: str(s.college),
      number: str(s.number),
    }
    joined++
  }
  return joined
}

const SLEEPER_KEEP = [
  'player_id', 'full_name', 'first_name', 'last_name', 'team', 'age', 'years_exp',
  'injury_status', 'injury_body_part', 'injury_notes', 'status', 'height', 'weight',
  'college', 'number',
] as const

/** Sleeper's NBA dump trimmed to the fields the join reads (the raw dump is ~2.5 MB). */
async function fetchSleeperNba(): Promise<SleeperRow[]> {
  return fetchOrCache('sleeper:master:nba:trimmed', SLEEPER_PLAYERS_TTL_MS, async () => {
    const res = await fetch(`${SLEEPER_BASE}/players/nba`, {
      headers: { 'Accept-Encoding': 'gzip', 'User-Agent': 'Fanspot-Bot/1.0' },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`Sleeper NBA returned ${res.status}`)
    const json: unknown = await res.json()
    if (!json || typeof json !== 'object') throw new Error('Sleeper NBA response not an object')
    const rows: SleeperRow[] = []
    for (const row of Object.values(json as Record<string, SleeperRow>)) {
      if (!row || typeof row !== 'object' || !row.team) continue
      const slim: SleeperRow = {}
      for (const k of SLEEPER_KEEP) if (row[k] != null) slim[k] = row[k]
      rows.push(slim)
    }
    return rows
  })
}

async function fetchEspnNba(season: number): Promise<RawEspnPlayer[]> {
  const offsets: number[] = []
  for (let o = 0; o < ESPN_MAX_PLAYERS; o += ESPN_PAGE_SIZE) offsets.push(o)
  const pages = await Promise.all(
    offsets.map((o, i) =>
      fetchEspnPage(season, o, ESPN_PAGE_SIZE, 'fba').catch((err) => {
        // The first page carries every projected starter; a later page failing only
        // trims the deep tail, so it degrades rather than failing the whole board.
        if (i === 0) throw err
        console.warn(`[nba-db] ESPN page at offset ${o} failed: ${err instanceof Error ? err.message : err}`)
        return [] as RawEspnPlayer[]
      }),
    ),
  )
  const seen = new Set<number>()
  return pages.flat().filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

async function buildInternal(season: number): Promise<NbaPlayer[]> {
  const raw = await fetchEspnNba(season)
  const players: NbaPlayer[] = []
  for (const r of raw) {
    const p = parseEspnNbaPlayer(r, season)
    if (p) players.push(p)
  }
  try {
    const sleeper = await fetchSleeperNba()
    const joined = joinSleeperNba(players, sleeper)
    console.log(`[nba-db] season ${season}: ${players.length} ESPN players, ${joined} joined to Sleeper`)
  } catch (err) {
    // Sleeper only adds age/experience/injury detail — the board still stands without it.
    console.warn(`[nba-db] Sleeper NBA join skipped: ${err instanceof Error ? err.message : err}`)
  }
  return players
}

export async function buildNbaDatabase(options: { season?: number } = {}): Promise<{ players: NbaPlayer[]; season: number }> {
  const season = options.season ?? nbaSeasonId()
  const key = `nba:${season}`
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return { players: hit.players, season }

  let build = inFlight.get(key)
  if (!build) {
    build = buildInternal(season)
      .then((players) => {
        cache.set(key, { players, expiresAt: Date.now() + NBA_DB_TTL_MS })
        return players
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, build)
  }
  return { players: await build, season }
}
