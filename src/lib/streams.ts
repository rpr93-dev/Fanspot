/**
 * StreamFree (streamfree.top) integration: free, keyless directory of live
 * sports streams. Fanspot never proxies video — the API only lists matches and
 * resolves the provider's embed URLs, and the watch page loads the chosen
 * embed in an iframe on click. If StreamFree is down, every route 502s with a
 * message and the UI shows a retry state instead of a player.
 */

export type WatchSport = 'nfl' | 'nba' | 'nhl' | 'mlb' | 'f1'

/** Fanspot sport -> StreamFree category. */
export const STREAM_CATEGORY: Record<WatchSport, string> = {
  nfl: 'football',
  nba: 'basketball',
  nhl: 'hockey',
  mlb: 'baseball',
  f1: 'racing',
}

export const WATCH_SPORTS: WatchSport[] = ['nfl', 'nba', 'nhl', 'mlb', 'f1']

export interface StreamSource {
  /** Lowercased provider quality label (fhd, sd, hd, 4k). */
  source: string
  /** StreamFree stream_key, shared by every quality variant. */
  id: string
}

export interface StreamMatch {
  id: string
  title: string
  category: string
  /** Unix seconds (StreamFree's match_timestamp). */
  date: number
  popular: boolean
  /** True when StreamFree reports at least one live source. */
  live?: boolean
  league?: string | null
  poster?: string | null
  teams?: { home?: { name?: string }; away?: { name?: string } } | null
  sources: StreamSource[]
}

/** Keep only https embed sources, de-duped by quality, all bound to the key. */
function shapeStreamFreeSources(raw: unknown, key: string): StreamSource[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StreamSource[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { quality, url } = item as { quality?: unknown; url?: unknown }
    if (typeof quality !== 'string' || typeof url !== 'string') continue
    if (!url.startsWith('https://')) continue
    const source = quality.trim().toLowerCase()
    if (!source || seen.has(source)) continue
    seen.add(source)
    out.push({ source, id: key })
  }
  return out
}

/**
 * Normalize one StreamFree `/api/v1/streams` entry into the shape the rest of
 * Fanspot uses. Every quality variant points at the same `stream_key`; the
 * embed route resolves that key to the actual https embed URLs.
 */
export function shapeStreamFreeMatch(m: unknown): StreamMatch | null {
  if (!m || typeof m !== 'object') return null
  const data = m as Record<string, unknown>
  const key = typeof data.stream_key === 'string' ? data.stream_key : ''
  const title = typeof data.name === 'string' ? data.name : ''
  if (!key || !title) return null
  const sources = shapeStreamFreeSources(data.sources, key)
  if (sources.length === 0) return null
  const liveSources = shapeStreamFreeSources(data.live_sources, key)
  return {
    id: key,
    title,
    category: typeof data.category === 'string' ? data.category : '',
    // StreamFree reports match_timestamp in Unix seconds.
    date: typeof data.match_timestamp === 'number' ? data.match_timestamp : 0,
    popular: liveSources.length > 0,
    live: liveSources.length > 0,
    league: typeof data.league === 'string' ? data.league : null,
    poster: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : null,
    teams: null,
    sources,
  }
}

export interface StreamOption {
  id: string
  streamNo: number
  language: string
  hd: boolean
  embedUrl: string
  source: string
  /** The match-source id this option was resolved from (for hub deep links). */
  originId?: string
  viewers?: number
}

/**
 * Decide which embed should be playing after a source refresh. A listing's
 * `id` can stay constant while its `sources[]` (and resolved embeds) change, and
 * hubs re-fetch listings on a timer — so a player must not tear down an active
 * feed just because the parent handed it an equal-but-new match object.
 *
 * Keeps the currently playing feed when it survives the refresh; otherwise
 * falls back to the best (first) available feed rather than dropping the viewer
 * back to the picker. Returns null only when there is nothing to play and none
 * was playing before (or autoplay is off).
 */
export function pickActiveEmbed(
  previous: string | null,
  options: Pick<StreamOption, 'embedUrl'>[],
  autoplay: boolean,
): string | null {
  if (previous && options.some((o) => o.embedUrl === previous)) return previous
  const first = options[0]?.embedUrl ?? null
  if (!first) return null
  return previous || autoplay ? first : null
}

/** Minimal scoreboard-game shape for hub resolution. */
export interface HubGame {
  id: string
  away: { name: string }
  home: { name: string }
}

/**
 * Resolve a stream listing to exactly one Fanspot game hub (by event id).
 * Returns null on zero or ambiguous matches — callers fall back to inline
 * playback instead of guessing a hub.
 */
export function findHubGame(games: HubGame[], teamA: string, teamB: string): string | null {
  const hits = games.filter((g) =>
    matchGame(
      { title: '', teams: { home: { name: g.home.name }, away: { name: g.away.name } } },
      teamA,
      teamB,
    ),
  )
  return hits.length === 1 ? hits[0].id : null
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/&amp;|&/g, 'and')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Does a team name appear in the haystack? Full normalized name first,
 * nickname (last word, min 4 chars) as fallback — "Golden State Warriors"
 * matches "Golden State" listings, "Ducks" matches either Anaheim team.
 */
