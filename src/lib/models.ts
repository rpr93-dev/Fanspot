/**
 * Normalized internal models for Fanspot.
 *
 * Provider-specific translation happens HERE (and in the service layer).
 * React components must consume these normalized shapes, never raw ESPN
 * response objects.
 */

import { teams } from '@/data/teams'
import { espnSportMap, getEspnAbbr } from '@/lib/providers/espn'

/* ------------------------------------------------------------------ */
/* Sport                                                               */
/* ------------------------------------------------------------------ */

export type SportKey = 'NFL' | 'NBA' | 'NHL' | 'MLB'

export const SPORT_KEYS: SportKey[] = ['NFL', 'NBA', 'NHL', 'MLB']

export const SPORT_SLUGS: Record<SportKey, string> = {
  NFL: 'nfl',
  NBA: 'nba',
  NHL: 'nhl',
  MLB: 'mlb',
}

export function normalizeSportKey(input: unknown): SportKey | null {
  if (typeof input !== 'string') return null
  const up = input.toUpperCase()
  return (SPORT_KEYS as string[]).includes(up) ? (up as SportKey) : null
}

export function espnPathFor(sport: SportKey): string {
  return espnSportMap[sport]
}

/* ------------------------------------------------------------------ */
/* Game status                                                         */
/* ------------------------------------------------------------------ */

export type GamePhase = 'pre' | 'live' | 'final' | 'postponed' | 'delayed'

export interface NormalizedStatus {
  phase: GamePhase
  completed: boolean
  /** Long detail, e.g. "Final", "7:25 PM ET", "Q3 4:12". */
  detail: string
  /** Short detail for chips, e.g. "Final", "Q3 4:12", "7:25 PM". */
  shortDetail: string
  /** Clock string when live, e.g. "4:12". */
  clock: string | null
  /** Period number when live (quarter / period / inning). */
  period: number | null
  /** Sport-appropriate period label, e.g. "Q3", "P2", "Top 7th". */
  periodLabel: string | null
}

interface RawStatusType {
  id?: string
  name?: string
  state?: string
  completed?: boolean
  description?: string
  detail?: string
  shortDetail?: string
}

function postponementPhase(t: RawStatusType): GamePhase | null {
  const hay = `${t.id ?? ''} ${t.name ?? ''} ${t.description ?? ''} ${t.detail ?? ''}`.toLowerCase()
  if (/postpon|cancel/.test(hay)) return 'postponed'
  if (/delay|suspend|weather/.test(hay)) return 'delayed'
  return null
}

