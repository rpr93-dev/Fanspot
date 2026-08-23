import { NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

interface NewsItem {
  title: string
  source: string
  sourceUrl: string
  date: string
  snippet: string
  url: string
  score: number
}

function scoreArticle(title: string, snippet: string, teamName: string): number {
  const text = (title + ' ' + snippet).toLowerCase()
  const teamLower = teamName.toLowerCase()
  const teamTokens = teamLower.split(/\s+/).filter((t) => t.length > 2)
  const lastNameToken = teamTokens[teamTokens.length - 1]

  if (!title.toLowerCase().includes(lastNameToken)) return 0

  const excludedNames = ['Packers', 'Cowboys', 'Eagles', 'Chiefs', '49ers', 'Ravens', 'Bills', 'Bengals',
    'Browns', 'Dolphins', 'Jets', 'Patriots', 'Texans', 'Colts', 'Jaguars', 'Titans', 'Broncos', 'Raiders',
    'Chargers', 'Giants', 'Commanders', 'Bears', 'Lions', 'Vikings', 'Falcons', 'Panthers', 'Saints',
    'Buccaneers', 'Cardinals', 'Rams', 'Seahawks', 'Celtics', 'Nets', 'Knicks', '76ers', 'Raptors',
    'Bulls', 'Cavaliers', 'Pistons', 'Pacers', 'Bucks', 'Hawks', 'Hornets', 'Heat', 'Magic', 'Wizards',
    'Nuggets', 'Timberwolves', 'Thunder', 'Trail Blazers', 'Jazz', 'Warriors', 'Clippers', 'Lakers',
    'Suns', 'Kings', 'Mavericks', 'Rockets', 'Grizzlies', 'Pelicans', 'Spurs',
    'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes', 'Blackhawks', 'Avalanche',
    'Blue Jackets', 'Stars', 'Red Wings', 'Oilers', 'Panthers', 'Kings', 'Wild', 'Canadiens',
    'Predators', 'Devils', 'Islanders', 'Rangers', 'Senators', 'Flyers', 'Penguins', 'Sharks',
    'Kraken', 'Blues', 'Lightning', 'Maple Leafs', 'Canucks', 'Golden Knights', 'Capitals', 'Jets',
    'Diamondbacks', 'Braves', 'Orioles', 'Red Sox', 'Cubs', 'White Sox', 'Reds', 'Guardians',
    'Rockies', 'Tigers', 'Astros', 'Royals', 'Angels', 'Dodgers', 'Marlins', 'Brewers',
    'Twins', 'Yankees', 'Mets', 'Athletics', 'Phillies', 'Pirates', 'Padres', 'Giants',
    'Mariners', 'Cardinals', 'Rays', 'Rangers', 'Blue Jays', 'Nationals']

  for (const name of excludedNames) {
    const lower = name.toLowerCase()
    if (lower !== lastNameToken && title.toLowerCase().includes(lower)) {
      return 0
    }
  }

  let score = 5

  const keywords: [RegExp, number][] = [
    [/(injured?|injury|out\s+for)/i, 5],
    [/(trade|traded|trading|signs?|signed|signing|release[d]?|cut\s*|waive[d]?)/i, 5],
    [/(draft|drafted|pick|rookie)/i, 3],
    [/(contract|extension|deal|re-sign)/i, 5],
    [/(preview|matchup|vs\.?\s|game|week\s+\d)/i, 3],
    [/(recap|win|lose?|defea?t?e?d?|victory)/i, 3],
    [/(coach|coaching|hired?|fired?|staff)/i, 4],
    [/(interview|press\s+conference|quotes?)/i, 2],
    [/(report|source|insider|confirmed)/i, 2],
    [/(performance|stats?|highlights?)/i, 2],
    [/(rank|ranking|power\s+rank)/i, -2],
    [/(top\s+\d+|best\s+)/i, -1],
    [/(fantasy|dfs|betting|over\/?under|pick\s*\'?em)/i, -3],
  ]

  for (const [re, points] of keywords) {
    if (re.test(title)) score += points
  }

  return score
}

function extractSourceUrl(item: any): string | null {
  if (item.source?.['@_url']) return item.source['@_url']
  if (item.link && !item.link.includes('news.google.com')) return item.link
  return null
}

function extractArticleUrl(item: any): string {
  if (item.link && !item.link.includes('news.google.com')) return item.link

  const desc = item.description ?? ''
  const hrefMatch = desc.match(/href="([^"]+)"/)
  if (hrefMatch) return hrefMatch[1].replace(/&amp;/g, '&')

  return item.link ?? '#'
}

function extractSnippet(item: any, source: string): string {
  const desc = item.description ?? ''
  const cleaned = desc.replace(/<[^>]+>/g, '').trim()
  const entities = cleaned.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  let snippet = entities.replace(/\s+/g, ' ').trim()
  if (source && source !== 'News') {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    snippet = snippet.replace(new RegExp(`\\s*[-–—]?\\s*${escaped}\\.?\\s*$`), '')
  }
  return snippet.trim()
}

function getSourceName(item: any): string {
  if (typeof item.source === 'string') return item.source.trim()
  if (item.source?.['#text']) return item.source['#text'].trim()
  if (item['dc:creator']) return item['dc:creator'].trim()
  return 'News'
}

function cleanTitle(rawTitle: string | undefined, source: string): string {
  if (!rawTitle) return ''
  let title = rawTitle.replace(/^[^:]+:\s*/, '').trim()
  if (source && source !== 'News') {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    title = title.replace(new RegExp(`\\s*[-–—]\\s*${escaped}\\.?$`), '')
  }
  return title.replace(/\s+/g, ' ').trim()
}

async function fetchGoogleNews(query: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    const xml = await res.text()
    const data = parser.parse(xml)
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : []).map((item: any) => {
      const source = getSourceName(item)
      const title = cleanTitle(item.title, source)
      const snippet = extractSnippet(item, source)
      return {
      title,
      source,
      sourceUrl: extractSourceUrl(item) ?? '',
      date: item.pubDate ?? '',
      snippet: snippet === title ? '' : snippet,
      url: extractArticleUrl(item),
      score: 0,
      }
    })
  } catch {
    return []
  }
}

