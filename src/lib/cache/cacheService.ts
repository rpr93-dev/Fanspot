import { createHash } from 'crypto'

export interface CacheEntry<T = unknown> {
  data: T
  ts: number
  /**
   * True when the stored value is a failure/empty shape. Negative entries are
   * served for NEGATIVE_TTL_MS only, so a transient upstream failure can never
   * pin a full (hours-long) TTL while stale.
   */
  negative?: boolean
}

interface CacheProvider {
  get<T>(key: string): CacheEntry<T> | null
  set<T>(key: string, data: T, negative?: boolean): void
  delete(key: string): void
  clear(): void
  size(): number
}

/** Max live entries; oldest-used evicted first (LRU via Map insertion order). */
export const MAX_CACHE_ENTRIES = 500
/** How long a failure/empty result may be reused before a retry is forced. */
export const NEGATIVE_TTL_MS = 15_000
/** Keys longer than this (raw user input can be arbitrarily long) are hashed. */
const HASH_KEY_THRESHOLD = 200

/** Stable internal Map key: over-long keys collapse to a SHA-256 digest. */
export function memoryKeyFor(key: string): string {
  return key.length > HASH_KEY_THRESHOLD
    ? `sha256:${createHash('sha256').update(key).digest('hex')}`
    : key
}

const memoryCache = new Map<string, CacheEntry>()

const memoryProvider: CacheProvider = {
  get<T>(key: string): CacheEntry<T> | null {
    const k = memoryKeyFor(key)
    const entry = memoryCache.get(k)
    if (!entry) return null
    // LRU bump: re-insert so this entry becomes the most-recently-used.
    memoryCache.delete(k)
    memoryCache.set(k, entry)
    return entry as CacheEntry<T>
  },
  set<T>(key: string, data: T, negative = false): void {
    const k = memoryKeyFor(key)
    memoryCache.delete(k)
    memoryCache.set(k, { data, ts: Date.now(), negative })
    while (memoryCache.size > MAX_CACHE_ENTRIES) {
      const oldest = memoryCache.keys().next()
      if (oldest.done) break
      memoryCache.delete(oldest.value)
    }
  },
  delete(key: string): void {
    memoryCache.delete(memoryKeyFor(key))
  },
  clear(): void {
    memoryCache.clear()
  },
  size(): number {
    return memoryCache.size
  },
}

let provider: CacheProvider = memoryProvider

export function getCached<T>(key: string): CacheEntry<T> | null {
  return provider.get<T>(key)
}

export function setCached<T>(key: string, data: T): void {
  provider.set(key, data)
}

/** setCached variant that flags failure/empty shapes as short-lived negative entries. */
export function setCachedChecked<T>(key: string, data: T): void {
  provider.set(key, data, isFailureResult(data))
}

/**
 * Heuristic "this result should not sit in cache for a full TTL" check:
 * null/undefined, empty arrays, `{ error }` bodies, the odds route's
 * `{ odds: null }` not-available shape, empty standings, and provider
 * results with zero events but reported problems.
 */
export function isFailureResult(data: unknown): boolean {
  if (data == null) return true
  if (Array.isArray(data)) return data.length === 0
  if (typeof data === 'string') return data.trim().length === 0
  if (typeof data !== 'object') return false
  const rec = data as Record<string, unknown>
  if (typeof rec.error === 'string' && rec.error) return true
  if ('odds' in rec && rec.odds == null) return true
  if (Array.isArray(rec.standings) && rec.standings.length === 0) return true
  if (Array.isArray(rec.articles) && rec.articles.length === 0) return true
  if (
    Array.isArray(rec.events) && rec.events.length === 0 &&
    Array.isArray(rec.problems) && rec.problems.length > 0
  ) return true
  return false
}

export function isFresh(ts: number, ttl: number): boolean {
  return Date.now() - ts < ttl
}

export function isStale(ts: number, ttl: number, stale: number): boolean {
  const age = Date.now() - ts
  return age >= ttl && age < ttl + stale
}

/** Effective freshness window for a cached entry (negative entries expire fast). */
function ttlFor(cached: CacheEntry | null, ttl: number): number {
  return cached?.negative ? Math.min(ttl, NEGATIVE_TTL_MS) : ttl
}

/** Convenience: is this cache entry (possibly null) fresh under its TTL? */
export function isCachedFresh(cached: CacheEntry | null, ttl: number): boolean {
  return cached != null && isFresh(cached.ts, ttlFor(cached, ttl))
}

export async function swr<T>(
  key: string,
  ttl: number,
  stale: number,
  fetchFn: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean; stale: boolean }> {
  const cached = getCached<T>(key)
  const window = ttlFor(cached, ttl)

  if (cached && isFresh(cached.ts, window)) {
    return { data: cached.data, fromCache: true, stale: false }
  }

  if (cached && !cached.negative && isStale(cached.ts, ttl, stale)) {
    // Background revalidation: the caller already knows the data is stale via the
    // returned flag, but a silent failure here made repeated staleness untraceable.
    fetchFn()
      .then((fresh) => setCachedChecked(key, fresh))
      .catch((e) => console.warn('[swr] background refresh failed:', key, e))
    return { data: cached.data, fromCache: true, stale: true }
  }

  const fresh = await fetchFn()
  setCachedChecked(key, fresh)
  return { data: fresh, fromCache: false, stale: false }
}

export async function fetchOrCache<T>(
  key: string,
  ttl: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const cached = getCached<T>(key)
  if (cached && isFresh(cached.ts, ttlFor(cached, ttl))) {
    return cached.data
  }
  const fresh = await fetchFn()
  setCachedChecked(key, fresh)
  return fresh
}
