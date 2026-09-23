import { NextResponse } from 'next/server'
import { teams } from '@/data/teams'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { getEspnAbbr } from '@/lib/providers/espn'
import { buildMasterPlayerList } from '@/lib/fantasy/sleeper-master'
import { buildUnifiedDatabase } from '@/lib/fantasy/unified-db'
import type { UnifiedPlayer } from '@/lib/fantasy/player-types'
import { fetchTeamRoster } from '@/lib/teamRoster'
import { groupByPlayer, type MarketInfo, type PropMarket } from '@/lib/oddsProps'
import {
  buildSeasonProjections,
  matchupMultiplier,
  type ProjectionSport,
  type SeasonProjection,
} from '@/lib/seasonProjections'
import { espnSportMap } from '@/lib/providers/espn'
import { DATE_RE, EVENT_ID_RE, isValidTeam } from '@/lib/api-validation'
import type { SportKey } from '@/lib/models'

/**
 * Player prop lines (QB passing yards O/U, RB rushing yards O/U, etc.) for a game.
 *
 * ESPN's public API does not expose player props, so this route uses The Odds API
 * (https://the-odds-api.com) when an `ODDS_API_KEY` env var is present. Without a
 * key it returns `{ available: false }` plus keyless `projections` for both teams:
 *  - NFL: per-game lines from the ESPN fantasy season projections.
 *  - NBA / NHL / MLB: per-game season averages from ESPN (see seasonProjections).
 * Both are scaled by the Vegas implied team total when the game odds are known.
 *
 * The Odds API assigns its own event ids (different from ESPN's), so we first fetch
 * the list of upcoming games (h2h market, 1 credit) and match by team names + date,
 * then fetch the props markets for the matched event (~1 credit per market).
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4/sports'

const SPORT_KEY: Record<string, string> = {
  NFL: 'americanfootball_nfl',
  NBA: 'basketball_nba',
  NHL: 'icehockey_nhl',
  MLB: 'baseball_mlb',
}

const m = (label: string, position: string | null, stat: string | null): MarketInfo => ({ label, position, stat })

/**
 * The Odds API player-prop markets per sport (~1 credit each on the free tier,
 * so each list is the handful of markets fans actually bet). Asking for NFL
 * market keys on an NBA/NHL/MLB event returns nothing, so every sport needs
 * its own list.
 */
const MARKETS: Record<string, Record<string, MarketInfo>> = {
  NFL: {
    player_pass_yds: m('Pass Yds', 'QB', 'passing_yards'),
    player_pass_tds: m('Pass TDs', 'QB', 'passing_tds'),
    player_rush_yds: m('Rush Yds', 'RB', 'rushing_yards'),
    player_rush_attempts: m('Rush Att', 'RB', null),
    player_reception_yds: m('Rec Yds', 'WR/TE', 'receiving_yards'),
    player_receptions: m('Receptions', 'WR/TE', 'receptions'),
    player_anytime_td: m('Anytime TD', null, null),
  },
  NBA: {
    player_points: m('PTS', null, 'points'),
    player_rebounds: m('REB', null, 'rebounds'),
    player_assists: m('AST', null, 'assists'),
    player_threes: m('3PM', null, 'threes'),
  },
  NHL: {
    player_points: m('PTS', null, 'points'),
    player_shots_on_goal: m('SOG', null, 'shots'),
    player_goals: m('Goals', null, 'goals'),
    player_total_saves: m('Saves', 'G', 'saves'),
  },
  MLB: {
    batter_hits: m('Hits', null, 'hits'),
    batter_total_bases: m('Total Bases', null, 'total_bases'),
    batter_rbis: m('RBIs', null, 'rbis'),
    batter_home_runs: m('HR', null, 'home_runs'),
    pitcher_strikeouts: m('Strikeouts', 'P', 'strikeouts'),
  },
}

const log = (msg: string) => console.log(`[props] ${msg}`)

function getApiKey(): string | null {
  const key = process.env.ODDS_API_KEY
  return key && key.trim() ? key.trim() : null
}

function teamNameByAbbr(sport: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of teams) {
    if (t.sport !== sport.toUpperCase()) continue
    // Index by both the local abbreviation (e.g. WAS) and the ESPN one (e.g. WSH),
    // since the dashboard passes the ESPN abbreviation through.
    m.set(t.abbreviation.toUpperCase(), t.name)
    m.set(getEspnAbbr(t.id, t.abbreviation), t.name)
  }
  return m
}

