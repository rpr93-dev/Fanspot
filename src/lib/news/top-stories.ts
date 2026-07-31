import { XMLParser } from 'fast-xml-parser'
import { STORY_LEAGUES, rankStories, type RawStory, type StoryLeague, type TopStory } from './story-ranking'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

/**
 * Its own fetch job rather than a hook into news-momentum: that one is scoped to a
 * single player and capped at the top 10 of a board, which is the wrong shape for
 * cross-league coverage.
 */
const QUERIES_PER_LEAGUE = ['trade', 'signs contract', 'breaking news', 'injury news']
const ITEMS_PER_QUERY = 12

/** Significance-ranked, so this does not need to be near real time. */
export const TOP_STORIES_TTL_MS = 30 * 60 * 1000

interface CacheEntry {
  at: number
  stories: TopStory[]
}
const cache = new Map<string, CacheEntry>()

function text(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)['#text'] ?? '')
  }
  return ''
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function fetchLeagueQuery(league: StoryLeague, query: string): Promise<RawStory[]> {
  const q = `${league.toUpperCase()} ${query}`
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = parser.parse(await res.text())
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : [items])
      .slice(0, ITEMS_PER_QUERY)
      .map((item: Record<string, unknown>): RawStory => {
        const source = text(item.source).trim() || 'Web'
        // Google appends " - Publisher" to every headline.
        const title = decodeEntities(text(item.title))
          .replace(new RegExp(`\\s*-\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
          .trim()

        // For search feeds the description is just the linked title plus the publisher,
        // so it carries no information the headline doesn't already have.
        const rawSnippet = decodeEntities(text(item.description).replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
        const snippet =
          normalize(rawSnippet).startsWith(normalize(title)) ? '' : rawSnippet.slice(0, 240)

        return {
          title,
          url: text(item.link),
          source,
          snippet,
          publishedAt: item.pubDate ? new Date(text(item.pubDate)).toISOString() : null,
          league,
        }
      })
      .filter((s: RawStory) => s.title.length > 0 && s.url.length > 0)
  } catch {
    return []
  }
}

export interface TopStoriesResult {
  stories: TopStory[]
  /** Leagues that returned nothing, so the UI can say so instead of implying full coverage. */
  emptyLeagues: StoryLeague[]
  fetchedAt: string
  cached: boolean
}

export async function getTopStories(
  leagues: readonly StoryLeague[] = STORY_LEAGUES,
  limit = 20,
): Promise<TopStoriesResult> {
  const key = `${[...leagues].sort().join(',')}:${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TOP_STORIES_TTL_MS) {
    return {
      stories: hit.stories,
      emptyLeagues: [],
      fetchedAt: new Date(hit.at).toISOString(),
      cached: true,
    }
  }

  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      const batches = await Promise.all(QUERIES_PER_LEAGUE.map((q) => fetchLeagueQuery(league, q)))
      return { league, raw: batches.flat() }
    }),
  )

  const emptyLeagues = perLeague.filter((p) => p.raw.length === 0).map((p) => p.league)
  const stories = rankStories(perLeague.flatMap((p) => p.raw), limit)

  // An all-empty result is an upstream outage, not a slow news day — don't cache it.
  if (stories.length > 0) cache.set(key, { at: Date.now(), stories })

  return { stories, emptyLeagues, fetchedAt: new Date().toISOString(), cached: false }
}
