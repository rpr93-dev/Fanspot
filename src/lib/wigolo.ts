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