/** All accepted abbreviations (local + ESPN) for a team, keyed by full name. */
function teamAbbrVariants(sport: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const t of teams) {
    if (t.sport !== sport.toUpperCase()) continue
    const set = m.get(t.name) ?? new Set<string>()
    set.add(t.abbreviation.toUpperCase())
    set.add(getEspnAbbr(t.id, t.abbreviation))
    m.set(t.name, set)
  }
  return m
}

interface OddsBookmaker {
  key: string
  title: string
  markets?: PropMarket[]
}

interface OddsEvent {
  id: string
  commence_time: string
  home_team?: string
  away_team?: string
  bookmakers?: OddsBookmaker[]
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort player → team lookup from the cached Sleeper master list. Returns null
 * when the list is unavailable so props can still render ungrouped.
 */
async function playerTeamLookup(): Promise<Map<string, string> | null> {
  try {
    const master = await buildMasterPlayerList()
    const map = new Map<string, string>()
    for (const p of master.players) {
      if (!p.team) continue
      map.set(normalizeName(p.fullName), p.team.toUpperCase())
      map.set(normalizeName(`${p.firstName} ${p.lastName}`), p.team.toUpperCase())
    }
    return map
  } catch (e) {
    console.warn('[props] player team lookup unavailable:', e)
    return null
  }
}

// ESPN fantasy projection stat ids (season totals). Dividing by the 17-game regular
// season gives a rough per-game "projected line" — a keyless stand-in for betting
// props that works even without an Odds API key. In preseason, starters only play a
// fraction of snaps, so scale the per-game line down (QB starters rarely top 100 yds
// in a preseason game, for example).
const PROJ_GAMES = 17
const PRESEASON_FACTOR = 0.4

// Matchup adjustment via Vegas totals: a team's implied total from the book
// divided by the league-average team total gives a per-player line multiplier,
// clamped per sport (see matchupMultiplier) so a weird line can't produce
// absurd numbers.

/** Position rank for display ordering: QBs, then RBs, then WRs, then TEs. */
function posRank(pos: string | null | undefined): number {
  const p = (pos ?? '').toUpperCase()
  if (p.startsWith('QB')) return 0
  if (p.startsWith('RB')) return 1
  if (p.startsWith('WR')) return 2
  if (p.startsWith('TE')) return 3
  return 9
}
const STAT_PASS_YDS = '3'
const STAT_PASS_TD = '4'
const STAT_INT = '20'
const STAT_RUSH_ATT = '23'
const STAT_RUSH_YDS = '24'
const STAT_RUSH_TD = '25'
const STAT_REC_YDS = '42'
const STAT_REC_TD = '43'
const STAT_RECEPTIONS = '53'

interface ProjectedLine {
  name: string
  position: string
  team: string
  lines: { label: string; value: number }[]
}

function projectedLinesFor(player: UnifiedPlayer, teamAbbr: string, multiplier: number): ProjectedLine | null {
  const stats = player.projection?.stats ?? {}
  const pos = player.canonical.position
  const team = (player.proTeamAbbr ?? player.canonical.team ?? '').toUpperCase()
  if (team !== teamAbbr) return null

  const perGame = (season: number | undefined): number =>
    season && season > 0 ? Math.round((season / PROJ_GAMES) * multiplier * 10) / 10 : 0

  if (pos === 'QB') {
    const lines = [
      { label: 'Pass Yds', value: perGame(stats[STAT_PASS_YDS]) },
      { label: 'Pass TDs', value: perGame(stats[STAT_PASS_TD]) },
    ]
    if (stats[STAT_RUSH_YDS]) lines.push({ label: 'Rush Yds', value: perGame(stats[STAT_RUSH_YDS]) })
    return { name: player.canonical.fullName, position: pos, team: teamAbbr, lines: lines.filter((l) => l.value > 0) }
  }
  if (pos === 'RB') {
    const lines = [
      { label: 'Rush Yds', value: perGame(stats[STAT_RUSH_YDS]) },
      { label: 'Rush Att', value: perGame(stats[STAT_RUSH_ATT]) },
      { label: 'Rec Yds', value: perGame(stats[STAT_REC_YDS]) },
      { label: 'Receptions', value: perGame(stats[STAT_RECEPTIONS]) },
    ]
    return { name: player.canonical.fullName, position: pos, team: teamAbbr, lines: lines.filter((l) => l.value > 0) }
  }
  if (pos === 'WR' || pos === 'TE') {
    const lines = [
      { label: 'Rec Yds', value: perGame(stats[STAT_REC_YDS]) },
      { label: 'Receptions', value: perGame(stats[STAT_RECEPTIONS]) },
      { label: 'Rec TDs', value: perGame(stats[STAT_REC_TD]) },
    ]
    return { name: player.canonical.fullName, position: pos, team: teamAbbr, lines: lines.filter((l) => l.value > 0) }
  }
  return null
}

/**
 * Keyless fallback: derive per-game projected lines for the two teams' skill players
 * from the ESPN fantasy projections the unified DB already carries. Ranks by season
 * projection points so the biggest stars surface first.
 *
 * @deprecated This is a crude fallback (season_avg / 17 * Vegas multiplier) — the
 * canonical projection engine is the Python prop-model (POST /api/prop-model) which
 * uses recency-weighted history + opponent + game-script + distributions. This
 * fallback is retained for keyless/betting-props-unavailable cases and as a raw
 * ESPN prior source for the prop-model. See Phase 13: ESPN is now a data source
 * and sanity check, not a competing projection methodology.
 */
async function buildProjectedLines(
  teamAbbr: string,
  opponentAbbr: string,
  preseason: boolean,
  ourMult = 1,
  oppMult = 1,
): Promise<ProjectedLine[]> {
  try {
    const { players } = await buildUnifiedDatabase({})
    const want = new Set([teamAbbr.toUpperCase(), opponentAbbr.toUpperCase()])
    const baseMult = preseason ? PRESEASON_FACTOR : 1
    const out: ProjectedLine[] = []
    for (const p of players) {
      const team = (p.proTeamAbbr ?? p.canonical.team ?? '').toUpperCase()
      if (!want.has(team)) continue
      // Playing-time (preseason) and matchup (Vegas implied team total vs league avg)
      // adjustments stack multiplicatively.
      const teamMult = team === teamAbbr.toUpperCase() ? ourMult : oppMult
      const line = projectedLinesFor(p, team, baseMult * teamMult)
      if (line && line.lines.length > 0) out.push(line)
    }
    // Group by position (QB, RB, WR, TE), biggest stars first within each group.
    out.sort((a, b) => {
      const ra = posRank(a.position)
      const rb = posRank(b.position)
      if (ra !== rb) return ra - rb
      const ptsOf = (name: string) => {
        const p = players.find((x) => x.canonical.fullName === name)
        return p?.projection?.points ?? 0
      }
      return ptsOf(b.name) - ptsOf(a.name)
    })
    return out
  } catch (e) {
    console.warn('[props] projected lines unavailable:', e)
    return []
  }
}

/** MLB probable starters for the event (ESPN scoreboard), keyed by nothing — ids only. */
async function mlbProbablePitcherIds(eventId: string | null, date: string | null): Promise<string[]> {
  if (!eventId || !date) return []
  try {
    const board = await fetchOrCache(`props:mlb-board:${date}`, 30 * 60 * 1000, async () => {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${espnSportMap.MLB}/scoreboard?dates=${date}`,
        { signal: AbortSignal.timeout(10000) },
      )
      if (!res.ok) throw new Error(`scoreboard:${res.status}`)
      return res.json()
    })
    const event = (board?.events ?? []).find((e: any) => String(e?.id) === eventId)
    const ids: string[] = []
    for (const c of event?.competitions?.[0]?.competitors ?? []) {
      for (const p of c?.probables ?? []) {
        if (p?.athlete?.id) ids.push(String(p.athlete.id))
      }
    }
    return ids
  } catch (e) {
    console.warn('[props] MLB probables unavailable:', e)
    return []
  }
}

async function cachedRoster(sport: SportKey, abbr: string): Promise<any[]> {
  const data = await fetchOrCache(`props:roster:${sport}:${abbr}`, 6 * 60 * 60 * 1000, () => fetchTeamRoster(sport, abbr))
  return Array.isArray(data?.athletes) ? data.athletes : []
}

/** Keyless NBA/NHL/MLB lines for both teams + a name→team map for book lines. */
async function buildNonNflProjections(
  sport: ProjectionSport,
  team: string,
  opponent: string,
  ourMult: number,
  oppMult: number,
  eventId: string | null,
  date: string | null,
): Promise<{ projections: SeasonProjection[]; teamByName: Map<string, string> }> {
  const teamByName = new Map<string, string>()
  try {
    const [ours, theirs, probables] = await Promise.all([
      cachedRoster(sport, team),
      cachedRoster(sport, opponent),
      sport === 'MLB' ? mlbProbablePitcherIds(eventId, date) : Promise.resolve([]),
    ])
    for (const [athletes, abbr] of [[ours, team], [theirs, opponent]] as const) {
      for (const a of athletes) {
        const name = a?.displayName ?? a?.fullName
        if (name) teamByName.set(normalizeName(name), abbr)
      }
    }
    const projections = [
      ...buildSeasonProjections(sport, ours, team, ourMult, { probablePitcherIds: probables }),
      ...buildSeasonProjections(sport, theirs, opponent, oppMult, { probablePitcherIds: probables }),
    ]
    return { projections, teamByName }
  } catch (e) {
    console.warn('[props] season projections unavailable:', e)
    return { projections: [], teamByName }
  }
}

function pickBestBookmaker(bookmakers: OddsBookmaker[]): OddsBookmaker | null {
  const preferred = ['draftkings', 'fanduel', 'betmgm', 'caesars']
  for (const key of preferred) {
    const found = bookmakers.find((b) => b.key === key)
    if (found?.markets?.length) return found
  }
  return bookmakers.find((b) => b.markets?.length) ?? null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = (searchParams.get('sport') ?? '').toUpperCase()
  const team = (searchParams.get('team') ?? '').toUpperCase()
  const opponent = (searchParams.get('opponent') ?? '').toUpperCase()
  const date = searchParams.get('date') // YYYYMMDD
  const eventId = searchParams.get('eventId')
  const preseason = searchParams.get('preseason') === '1'

  // Matchup context from the Vegas lines the dashboard already fetched. `spread` is
  // from `team`'s perspective (negative = team is the favorite), so the implied team
  // totals are (total−spread)/2 for us and (total+spread)/2 for the opponent.
  const total = parseFloat(searchParams.get('total') ?? '')
  const spread = parseFloat(searchParams.get('spread') ?? '')
  const hasMatchupOdds = !isNaN(total) && total > 0 && !isNaN(spread)
  const ourImplied = hasMatchupOdds ? (total - spread) / 2 : NaN
  const oppImplied = hasMatchupOdds ? (total + spread) / 2 : NaN
  const multSport = (SPORT_KEY[sport] ? sport : 'NFL') as 'NFL' | ProjectionSport
  const ourMult = hasMatchupOdds ? matchupMultiplier(multSport, ourImplied) : 1
  const oppMult = hasMatchupOdds ? matchupMultiplier(multSport, oppImplied) : 1
  const matchup = hasMatchupOdds
    ? {
        total,
        spread,
        ourTotal: Math.round(ourImplied * 10) / 10,
        oppTotal: Math.round(oppImplied * 10) / 10,
        ourMultiplier: Math.round(ourMult * 100) / 100,
        oppMultiplier: Math.round(oppMult * 100) / 100,
      }
    : null

  if (!SPORT_KEY[sport] || !team || !opponent) {
    return NextResponse.json({ error: 'Missing sport, team or opponent' }, { status: 400 })
  }
  if (!isValidTeam(team) || !isValidTeam(opponent)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'team/opponent must be 2-4 character abbreviations' }, { status: 400 })
  }
  if ((date && !DATE_RE.test(date)) || (eventId && !EVENT_ID_RE.test(eventId))) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'date must be YYYYMMDD and eventId numeric' }, { status: 400 })
  }

  // Keyless projections for both teams, every sport. Computed lazily once and
  // reused by every response branch below.
  let keyless: Promise<{ projections: (ProjectedLine | SeasonProjection)[]; teamByName: Map<string, string> | null }> | null = null
  const getKeyless = () => {
    keyless ??= sport === 'NFL'
      ? buildProjectedLines(team, opponent, preseason, ourMult, oppMult).then((projections) => ({ projections, teamByName: null }))
      : buildNonNflProjections(sport as ProjectionSport, team, opponent, ourMult, oppMult, eventId, date)
    return keyless
  }
  const projectionSource = sport === 'NFL' ? 'espn-fantasy' : 'espn-season-avg'

  const apiKey = getApiKey()
  if (!apiKey) {
    // No betting props available — fall back to keyless projected lines.
    log(`No ODDS_API_KEY configured — falling back to projected lines`)
    const { projections } = await getKeyless()
    return NextResponse.json({ available: false, reason: 'no-api-key', props: null, projections, projectionSource, preseason, matchup })
  }

  const names = teamNameByAbbr(sport)
  const teamName = names.get(team)
  const oppName = names.get(opponent)
  if (!teamName || !oppName) {
    log(`Unknown team abbreviation: ${team}/${opponent}`)
    return NextResponse.json({ available: false, reason: 'unknown-teams', props: null })
  }

  const sportKey = SPORT_KEY[sport]

  try {
    // Step 1: find the Odds API event id for this game. The h2h list is cheap (1
    // credit) and cached for an hour; match on team names + commence date.
    const eventsKey = `props:events:${sportKey}:${date ?? 'any'}`
    const listUrl = `${ODDS_API_BASE}/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&commenceTimeFrom=${encodeURIComponent(date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z` : '2000-01-01T00:00:00Z')}&commenceTimeTo=${encodeURIComponent(date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T23:59:59Z` : '2100-01-01T00:00:00Z')}`

    const events = await fetchOrCache(eventsKey, 60 * 60 * 1000, async () => {
      const res = await fetch(listUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        log(`Odds API list failed: ${res.status} ${body.slice(0, 200)}`)
        throw new Error(`odds-api-list:${res.status}`)
      }
      const json = (await res.json()) as OddsEvent[]
      return json
    })

    const evt = events.find(
      (e) =>
        (e.home_team === teamName && e.away_team === oppName) ||
        (e.home_team === oppName && e.away_team === teamName),
    )

    if (!evt) {
      log(`No Odds API event found for ${teamName} vs ${oppName} (${date})`)
      const { projections } = await getKeyless()
      return NextResponse.json({ available: false, reason: 'no-event', props: null, projections, projectionSource, preseason, matchup })
    }

    // Step 2: fetch the props markets for that event (~1 credit per market).
    const propsKey = `props:${sportKey}:${evt.id}`
    const props = await fetchOrCache(propsKey, 10 * 60 * 1000, async () => {
      const url = `${ODDS_API_BASE}/${sportKey}/events/${evt.id}/odds/?apiKey=${apiKey}&regions=us&markets=${Object.keys(MARKETS[sport]).join(',')}&oddsFormat=american`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        log(`Odds API props failed: ${res.status} ${body.slice(0, 200)}`)
        throw new Error(`odds-api-props:${res.status}`)
      }
      const json = (await res.json()) as OddsEvent[]
      return json
    })

    const eventData = props.find((e) => e.id === evt.id)
    const bookmaker = eventData ? pickBestBookmaker(eventData.bookmakers ?? []) : null

    if (!bookmaker?.markets?.length) {
      log(`No props markets returned for ${evt.id} (${bookmaker?.title ?? 'no bookmaker'})`)
      const { projections } = await getKeyless()
      return NextResponse.json({ available: false, reason: 'no-props', props: null, projections, projectionSource, preseason, matchup })
    }

    const players = groupByPlayer(bookmaker.markets, MARKETS[sport])
    // Order the display: QBs, then RBs, then WRs/TEs, then unknown — matches how the
    // panel groups projected lines by position.
    players.sort((a, b) => {
      const ra = posRank(a.position)
      const rb = posRank(b.position)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    })

    // The Odds API doesn't tag players with a team. NFL resolves it from the cached
    // Sleeper master list (accepting every abbreviation variant, e.g. WAS vs WSH);
    // other sports use the two ESPN rosters the keyless projections already loaded.
    // Best-effort: unmatched players render ungrouped.
    const { projections, teamByName } = await getKeyless()
    const teamLookup = sport === 'NFL' ? await playerTeamLookup() : null
    const variants = teamAbbrVariants(sport)
    const ourAbbrs = variants.get(teamName) ?? new Set<string>()
    const oppAbbrs = variants.get(oppName) ?? new Set<string>()
    const teamOf = (name: string): string | null => {
      if (teamByName) return teamByName.get(normalizeName(name)) ?? null
      const playerTeam = teamLookup?.get(normalizeName(name))
      if (!playerTeam) return null
      if (ourAbbrs.has(playerTeam)) return team
      if (oppAbbrs.has(playerTeam)) return opponent
      return null
    }

    const homeTeam = evt.home_team
    const awayTeam = evt.away_team

    return NextResponse.json(
      {
        available: true,
        source: 'the-odds-api',
        bookmaker: bookmaker.title,
        commenceTime: evt.commence_time,
        homeTeam,
        awayTeam,
        players: players.map((p) => ({ ...p, team: teamOf(p.name) })),
        // Keyless projected lines ride along so the panel can always show
        // something, even when a given market isn't posted.
        projections,
        projectionSource,
        preseason,
        matchup,
        updatedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ available: false, reason: 'error', props: null })
  }
}
