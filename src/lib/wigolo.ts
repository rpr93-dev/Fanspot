export interface WigoloResult {
  title: string
  url: string
  snippet: string
  source: string
  content?: string
}

export interface WigoloResponse {
  results: WigoloResult[]
  total: number
}

export async function searchWeb(
  query: string,
  sport?: string,
  origin?: string,
): Promise<WigoloResult[]> {
  try {
    const params = new URLSearchParams({ q: query })
    if (sport) params.set('sport', sport)
    const base = origin ?? 'http://localhost:3000'
    const res = await fetch(`${base}/api/wigolo?${params}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data: WigoloResponse = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

export async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fanspot/1.0)' },
    })
    if (!res.ok) return null
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
    return text.slice(0, 3000)
  } catch {
    return null
  }
}
