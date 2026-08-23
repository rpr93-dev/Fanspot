interface CacheProvider {
  get<T>(key: string): { data: T; ts: number } | null
  set<T>(key: string, data: T): void
  delete(key: string): void
  clear(): void
  size(): number
}

const memoryCache = new Map<string, { data: unknown; ts: number }>()

const memoryProvider: CacheProvider = {
  get<T>(key: string): { data: T; ts: number } | null {
    const entry = memoryCache.get(key)
    if (!entry) return null
    return entry as { data: T; ts: number }
  },
  set<T>(key: string, data: T): void {
    memoryCache.set(key, { data, ts: Date.now() })
  },
  delete(key: string): void {
    memoryCache.delete(key)
  },
  clear(): void {
    memoryCache.clear()
  },
  size(): number {
    return memoryCache.size
  },
}

let provider: CacheProvider = memoryProvider

export function getCached<T>(key: string): { data: T; ts: number } | null {
  return provider.get<T>(key)
}

export function setCached<T>(key: string, data: T): void {
  provider.set(key, data)
}

export function isFresh(ts: number, ttl: number): boolean {
  return Date.now() - ts < ttl
}

export function isStale(ts: number, ttl: number, stale: number): boolean {
  const age = Date.now() - ts
  return age >= ttl && age < ttl + stale
}

export async function swr<T>(
  key: string,
  ttl: number,
  stale: number,
  fetchFn: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean; stale: boolean }> {
  const cached = getCached<T>(key)

  if (cached && isFresh(cached.ts, ttl)) {
    return { data: cached.data, fromCache: true, stale: false }
  }

  if (cached && isStale(cached.ts, ttl, stale)) {
    // Background revalidation: the caller already knows the data is stale via the
    // returned flag, but a silent failure here made repeated staleness untraceable.
    fetchFn()
      .then((fresh) => setCached(key, fresh))
      .catch((e) => console.warn('[swr] background refresh failed:', key, e))
    return { data: cached.data, fromCache: true, stale: true }
  }

  const fresh = await fetchFn()
  setCached(key, fresh)
  return { data: fresh, fromCache: false, stale: false }
}

export async function fetchOrCache<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = getCached<T>(key)
  if (cached && isFresh(cached.ts, ttl)) {
    return cached.data
  }
  const fresh = await fetchFn()
  setCached(key, fresh)
  return fresh
}
