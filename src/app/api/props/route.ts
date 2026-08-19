import { NextResponse } from 'next/server'
import { teams } from '@/data/teams'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { getEspnAbbr } from '@/lib/providers/espn'
import { buildMasterPlayerList } from '@/lib/fantasy/sleeper-master'
import { buildUnifiedDatabase } from '@/lib/fantasy/unified-db'
import type { UnifiedPlayer } from '@/lib/fantasy/player-types'

/**
 * Player prop lines (QB passing yards O/U, RB rushing yards O/U, etc.) for a game.
 *
 * ESPN's public API does not expose player props, so this route uses The Odds API
 * (https://the-odds-api.com) when an `ODDS_API_KEY` env var is present. Without a
 * key it returns `{ available: false }` quickly so the UI can fall back to showing
 * fantasy updates only.
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

/** Market key → display label + implied position (for grouping by position). */
const MARKET_INFO: Record<string, { label: string; position: string | null }> = {
  player_pass_yds: { label: 'Pass Yds', position: 'QB' },
  player_pass_tds: { label: 'Pass TDs', position: 'QB' },
  player_pass_attempts: { label: 'Pass Attempts', position: 'QB' },
  player_pass_completions: { label: 'Completions', position: 'QB' },
  player_pass_interceptions: { label: 'INTs', position: 'QB' },
  player_rush_yds: { label: 'Rush Yds', position: 'RB' },
  player_rush_attempts: { label: 'Rush Att', position: 'RB' },
  player_rush_tds: { label: 'Rush TDs', position: 'RB' },
  player_reception_yds: { label: 'Rec Yds', position: 'WR/TE' },
  player_receptions: { label: 'Receptions', position: 'WR/TE' },
  player_reception_tds: { label: 'Rec TDs', position: 'WR/TE' },
  player_anytime_td: { label: 'Anytime TD', position: null },
}

// Markets to request. Costs ~1 credit each on the free tier, so keep the list
// focused on the positions fans actually care about (QB/RB/WR/TE).
const REQUESTED_MARKETS = [
  'player_pass_yds',
  'player_pass_tds',
  'player_rush_yds',
  'player_rush_attempts',
  'player_reception_yds',
  'player_receptions',
  'player_anytime_td',
].join(',')

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

function parseLine(val: unknown): number | null {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val)
    if (!isNaN(n)) return n
  }
  return null
}

interface PropOutcome {
  name: string
  description?: string
  point?: number | string
  price?: number
}