function containsTeam(haystack: string, team: string): boolean {
  const hay = ` ${normalize(haystack)} `
  const full = normalize(team)
  if (full && hay.includes(` ${full} `)) return true
  const nick = full.split(' ').pop() ?? ''
  if (nick.length >= 4 && hay.includes(` ${nick} `)) return true
  return false
}

/**
 * Both teams must appear (title or teams.home/away). Single-team overlap
 * (derbies, city names) is not enough — avoids false-positive embeds.
 */
export function matchGame(
  match: Pick<StreamMatch, 'title' | 'teams'>,
  teamA: string,
  teamB: string,
): boolean {
  const hay = [match.title, match.teams?.home?.name ?? '', match.teams?.away?.name ?? ''].join(' ')
  return containsTeam(hay, teamA) && containsTeam(hay, teamB)
}

/** Filter a match list down to one game; [] when nothing matches both teams. */
export function findGameStreams(
  matches: Pick<StreamMatch, 'title' | 'teams'>[],
  teamA: string,
  teamB: string,
): number[] {
  const out: number[] = []
  matches.forEach((m, i) => {
    if (matchGame(m, teamA, teamB)) out.push(i)
  })
  return out
}

/* ------------------------------------------------------------------ */
/* NFL RedZone: StreamFree carries a single "RedZone" listing in the   */
/* football category. RedZone is only useful while Sunday games are    */
/* actually being played, so the option is gated by the broadcast      */
/* window (Sunday, ~noon to 7:30pm ET) AND a live game.                */
/* ------------------------------------------------------------------ */

/** RedZone opens around noon ET and runs through the late-afternoon slate. */
export const REDZONE_START_HOUR_ET = 12
export const REDZONE_END_HOUR_ET = 19.5

/**
 * Calendar/time-of-day parts for US/Eastern. `dateKey` is the ET calendar
 * date (YYYYMMDD) so a scoreboard query matches the day the games are played,
 * even around the UTC midnight rollover.
 */
export function easternTimeParts(now: Date = new Date()): {
  weekday: string
  hour: number
  minute: number
  dateKey: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return {
    weekday: get('weekday'),
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10) || 0,
    dateKey: `${get('year')}${get('month')}${get('day')}`,
  }
}

/** True during the RedZone broadcast window: Sunday, 12:00–19:30 ET. */
export function isRedzoneWindow(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = easternTimeParts(now)
  if (weekday !== 'Sun') return false
  const frac = hour + minute / 60
  return frac >= REDZONE_START_HOUR_ET && frac < REDZONE_END_HOUR_ET
}

/**
 * Is this StreamFree listing the RedZone channel (not a single game)? The
 * directory also carries matchup-shaped entries that merely mention RedZone
 * (e.g. "NFL vs RedZone") — those are excluded so we never embed a game feed
 * as the channel.
 */
export function isRedzoneListing(title: string): boolean {
  const hay = ` ${normalize(title)} `
  if (hay.includes(' vs ')) return false
  return hay.includes(' redzone ') || hay.includes(' red zone ')
}

/**
 * Pick the best RedZone listing from a set of StreamFree matches. Prefers the
 * entry with the most sources (more playback fallbacks), then the popular one,
 * then the most recent.
 */
export function findRedzoneStream<
  M extends { title: string; popular?: boolean; date?: number; sources?: unknown[] },
>(matches: M[]): M | null {
  const hits = matches.filter((m) => isRedzoneListing(m.title))
  if (hits.length === 0) return null
  return hits.sort(
    (a, b) =>
      (b.sources?.length ?? 0) - (a.sources?.length ?? 0) ||
      Number(b.popular) - Number(a.popular) ||
      (b.date ?? 0) - (a.date ?? 0),
  )[0]
}

const SOURCE_RE = /^[a-z0-9]{1,12}$/
// StreamFree keys are slugs but can carry accented letters (e.g. "san-josé").
const SOURCE_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}\-_]{0,127}$/u

/** Quality labels (fhd, sd, hd, 4k) double as the source identifier. */
export function isValidStreamSource(source: string): boolean {
  return SOURCE_RE.test(source)
}

export function isValidStreamId(id: string): boolean {
  return SOURCE_ID_RE.test(id)
}

export function isValidWatchSport(sport: string): sport is WatchSport {
  return (WATCH_SPORTS as readonly string[]).includes(sport)
}

/* ------------------------------------------------------------------ */
/* Coverage gating: the watch page only links matches Fanspot actually */
/* covers — two of our teams for ball sports (college/CFL/Euro games   */
/* share the same categories), F1 sessions by title for racing         */
/* (NASCAR, WRC, MotoGP and dirt tracks share that category too).      */
/* ------------------------------------------------------------------ */

