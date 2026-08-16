import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

/**
 * The steals board cross-checks up to 30 players' headlines per first-page request;
 * without a cache that is 30 parallel Google News fetches on every page load. Google
 * News RSS is not exactly real-time for fantasy coverage, so 30 minutes is a fine
 * freshness window for "did anyone report something severe".
 */
const MOMENTUM_TTL_MS = 30 * 60 * 1000
const momentumCache = new Map<string, { data: PlayerMomentum; expiresAt: number }>()

export interface NewsArticle {
  title: string
  snippet: string
  source: string
}

export interface PlayerMomentum {
  score: number
  headlines: string[]
}

const POSITIVE_KEYWORDS = [
  'breakout', 'sleeper', 'standout', 'camp darling', 'breakout candidate',
  'increased role', 'target hog', 'workhorse', 'featured', 'emerging',
  'rising', 'stock up', 'huge year', 'primed',
  'bounce-back', 'comeback', 'healthy', 'starting role', 'locked in',
  'camp standout', 'dominant', 'star',
]

const NEGATIVE_KEYWORDS = [
  'injury', 'injured', 'limited', 'demoted', 'benched', 'concern',
  'setback', 'depth chart', 'trade request', 'holdout', 'suspended',
  'declined', 'drop-off', 'regression', 'surgery', 'IR', 'questionable',
  'uncertain role', 'competition', 'timeshare', 'splitting', 'doubtful',
  'miss', 'injury-prone',
  'trade', 'arrest', 'warrant', 'cut', 'legal', 'reserve list',
  'not playing', 'sidelined', 'dispute', 'released', 'controversy',
  'standoff', 'stalemate', 'hold in', 'hold in',
]

function analyzeSentiment(title: string, snippet: string): number {
  const text = `${title} ${snippet}`.toLowerCase()
  let score = 0
  for (const kw of POSITIVE_KEYWORDS) {
    if (text.includes(kw)) score += 10
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (text.includes(kw)) score -= 10
  }
  return score
}

/** Shared Google News RSS lookup, reused by the scheme-change narrative builder. */
export async function fetchNewsArticles(query: string): Promise<NewsArticle[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const xml = await res.text()
    const data = parser.parse(xml)
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : []).slice(0, 5).map((item: any) => ({
      title: item.title?.replace(/^[^:]+:\s*/, '') ?? '',
      snippet: (item.description ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
      source: typeof item.source === 'string' ? item.source.trim() : (item.source?.['#text'] ?? 'Web'),
    }))
  } catch {
    return []
  }
}

export async function getPlayerMomentum(
  playerName: string,
  teamAbbr: string,
  sport: string,
): Promise<PlayerMomentum> {
  const key = `${sport}|${teamAbbr}|${playerName}`.toLowerCase()
  const hit = momentumCache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.data

  const data = await fetchPlayerMomentum(playerName, teamAbbr, sport)
  momentumCache.set(key, { data, expiresAt: Date.now() + MOMENTUM_TTL_MS })
  // A generous cap guards against unbounded growth from one-off queries; the steals
  // board only ever touches a few hundred distinct players.
  if (momentumCache.size > 2000) {
    const oldest = momentumCache.keys().next().value
    if (oldest != null) momentumCache.delete(oldest)
  }
  return data
}

async function fetchPlayerMomentum(
  playerName: string,
  teamAbbr: string,
  sport: string,
): Promise<PlayerMomentum> {
  async function tryQuery(query: string): Promise<PlayerMomentum> {
    const results = await fetchNewsArticles(query)
    const seen = new Set<string>()
    const articles = results.filter((a) => {
      if (seen.has(a.title)) return false
      seen.add(a.title)
      return true
    }).slice(0, 5)

    if (articles.length === 0) return { score: 50, headlines: [] }

    let sentimentSum = 0
    for (const a of articles) {
      sentimentSum += analyzeSentiment(a.title, a.snippet)
    }
    const avgSentiment = sentimentSum / articles.length
    const score = Math.max(0, Math.min(100, 50 + avgSentiment))

    return {
      score: Math.round(score),
      headlines: articles.map((a) => a.title),
    }
  }

  const result = await tryQuery(`"${playerName}" "${teamAbbr}" fantasy ${sport}`)
  if (result.headlines.length > 0) return result
  return tryQuery(`"${playerName}" fantasy ${sport}`)
}
