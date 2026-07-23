import { NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

interface WigoloArticle {
  title: string
  url: string
  snippet: string
  source: string
  content?: string
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
  return cleaned.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function getSourceName(item: any): string {
  if (typeof item.source === 'string') return item.source.trim()
  if (item.source?.['#text']) return item.source['#text'].trim()
  return 'Web'
}

async function fetchGoogleNews(query: string): Promise<WigoloArticle[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const xml = await res.text()
    const data = parser.parse(xml)
    const items = data?.rss?.channel?.item ?? []
    return (Array.isArray(items) ? items : []).slice(0, 8).map((item: any) => ({
      title: item.title?.replace(/^[^:]+:\s*/, '') ?? '',
      url: extractArticleUrl(item),
      snippet: extractSnippet(item),
      source: getSourceName(item),
    }))
  } catch {
    return []
  }
}

async function enrichWithContent(articles: WigoloArticle[], maxContent: number): Promise<WigoloArticle[]> {
  const enriched = await Promise.all(
    articles.slice(0, maxContent).map(async (a) => {
      if (!a.url || a.url === '#' || a.url.startsWith('http')) {
        try {
          const res = await fetch(a.url, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fanspot/1.0)' },
          })
          if (res.ok) {
            const html = await res.text()
            const text = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
              .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
              .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
              .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&nbsp;/g, ' ')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, ' ')
              .trim()
            return { ...a, content: text.slice(0, 2000) }
          }
        } catch {}
      }
      return a
    }),
  )
  return enriched
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')
  const sport = searchParams.get('sport') ?? ''
  const fetchContent = searchParams.get('content') === 'true'

  if (!q) {
    return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 })
  }

  const queries = [
    `${q} ${sport}`,
    q,
  ]

  let allArticles: WigoloArticle[] = []
  for (const query of queries) {
    const results = await fetchGoogleNews(query)
    allArticles.push(...results)
  }

  const seen = new Set<string>()
  const deduped = allArticles.filter((a) => {
    const key = a.url || a.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)

  const results = fetchContent
    ? await enrichWithContent(deduped, 3)
    : deduped

  return NextResponse.json(
    { results, total: results.length },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=300',
      },
    },
  )
}