function isRecent(dateStr: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  return d.getTime() > weekAgo
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const teamName = searchParams.get('team')
  const sport = searchParams.get('sport') ?? ''

  if (!teamName) {
    return NextResponse.json({ error: 'Missing team' }, { status: 400 })
  }

  // Route-level cache: the client news poll re-hits this route every 120s per
  // tab, and each miss costs live Google News RSS round-trips (F2). TTL.NEWS
  // keeps repeat polls at in-memory cost.
  const articles = await fetchOrCache(
    `news-search:${sport.toLowerCase()}:${teamName.toLowerCase()}`,
    TTL.NEWS,
    async () => {
      const queries = [
        `${teamName} ${sport}`,
        teamName,
      ]

      // Both RSS feeds are independent — fetch them concurrently instead of
      // paying two sequential round-trips.
      const [primary, secondary] = await Promise.all(queries.map((q) => fetchGoogleNews(q)))
      const allArticles: NewsItem[] = [...primary, ...secondary]

      const seenUrls = new Set<string>()
      return allArticles
        .filter((a) => {
          const key = a.url || a.title
          if (seenUrls.has(key)) return false
          seenUrls.add(key)
          return true
        })
        .map((a) => {
          a.score = scoreArticle(a.title, a.snippet, teamName)
          return a
        })
        .filter((a) => a.score >= 5 && isRecent(a.date))
        .sort((a, b) => {
          const dateA = new Date(a.date).getTime()
          const dateB = new Date(b.date).getTime()
          return dateB - dateA
        })
        .slice(0, 6)
    },
  )

  return NextResponse.json(
    { articles },
    { headers: { 'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=300' } }
  )
}