interface PropMarket {
  key: string
  outcomes?: PropOutcome[]
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

interface NormalizedProp {
  market: string
  label: string
  position: string | null
  line: number
  over: number | null
  under: number | null
}

interface NormalizedPlayer {
  name: string
  position: string | null
  team?: string | null
  props: NormalizedProp[]
}

/**
 * Each props market carries two outcomes for the same player+point (the Over and the
 * Under side). Prefer explicit Over/Under in the description; otherwise take the two
 * prices in order.
 */
function normalizeMarket(market: PropMarket): NormalizedProp[] {
  const info = MARKET_INFO[market.key]
  if (!info || !market.outcomes?.length) return []

  const byKey = new Map<string, { point: number; prices: number[]; descs: string[] }>()
  for (const o of market.outcomes) {
    const point = parseLine(o.point)
    if (point == null) continue
    const k = `${o.name}::${point}`
    const entry = byKey.get(k) ?? { point, prices: [], descs: [] }
    if (o.price != null) entry.prices.push(o.price)
    if (o.description) entry.descs.push(o.description)
    byKey.set(k, entry)
  }

  const out: NormalizedProp[] = []
  for (const [, entry] of byKey) {
    const lower = entry.descs.join(' ').toLowerCase()
    let over: number | null = null
    let under: number | null = null
    if (lower.includes('over') || lower.includes('under')) {
      for (let i = 0; i < entry.descs.length; i++) {
        if (entry.descs[i].toLowerCase().includes('over')) over = entry.prices[i] ?? null
        if (entry.descs[i].toLowerCase().includes('under')) under = entry.prices[i] ?? null
      }
    } else {
      over = entry.prices[0] ?? null
      under = entry.prices[1] ?? null
    }
    out.push({ market: market.key, label: info.label, position: info.position, line: entry.point, over, under })
  }
  return out
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

function groupByPlayer(markets: PropMarket[]): NormalizedPlayer[] {
  const result = new Map<string, NormalizedPlayer>()
  for (const m of markets) {
    const info = MARKET_INFO[m.key]
    const props = normalizeMarket(m)
    if (props.length === 0) continue
    const nameOf = (prop: NormalizedProp): string | null => {
      // The Odds API returns two outcomes per player+point (Over/Under), each with
      // the same player name — so match by name and line.
      for (const o of m.outcomes ?? []) {
        if (o.name && parseLine(o.point) === prop.line) return o.name
      }
      return null
    }
    for (const prop of props) {
      const name = nameOf(prop)
      if (!name) continue
      const existing = result.get(name) ?? { name, position: prop.position, props: [] }
      if (!existing.position) existing.position = prop.position ?? info?.position ?? null
      existing.props.push(prop)
      result.set(name, existing)
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ESPN fantasy projection stat ids (season totals). Dividing by the 17-game regular
// season gives a rough per-game "projected line" — a keyless stand-in for betting
// props that works even without an Odds API key. In preseason, starters only play a
// fraction of snaps, so scale the per-game line down (QB starters rarely top 100 yds
// in a preseason game, for example).
const PROJ_GAMES = 17
const PRESEASON_FACTOR = 0.4

// Matchup adjustment via Vegas totals. League-average NFL team scoring (~22 pts per
// team per game) is the baseline a "typical" game total implies. A team's implied
// total from the book (favorite ≈ (total+spread)/2) divided by that baseline gives a
// per-player line multiplier, so facing a bad defense (high implied total) boosts
// every line and a good defense (low total) cuts them. Clamped so a weird line can't
// produce absurd numbers.
const LEAGUE_AVG_TEAM_TOTAL = 22
const MATCHUP_MULT_MIN = 0.6
const MATCHUP_MULT_MAX = 1.4

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

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
  const preseason = searchParams.get('preseason') === '1'

  // Matchup context from the Vegas lines the dashboard already fetched. `spread` is
  // from `team`'s perspective (negative = team is the favorite), so the implied team
  // totals are (total−spread)/2 for us and (total+spread)/2 for the opponent.
  const total = parseFloat(searchParams.get('total') ?? '')
  const spread = parseFloat(searchParams.get('spread') ?? '')
  const hasMatchupOdds = !isNaN(total) && total > 0 && !isNaN(spread)
  const ourImplied = hasMatchupOdds ? (total - spread) / 2 : NaN
  const oppImplied = hasMatchupOdds ? (total + spread) / 2 : NaN
  const ourMult = hasMatchupOdds ? clamp(ourImplied / LEAGUE_AVG_TEAM_TOTAL, MATCHUP_MULT_MIN, MATCHUP_MULT_MAX) : 1
  const oppMult = hasMatchupOdds ? clamp(oppImplied / LEAGUE_AVG_TEAM_TOTAL, MATCHUP_MULT_MIN, MATCHUP_MULT_MAX) : 1
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

  const apiKey = getApiKey()
  if (!apiKey) {
    // No betting props available — fall back to keyless projected lines from the
    // ESPN fantasy projections the pipeline already carries.
    log(`No ODDS_API_KEY configured — falling back to projected lines`)
    const projected = sport === 'NFL' ? await buildProjectedLines(team, opponent, preseason, ourMult, oppMult) : []
    return NextResponse.json({ available: false, reason: 'no-api-key', props: null, projections: projected, preseason, matchup })
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
      const projected = sport === 'NFL' ? await buildProjectedLines(team, opponent, preseason, ourMult, oppMult) : []
      return NextResponse.json({ available: false, reason: 'no-event', props: null, projections: projected, preseason, matchup })
    }

    // Step 2: fetch the props markets for that event (~1 credit per market).
    const propsKey = `props:${sportKey}:${evt.id}`
    const props = await fetchOrCache(propsKey, 10 * 60 * 1000, async () => {
      const url = `${ODDS_API_BASE}/${sportKey}/events/${evt.id}/odds/?apiKey=${apiKey}&regions=us&markets=${REQUESTED_MARKETS}&oddsFormat=american`
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
      const projected = sport === 'NFL' ? await buildProjectedLines(team, opponent, preseason, ourMult, oppMult) : []
      return NextResponse.json({ available: false, reason: 'no-props', props: null, projections: projected, preseason, matchup })
    }

    const players = groupByPlayer(bookmaker.markets)
    // Order the display: QBs, then RBs, then WRs/TEs, then unknown — matches how the
    // panel groups projected lines by position.
    players.sort((a, b) => {
      const ra = posRank(a.position)
      const rb = posRank(b.position)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    })

    // The Odds API doesn't tag players with a team, so resolve each player's team from
    // the cached Sleeper master list. Best-effort: unmatched players render ungrouped.
    // Sleeper's abbreviation for a team can differ from the one the dashboard passes
    // (e.g. WAS vs WSH), so accept every variant of the two teams' abbreviations and
    // return the dashboard's abbreviation (team / opponent) for client-side grouping.
    const teamLookup = await playerTeamLookup()
    const variants = teamAbbrVariants(sport)
    const ourAbbrs = variants.get(teamName) ?? new Set<string>()
    const oppAbbrs = variants.get(oppName) ?? new Set<string>()
    const teamOf = (name: string): string | null => {
      const playerTeam = teamLookup?.get(normalizeName(name))
      if (!playerTeam) return null
      if (ourAbbrs.has(playerTeam)) return team
      if (oppAbbrs.has(playerTeam)) return opponent
      return null
    }

    const homeTeam = evt.home_team
    const awayTeam = evt.away_team

    // Include keyless projected lines alongside the betting props so the panel can
    // always show something, even when a given market isn't posted.
    const projected = sport === 'NFL' ? await buildProjectedLines(team, opponent, preseason, ourMult, oppMult) : []

    return NextResponse.json(
      {
        available: true,
        source: 'the-odds-api',
        bookmaker: bookmaker.title,
        commenceTime: evt.commence_time,
        homeTeam,
        awayTeam,
        players: players.map((p) => ({ ...p, team: teamOf(p.name) })),
        projections: projected,
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
