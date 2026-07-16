import { NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'

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

function extractSnippet(item: any): string {
  const desc = item.description ?? ''
  const cleaned = desc.replace(/<[^>]+>/g, '').trim()
  const entities = cleaned.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return entities.replace(/\s+/g, ' ').trim()
}

function getSourceName(item: any): string {
  if (typeof item.source === 'string') return item.source.trim()
  if (item.source?.['#text']) return item.source['#text'].trim()
  if (item['dc:creator']) return item['dc:creator'].trim()
  return 'News'
}

async function fetchGoogleNews(query: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const xml = await res.text()
    const data = parser.parse(xml)
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : []).map((item: any) => ({
      title: item.title?.replace(/^[^:]+:\s*/, '') ?? '',
      source: getSourceName(item),
      sourceUrl: extractSourceUrl(item) ?? '',
      date: item.pubDate ?? '',
      snippet: extractSnippet(item),
      url: extractArticleUrl(item),
      score: 0,
    }))
  } catch {
    return []
  }
}

async function fetchEspnNews(sport: string): Promise<NewsItem[]> {
  const sportPath: Record<string, string> = { NFL: 'nfl', NBA: 'nba', NHL: 'nhl', MLB: 'mlb' }
  const path = sportPath[sport.toUpperCase()]
  if (!path) return []

  try {
    const res = await fetch(`https://www.espn.com/espn/rss/${path}/news`, { next: { revalidate: 180 } })
    if (!res.ok) return []
    const xml = await res.text()
    const data = parser.parse(xml)
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : []).map((item: any) => ({
      title: item.title ?? '',
      source: item['dc:creator'] ?? 'ESPN',
      sourceUrl: '',
      date: item.pubDate ?? '',
      snippet: extractSnippet(item),
      url: item.link ?? '#',
      score: 0,
    }))
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

  const queries = [
    `${teamName} ${sport}`,
    teamName,
  ]

  let allArticles: NewsItem[] = []

  for (const q of queries) {
    const googleArticles = await fetchGoogleNews(q)
    allArticles.push(...googleArticles)
  }

  const seenUrls = new Set<string>()
  const scored = allArticles
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

  return NextResponse.json(
    { articles: scored },
    { headers: { 'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=300' } }
  )
}