/** Matches containing at least two DISTINCT covered teams (full name or nickname). */
export function filterCoveredMatches<M extends Pick<StreamMatch, 'title' | 'teams'>>(
  matches: M[],
  teamNames: string[],
): M[] {
  return matches.filter((m) => {
    const hay = [m.title, m.teams?.home?.name ?? '', m.teams?.away?.name ?? ''].join(' ')
    let hits = 0
    for (const name of teamNames) {
      if (containsTeam(hay, name) && ++hits >= 2) return true
    }
    return false
  })
}

const F1_STRONG = ['formula 1', 'formula1', 'grand prix']
const F1_SESSION_WORDS = new Set([
  'practice',
  'practices',
  'qualifying',
  'quali',
  'sprint',
  'shootout',
  'warm',
  'warmup',
])
/** Series/venues Fanspot doesn't cover — exclusion beats session words. */
const F1_EXCLUDE_WORDS = new Set([
  'moto',
  'motogp',
  'moto2',
  'moto3',
  'motegi',
  'superbike',
  'wsbk',
  'nascar',
  'truck',
  'xfinity',
  'arca',
  'rally',
  'wrc',
  'dakar',
  'dirt',
  'speedway',
  'lemans',
  'mans',
  'indycar',
  'supercars',
  'dtm',
  'wec',
  'imsa',
  'drag',
  'btcc',
  'donington',
])

/** Is this racing listing an F1 session (not NASCAR/WRC/MotoGP/dirt)? */
export function isF1Session(title: string): boolean {
  const norm = ` ${normalize(title)} `
  if (norm.includes('formula 1') || norm.includes('formula1')) return true
  const words = new Set(norm.split(' '))
  for (const w of words) {
    if (F1_EXCLUDE_WORDS.has(w)) return false
  }
  // StreamFree carries the always-on "Sky Sports F1" channel as well as
  // per-session listings, so a standalone F1 token is enough.
  if (words.has('f1')) return true
  if (F1_STRONG.some((p) => norm.includes(p))) return true
  for (const w of words) {
    if (F1_SESSION_WORDS.has(w)) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* F1 weekend streams: StreamFree's racing category mixes the whole    */
/* calendar (plus NASCAR/WRC/MotoGP) and may expose an always-on F1    */
/* channel. A race-weekend hub narrows it to listings that mention     */
/* THIS Grand Prix (name / circuit / locality) plus generic F1 feeds,  */
/* then ranks the active session's stream (race / quali / practice)   */
/* first.                                                              */
/* ------------------------------------------------------------------ */

/** Words that identify a Grand Prix, dropped when tokenizing a weekend. */
const F1_WEEK_STOP = new Set([
  'grand',
  'prix',
  'formula',
  'international',
  'circuit',
  'gp',
  'street',
  'the',
  'and',
  'of',
  'city',
  'race',
])

/** Significant weekend tokens (GP name + circuit + locality), de-duped. */
export function f1WeekTokens(words: Array<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const w of words) {
    for (const t of normalize(w ?? '').split(' ')) {
      if (t.length > 2 && !F1_WEEK_STOP.has(t) && !/^\d+$/.test(t)) out.add(t)
    }
  }
  return [...out]
}

/** Does a racing listing belong to this Grand Prix weekend? */
export function matchF1Weekend(title: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = ` ${normalize(title)} `
  return tokens.some((t) => hay.includes(` ${t} `))
}

/**
 * StreamFree exposes the always-on "Sky Sports F1" / "F1" channel alongside
 * individual sessions. Those listings never name a Grand Prix, so a weekend
 * filter must keep them regardless of the active circuit.
 */
export function isGenericF1Channel(title: string): boolean {
  const hay = ` ${normalize(title)} `
  if (hay.includes(' vs ')) return false
  return hay.split(' ').includes('f1')
}

/**
 * Rank a weekend listing against the active session: 3 = exact session
 * (quali/practice N/sprint), 2 = the race itself (a Grand Prix listing with
 * no practice/quali/sprint marker), 1 = a practice of another number, 0 = a
 * weekend match for a different session. Purely for ordering the picker.
 */
export function f1SessionScore(title: string, sessionName: string): number {
  const hay = ` ${normalize(title)} `
  const n = normalize(sessionName)
  const hasWord = (w: string) => hay.includes(` ${w} `)
  if (n.includes('sprint') && (n.includes('qualif') || n.includes('quali') || n.includes('shootout'))) {
    return hasWord('sprint') && (hasWord('qualifying') || hasWord('quali') || hasWord('shootout')) ? 3 : 0
  }
  if (n.includes('sprint')) return hasWord('sprint') ? 3 : 0
  if (n.includes('qualif') || n.includes('quali')) return hasWord('qualifying') || hasWord('quali') ? 3 : 0
  const p = n.match(/practice\s*(\d)/)
  if (p) return hay.includes(`practice ${p[1]}`) ? 3 : hasWord('practice') ? 1 : 0
  if (n.includes('practice') || n.includes('warm')) return hasWord('practice') || hasWord('warm') ? 3 : 0
  if (n.includes('race') || n.includes('grand prix')) {
    const other = hasWord('practice') || hasWord('qualifying') || hasWord('quali') || hasWord('sprint')
    return other ? 0 : 2
  }
  return 0
}
