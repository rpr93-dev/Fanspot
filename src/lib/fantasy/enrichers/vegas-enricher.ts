import type { CanonicalPlayer, PlayerVegas, IntegrationLog } from '../player-types'
import { espnFetch } from '../../espn-fetch'

const logs: IntegrationLog[] = []

function log(level: IntegrationLog['level'], source: string, message: string, details?: Record<string, unknown>) {
  const entry: IntegrationLog = { timestamp: Date.now(), level, source, message, details }
  logs.push(entry)
  console.log(`[${level.toUpperCase()}] [vegas-enricher] ${message}`, details ?? '')
}

export interface TeamVegas {
  team: string
  gamesWithOdds: number
  impliedPointsPerGame: number
  avgSpread: number
}

export interface VegasEnrichmentResult {
  vegas: Map<string, PlayerVegas>
  byTeam: Map<string, TeamVegas>
  source: string
}

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
const VEGAS_TTL_MS = 60 * 60 * 1000

/** ESPN's abbreviation for Washington differs from Sleeper's. */
const ESPN_TO_SLEEPER_TEAM: Record<string, string> = { WSH: 'WAS' }

function normalizeTeam(abbr: string | undefined): string | undefined {
  if (!abbr) return undefined
  const upper = abbr.toUpperCase()
  if (upper === 'TBD') return undefined
  return ESPN_TO_SLEEPER_TEAM[upper] ?? upper
}

interface EspnCompetitor {
  homeAway?: string
  team?: { abbreviation?: string }
}

interface EspnOdds {
  overUnder?: number
  spread?: number
  homeTeamOdds?: { favorite?: boolean }
}

interface EspnScoreboardEvent {
  competitions?: Array<{
    competitors?: EspnCompetitor[]
    odds?: EspnOdds[]
  }>
}

const teamVegasCache = new Map<string, { data: Map<string, TeamVegas>; expiresAt: number }>()

async function fetchWeekOdds(season: number, week: number): Promise<EspnScoreboardEvent[]> {
  // NOTE: ESPN rejects date *ranges* (dates=A-B → 400), so the season is
  // swept week by week instead of with one seasonDateRange query.
  const url = `${ESPN_SCOREBOARD}?seasontype=2&week=${week}&limit=100`
  const res = await espnFetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`ESPN scoreboard week ${week} returned ${res.status}`)
  const data: unknown = await res.json()
  const events = (data as { events?: EspnScoreboardEvent[] })?.events
  return Array.isArray(events) ? events : []
}

async function fetchSeasonOdds(season: number): Promise<EspnScoreboardEvent[]> {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1)
  const batches = await Promise.all(
    weeks.map((w) => fetchWeekOdds(season, w).catch(() => [] as EspnScoreboardEvent[])),
  )
  const seen = new Set<string>()
  const out: EspnScoreboardEvent[] = []
  for (const e of batches.flat()) {
    const id = String((e as { id?: unknown })?.id ?? '')
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    out.push(e)
  }
  if (out.length === 0) throw new Error('ESPN scoreboard returned no events')
  return out
}

/**
 * ESPN reports `spread` from the home team's perspective (negative = home favored),
 * so a team's implied total is half the game total adjusted by half the spread.
 */
function impliedTotals(overUnder: number, homeSpread: number): { home: number; away: number } {
  const half = overUnder / 2
  return { home: half - homeSpread / 2, away: half + homeSpread / 2 }
}

export async function buildTeamVegas(season: number): Promise<Map<string, TeamVegas>> {
  const cacheKey = `vegas:nfl:${season}`
  const cached = teamVegasCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) return cached.data

  const events = await fetchSeasonOdds(season)

  const acc = new Map<string, { points: number; spread: number; games: number }>()

  for (const event of events) {
    const comp = event.competitions?.[0]
    const odds = comp?.odds?.[0]
    if (!comp || !odds) continue

    const overUnder = odds.overUnder
    let spread = odds.spread
    if (typeof overUnder !== 'number' || typeof spread !== 'number') continue

    // ESPN occasionally reports the spread from the favorite's side rather than the home side.
    if (odds.homeTeamOdds?.favorite === true && spread > 0) spread = -spread
    if (odds.homeTeamOdds?.favorite === false && spread < 0) spread = -spread

    const home = normalizeTeam(comp.competitors?.find((c) => c.homeAway === 'home')?.team?.abbreviation)
    const away = normalizeTeam(comp.competitors?.find((c) => c.homeAway === 'away')?.team?.abbreviation)
    if (!home || !away) continue

    const implied = impliedTotals(overUnder, spread)

    for (const [team, points, teamSpread] of [
      [home, implied.home, spread],
      [away, implied.away, -spread],
    ] as const) {
      const entry = acc.get(team) ?? { points: 0, spread: 0, games: 0 }
      entry.points += points
      entry.spread += teamSpread
      entry.games += 1
      acc.set(team, entry)
    }
  }

  const byTeam = new Map<string, TeamVegas>()
  for (const [team, v] of acc) {
    byTeam.set(team, {
      team,
      gamesWithOdds: v.games,
      impliedPointsPerGame: v.points / v.games,
      avgSpread: v.spread / v.games,
    })
  }

  teamVegasCache.set(cacheKey, { data: byTeam, expiresAt: Date.now() + VEGAS_TTL_MS })
  return byTeam
}

export async function enrichVegas(
  players: CanonicalPlayer[],
  season: number,
): Promise<VegasEnrichmentResult> {
  const vegas = new Map<string, PlayerVegas>()

  let byTeam: Map<string, TeamVegas>
  try {
    byTeam = await buildTeamVegas(season)
  } catch (err) {
    log('warn', 'vegas', `Odds fetch failed; offensive environment will be omitted from scoring: ${err instanceof Error ? err.message : String(err)}`)
    return { vegas, byTeam: new Map(), source: 'unavailable' }
  }

  if (byTeam.size === 0) {
    log('warn', 'vegas', 'No Vegas odds available; offensive environment will be omitted from scoring')
    return { vegas, byTeam, source: 'unavailable' }
  }

  const ranked = [...byTeam.values()].sort((a, b) => b.impliedPointsPerGame - a.impliedPointsPerGame)
  const rankByTeam = new Map(ranked.map((t, i) => [t.team, i + 1]))

  let matched = 0
  for (const p of players) {
    const team = normalizeTeam(p.team)
    const t = team ? byTeam.get(team) : undefined
    if (!t) continue
    vegas.set(p.sleeperId, {
      teamImpliedPoints: t.impliedPointsPerGame,
      offensiveRank: rankByTeam.get(t.team),
    })
    matched++
  }

  log('info', 'vegas', `Vegas odds for ${byTeam.size} teams applied to ${matched} players`, {
    season,
    topOffense: ranked[0] ? `${ranked[0].team} ${ranked[0].impliedPointsPerGame.toFixed(1)}` : 'n/a',
  })

  return { vegas, byTeam, source: 'espn-odds' }
}
