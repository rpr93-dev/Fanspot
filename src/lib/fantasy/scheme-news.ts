import { teams } from '@/data/teams'
import { fetchNewsArticles } from './news-momentum'

/**
 * Offseason scheme-change narrative, built from the same Google News RSS feed the
 * injury cross-check uses. This is the signal that catches the "new coach, better
 * passing offense" case: Vegas odds and ESPN projections are both analyst-built off
 * last season's role, so a coaching or scheme change moves reality before either of
 * them reprices.
 *
 * Runs as a background pre-warm: the first request after expiry serves whatever is
 * cached (possibly nothing) and kicks off a refresh off the request path, so reads
 * never pay for the ~32 team queries.
 */
export interface SchemeSignal {
  team: string
  /** Clamped to [-20, +20]; positive = narrative favours the offense. */
  delta: number
  hasSignal: boolean
  headlines: string[]
  fetchedAt: number
}

const SCHEME_TTL_MS = 12 * 60 * 60 * 1000

const POSITIVE_SCHEME_TERMS = [
  'new offensive coordinator', 'named offensive coordinator', 'new head coach',
  'new offensive scheme', 'pass-heavy', 'passing game', 'air raid', 'spread offense',
  'west coast', 'qb-friendly', 'qb upgrade', 'up-tempo', 'explosive offense',
  'high-powered', 'modern offense', 'play action', 'scheme fit', 'passing attack',
  'more passes', 'vertical passing',
]

const NEGATIVE_SCHEME_TERMS = [
  'run-first', 'run-heavy', 'ground and pound', 'fired', 'stepping down',
  'revolving door', 'qb carousel', 'qb controversy', 'stagnant', 'worst offense',
  'ranked last', 'conservative offense', 'ineffective', 'underwhelming',
  'o-line concerns', 'offensive line woes', 'offense concerns', 'struggles',
]

/** Pure keyword sentiment over a set of headlines; exported for tests. */
export function scoreSchemeHeadlines(headlines: string[]): number {
  let score = 0
  const text = headlines.join(' ').toLowerCase()
  for (const term of POSITIVE_SCHEME_TERMS) {
    if (text.includes(term)) score += 10
  }
  for (const term of NEGATIVE_SCHEME_TERMS) {
    if (text.includes(term)) score -= 10
  }
  return score
}

export function clampSchemeDelta(raw: number): number {
  return Math.max(-20, Math.min(20, raw))
}

const NFL_TEAMS = teams
  .filter((t) => t.sport === 'NFL')
  .map((t) => ({ abbr: t.abbreviation.toUpperCase(), name: t.name }))

/**
 * A headline only counts if it is about the team itself (any word of the full name,
 * e.g. "Seahawks") or explicitly NFL — the RSS feed returns college-program noise
 * that mentions the same coordinator terms.
 */
/** Exported for tests: a headline only counts when it names the team or the NFL. */
export function relevantToTeam(headline: string, teamName: string): boolean {
  const text = headline.toLowerCase()
  const tokens = teamName.toLowerCase().split(' ').filter((w) => w.length >= 3)
  if (tokens.some((w) => text.includes(w))) return true
  return text.includes('nfl')
}

function nameForTeam(abbr: string): string {
  return NFL_TEAMS.find((t) => t.abbr === abbr)?.name ?? abbr
}

const TEAMS = NFL_TEAMS.map((t) => t.abbr)

async function signalForTeam(team: string): Promise<SchemeSignal> {
  const name = nameForTeam(team)
  const queries = [`"${name}" offensive coordinator`, `"${name}" offense scheme`]
  const [first, second] = await Promise.all(queries.map((q) => fetchNewsArticles(q)))
  const seen = new Set<string>()
  const headlines = [...first, ...second]
    .map((a) => a.title)
    .filter((t) => (seen.has(t) ? false : seen.add(t)))
    .filter((t) => relevantToTeam(t, name))
    .slice(0, 6)

  const delta = clampSchemeDelta(scoreSchemeHeadlines(headlines))
  return {
    team,
    delta,
    hasSignal: delta !== 0 && headlines.length > 0,
    headlines,
    fetchedAt: Date.now(),
  }
}

let schemeCache: { data: Map<string, SchemeSignal> | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
}
let refreshing: Promise<unknown> | null = null

/** Last completed refresh time, for the UI to say how fresh the scheme data is. */
export function getSchemeCacheAge(): number {
  return schemeCache.fetchedAt > 0 ? Date.now() - schemeCache.fetchedAt : -1
}

export function getSchemeCacheSize(): number {
  return schemeCache.data?.size ?? 0
}

/**
 * Returns the cached scheme map immediately and triggers a background refresh when
 * it is missing or older than the TTL. Callers must treat an empty map as "no scheme
 * narrative yet", not as "schemes are neutral".
 */
export async function getSchemeSignals(): Promise<Map<string, SchemeSignal>> {
  const stale = !schemeCache.data || Date.now() - schemeCache.fetchedAt > SCHEME_TTL_MS
  if (stale && !refreshing) {
    refreshing = refreshSchemeSignals()
      .catch((err) => {
        console.warn('[scheme-news] background refresh failed', err)
      })
      .finally(() => {
        refreshing = null
      })
  }
  return schemeCache.data ?? new Map()
}

export async function refreshSchemeSignals(teamList: string[] = TEAMS): Promise<Map<string, SchemeSignal>> {
  const settled = await Promise.allSettled(teamList.map(signalForTeam))
  const map = new Map<string, SchemeSignal>()
  for (const r of settled) {
    if (r.status === 'fulfilled') map.set(r.value.team, r.value)
  }
  schemeCache = { data: map, fetchedAt: Date.now() }
  return map
}
