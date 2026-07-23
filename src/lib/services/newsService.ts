import { TTL } from '@/lib/cache/ttl'
import { fetchOrCache } from '@/lib/cache/cacheService'

export async function getNews(
  sport: string,
  teamName: string,
  origin?: string,
): Promise<any[]> {
  const cacheKey = `news:${sport}:${teamName}`
  const base = origin ?? ''
  const result = await fetchOrCache(
    cacheKey,
    TTL.NEWS,
    async () => {
      const res = await fetch(
        `${base}/api/news-search?team=${encodeURIComponent(teamName)}&sport=${encodeURIComponent(sport)}`,
        { signal: AbortSignal.timeout(10000) },
      )
      if (!res.ok) return []
      const data = await res.json()
      return data?.articles ?? []
    },
  )
  return result ?? []
}