/** Seconds (or "12:34"-style string) -> "M:SS" clock. */
export function formatClock(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (/^\d+:\d{2}/.test(t)) return t.slice(0, 5)
    const n = Number(t)
    if (Number.isFinite(n)) return formatClock(n)
    return null
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    const m = Math.floor(raw / 60)
    const s = Math.floor(raw % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return null
}

const PERIOD_PREFIX: Record<SportKey, string> = {
  NFL: 'Q',
  NBA: 'Q',
  NHL: 'P',
  MLB: '',
}

export function periodLabelFor(sport: SportKey, period: number | null, extra?: { inningHalf?: string | null }): string | null {
  if (period == null) return null
  if (sport === 'MLB') {
    const half = (extra?.inningHalf ?? '').toLowerCase().startsWith('b') ? 'Bot' : 'Top'
    return `${half} ${period}`
  }
  return `${PERIOD_PREFIX[sport]}${period}`
}

/**
 * Translate an ESPN status type (+ optional displayClock/period) into a
 * normalized status. Never throws on odd shapes.
 */
export function normalizeStatus(
  raw: RawStatusType | null | undefined,
  sport?: SportKey,
  extra?: { displayClock?: unknown; period?: unknown; inningHalf?: unknown },
): NormalizedStatus {
  const t: RawStatusType = raw && typeof raw === 'object' ? raw : {}
  const completed = t.completed === true || t.state === 'post'
  const postponed = postponementPhase(t)

  let phase: GamePhase = 'pre'
  if (completed) phase = 'final'
  else if (postponed) phase = postponed
  else if (t.state === 'in') phase = 'live'

  const period =
    typeof extra?.period === 'number' && Number.isFinite(extra.period) && extra.period >= 1
      ? extra.period
      : null
  const clock = phase === 'live' ? formatClock(extra?.displayClock) : null
  const periodLabel =
    phase === 'live' && sport && period != null
      ? periodLabelFor(sport, period, {
          inningHalf: typeof extra?.inningHalf === 'string' ? extra.inningHalf : null,
        })
      : null

  const detail = t.detail ?? t.description ?? ''
  const shortDetail = t.shortDetail ?? t.description ?? ''

  return { phase, completed, detail, shortDetail, clock, period, periodLabel }
}

/* ------------------------------------------------------------------ */
/* Game                                                                */
/* ------------------------------------------------------------------ */

export interface TeamSide {
  id: string
  abbr: string
  name: string
  logo: string
  homeAway: 'home' | 'away'
  /** Numeric score, null when the game hasn't started / no score yet. */
  score: number | null
  scoreDisplay: string
  winner: boolean | null
  /** e.g. "10-2" / "10-2-0" when the feed carries records. */
  recordSummary: string | null
}

/** ESPN score shape varies: plain string ("0") vs { displayValue }. */
export function scoreToNumber(score: unknown): number | null {
  if (score == null || score === '') return null
  if (typeof score === 'object') {
    const dv = (score as { displayValue?: unknown }).displayValue
    return scoreToNumber(dv)
  }
  const n = parseInt(String(score), 10)
  return Number.isFinite(n) ? n : null
}

export function scoreToDisplay(score: unknown): string {
  if (score == null || score === '') return ''
  if (typeof score === 'object') {
    const dv = (score as { displayValue?: unknown }).displayValue
    return dv == null ? '' : String(dv)
  }
  return String(score)
}

function recordSummaryOf(competitor: any): string | null {
  const recs = competitor?.records
  if (!Array.isArray(recs)) return null
  const overall = recs.find((r: any) => r?.name === 'overall' || r?.type === 'overall' || r?.type === 'total')
  const summary = overall?.summary ?? overall?.displayValue
  return typeof summary === 'string' && summary ? summary : null
}

export interface GameOdds {
  spread: number | null
  total: number | null
  homeMoneyline: number | null
  awayMoneyline: number | null
  provider: string | null
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normalizeOdds(raw: any): GameOdds | null {
  const item = Array.isArray(raw) ? raw[0] : raw
  if (!item || typeof item !== 'object') return null
  const ml = item.moneyline
  return {
    spread: numOrNull(item.spread),
    total: numOrNull(item.overUnder ?? item.total),
    homeMoneyline: numOrNull(ml?.home?.close?.odds ?? item.homeTeamOdds?.moneyLine),
    awayMoneyline: numOrNull(ml?.away?.close?.odds ?? item.awayTeamOdds?.moneyLine),
    provider: typeof item.provider?.name === 'string' ? item.provider.name : null,
  }
}

export interface NormalizedGame {
  id: string
  sport: SportKey
  date: string
  name: string
  shortName: string
  weekText: string | null
  seasonType: number | null
  venueName: string | null
  venueCity: string | null
  broadcast: string | null
  status: NormalizedStatus
  away: TeamSide
  home: TeamSide
  odds: GameOdds | null
}

function normalizeSide(c: any, fallback: 'home' | 'away'): TeamSide {
  const team = c?.team ?? {}
  const abbr = String(team.abbreviation ?? team.abbr ?? '').toUpperCase()
  return {
    id: String(team.id ?? abbr),
    abbr,
    name: String(team.displayName ?? team.name ?? abbr),
    logo: String(team.logo ?? team.logos?.[0]?.href ?? ''),
    homeAway: c?.homeAway === 'away' || c?.homeAway === 'home' ? c.homeAway : fallback,
    score: scoreToNumber(c?.score),
    scoreDisplay: scoreToDisplay(c?.score),
    winner: typeof c?.winner === 'boolean' ? c.winner : null,
    recordSummary: recordSummaryOf(c),
  }
}

function broadcastOf(comp: any): string | null {
  const b = comp?.broadcasts
  if (Array.isArray(b) && b.length > 0) {
    const names = b
      .map((x: any) => x?.names?.join('/') ?? x?.name)
      .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
    if (names.length > 0) return names[0]
  }
  if (typeof comp?.broadcast === 'string') return comp.broadcast
  return null
}

/**
 * Translate one ESPN scoreboard/schedule event into a NormalizedGame.
 * Returns null when the event has no usable competition.
 */
export function normalizeEvent(sport: SportKey, event: any): NormalizedGame | null {
  if (!event || typeof event !== 'object') return null
  const comp = event.competitions?.[0]
  if (!comp || typeof comp !== 'object') return null
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : []
  if (competitors.length < 2) return null

  const awayRaw = competitors.find((c: any) => c?.homeAway === 'away') ?? competitors[0]
  const homeRaw = competitors.find((c: any) => c?.homeAway === 'home') ?? competitors[1]

  const statusType = comp.status?.type ?? {}
  const status = normalizeStatus(statusType, sport, {
    displayClock: comp.status?.displayClock,
    period: comp.status?.period,
  })

  const venue = comp.venue ?? {}
  const week = event.week
  const seasonType =
    typeof event.seasonType?.type === 'number'
      ? event.seasonType.type
      : typeof event.season?.type === 'number'
        ? event.season.type
        : null

  return {
    id: String(event.id ?? ''),
    sport,
    date: String(event.date ?? ''),
    name: String(event.name ?? ''),
    shortName: String(event.shortName ?? event.name ?? ''),
    weekText:
      typeof week?.text === 'string'
        ? week.text
        : typeof week?.number === 'number'
          ? `Week ${week.number}`
          : null,
    seasonType,
    venueName: typeof venue.fullName === 'string' ? venue.fullName : null,
    venueCity:
      typeof venue.address?.city === 'string'
        ? venue.address.state
          ? `${venue.address.city}, ${venue.address.state}`
          : venue.address.city
        : null,
    broadcast: broadcastOf(comp),
    status,
    away: normalizeSide(awayRaw, 'away'),
    home: normalizeSide(homeRaw, 'home'),
    odds: normalizeOdds(comp.odds),
  }
}

/* ------------------------------------------------------------------ */
/* Grouping / ordering                                                 */
/* ------------------------------------------------------------------ */

export interface GroupedGames {
  live: NormalizedGame[]
  upcoming: NormalizedGame[]
  final: NormalizedGame[]
  postponed: NormalizedGame[]
}

const byDateAsc = (a: NormalizedGame, b: NormalizedGame) =>
  new Date(a.date).getTime() - new Date(b.date).getTime()

/** Split games by phase and sort each bucket for display. */
export function groupGames(games: NormalizedGame[]): GroupedGames {
  const live: NormalizedGame[] = []
  const upcoming: NormalizedGame[] = []
  const final: NormalizedGame[] = []
  const postponed: NormalizedGame[] = []
  for (const g of games) {
    switch (g.status.phase) {
      case 'live': live.push(g); break
      case 'final': final.push(g); break
      case 'postponed':
      case 'delayed': postponed.push(g); break
      default: upcoming.push(g); break
    }
  }
  live.sort(byDateAsc)
  upcoming.sort(byDateAsc)
  // Most recently finished first.
  final.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  postponed.sort(byDateAsc)
  return { live, upcoming, final, postponed }
}

function closenessScore(g: NormalizedGame): number {
  if (g.away.score == null || g.home.score == null) return 0
  const diff = Math.abs(g.away.score - g.home.score)
  return Math.max(0, 12 - diff)
}

function phaseRank(g: NormalizedGame): number {
  switch (g.status.phase) {
    case 'live': return 0
    case 'final': return 2
    case 'postponed':
    case 'delayed': return 3
    default: return 1
  }
}

/**
 * Order games for a command-center view: live first, then upcoming, then
 * finals. Favorites get a boost within their bucket; close games break ties.
 * Favorites prioritize, never filter.
 */
export function relevanceSort(games: NormalizedGame[], favoriteAbbrs?: Set<string>): NormalizedGame[] {
  const favs = favoriteAbbrs ?? new Set<string>()
  const favBoost = (g: NormalizedGame) =>
    favs.has(g.away.abbr.toUpperCase()) || favs.has(g.home.abbr.toUpperCase()) ? 1 : 0
  return [...games].sort((a, b) => {
    const pa = phaseRank(a)
    const pb = phaseRank(b)
    if (pa !== pb) return pa - pb
    const fa = favBoost(a)
    const fb = favBoost(b)
    if (fa !== fb) return fb - fa
    const ca = closenessScore(a)
    const cb = closenessScore(b)
    if (ca !== cb) return cb - ca
    if (pa === 2) return new Date(b.date).getTime() - new Date(a.date).getTime()
    return new Date(a.date).getTime() - new Date(b.date).getTime()
  })
}

/* ------------------------------------------------------------------ */
/* Date helpers (scoreboard-style YYYYMMDD keys, local time)           */
/* ------------------------------------------------------------------ */

export function toDateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${mm}${dd}`
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

export function shiftDateKey(key: string, days: number): string {
  const y = parseInt(key.slice(0, 4), 10)
  const m = parseInt(key.slice(4, 6), 10) - 1
  const d = parseInt(key.slice(6, 8), 10)
  const dt = new Date(y, m, d)
  dt.setDate(dt.getDate() + days)
  return toDateKey(dt)
}

/** "Today" / "Yesterday" / "Tomorrow" / "Mon, Sep 14". */
export function dayLabel(key: string, now: Date = new Date()): string {
  const today = toDateKey(now)
  if (key === today) return 'Today'
  if (key === shiftDateKey(today, -1)) return 'Yesterday'
  if (key === shiftDateKey(today, 1)) return 'Tomorrow'
  const dt = new Date(
    parseInt(key.slice(0, 4), 10),
    parseInt(key.slice(4, 6), 10) - 1,
    parseInt(key.slice(6, 8), 10),
  )
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "7:25 PM" local tipoff/kickoff time for an ISO date. */
export function formatTipoff(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

export interface PlayerRef {
  id: string
  name: string
  teamAbbr: string | null
  position: string | null
  jersey: string | null
  headshot: string | null
}

export function playerPageHref(sport: SportKey, playerId: string): string {
  return `/${SPORT_SLUGS[sport]}/player/${encodeURIComponent(playerId)}`
}

/** Static Fanspot team by ESPN abbreviation (box scores, leaders, search). */
export function findFanspotTeam(sport: SportKey, espnAbbr: string): (typeof teams)[number] | null {
  const up = espnAbbr.toUpperCase()
  return (
    teams.find((t) => t.sport === sport && getEspnAbbr(t.id, t.abbreviation).toUpperCase() === up) ??
    null
  )
}

/* ------------------------------------------------------------------ */
/* Story                                                               */
/* ------------------------------------------------------------------ */

export interface StoryItem {
  title: string
  url: string
  source: string
  league: string
  publishedAt: string | null
  snippet: string
  significance: number
  /** Fanspot team ids mentioned in the headline/summary. */
  teamIds: string[]
}

const teamNicknameBySport = new Map<string, string>()

function nicknameIndex(): Map<string, string> {
  if (teamNicknameBySport.size === 0) {
    for (const t of teams) {
      teamNicknameBySport.set(`${t.sport}:${t.name.split(' ').slice(-1)[0].toLowerCase()}`, t.id)
    }
  }
  return teamNicknameBySport
}

/** Attach Fanspot team ids by matching nicknames in the story text. */
export function attachStoryTeams<T extends { title: string; snippet: string; league: string }>(
  story: T,
): T & { teamIds: string[] } {
  const idx = nicknameIndex()
  const text = `${story.title} ${story.snippet}`.toLowerCase()
  const league = story.league.toUpperCase()
  const ids: string[] = []
  for (const t of teams) {
    if (t.sport !== league) continue
    const nick = t.name.split(' ').slice(-1)[0].toLowerCase()
    if (nick.length > 2 && text.includes(nick)) ids.push(t.id)
  }
  void idx
  return { ...story, teamIds: ids }
}

/**
 * Balanced feed score: significance blended with recency so a major story
 * from days ago doesn't outrank big current stories forever. Pure function
 * of (significance, age) — deterministic and testable.
 */
export function feedScore(significance: number, publishedAt: string | null, nowMs: number = Date.now()): number {
  if (!publishedAt) return significance * 0.5
  const ageHours = (nowMs - new Date(publishedAt).getTime()) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours < 0) return significance
  // Half-life ~36h: fresh major stories surface, old ones decay gracefully.
  const decay = Math.pow(0.5, ageHours / 36)
  return significance * (0.35 + 0.65 * decay)
}

/* ------------------------------------------------------------------ */
/* Standings / leaders                                                 */
/* ------------------------------------------------------------------ */

export interface StandingRow {
  abbr: string
  name: string
  logo: string
  teamId: string
  conference: string
  division: string
  wins: number | null
  losses: number | null
  ties: number | null
  pct: number | null
  /** Raw extra stats from the provider (GB, streak, L10, ...). */
  extra: Record<string, string>
}

export function parseRecord(record: string): { wins: number; losses: number; ties: number } | null {
  const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(record.trim())
  if (!m) return null
  return { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10), ties: m[3] != null ? parseInt(m[3], 10) : 0 }
}

export interface StatLeader {
  category: string
  label: string
  playerId: string | null
  playerName: string
  teamAbbr: string | null
  value: string
  valueNum: number | null
  rank: number
}
