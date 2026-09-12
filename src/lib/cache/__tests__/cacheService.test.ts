import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchOrCache,
  getCached,
  setCachedChecked,
  memoryKeyFor,
  isFailureResult,
  MAX_CACHE_ENTRIES,
  NEGATIVE_TTL_MS,
} from '@/lib/cache/cacheService'

describe('fetchOrCache negative caching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not serve null/empty/error results for a full TTL', async () => {
    let calls = 0
    const key = `t:fails:${Math.random()}`
    const fetchFn = async () => {
      calls += 1
      return calls === 1 ? null : [{ id: 1 }]
    }

    const first = await fetchOrCache(key, 3_600_000, fetchFn)
    expect(first).toBe(null)
    expect(calls).toBe(1)

    // Still within negative TTL: served from cache.
    vi.advanceTimersByTime(NEGATIVE_TTL_MS - 1000)
    await fetchOrCache(key, 3_600_000, fetchFn)
    expect(calls).toBe(1)

    // Past the 15s negative window (but well within the full TTL): must retry.
    vi.advanceTimersByTime(NEGATIVE_TTL_MS + 1000)
    const second = await fetchOrCache(key, 3_600_000, fetchFn)
    expect(calls).toBe(2)
    expect(second).toEqual([{ id: 1 }])
  })

  it('keeps successful results cached for the full TTL', async () => {
    let calls = 0
    const key = `t:ok:${Math.random()}`
    const fetchFn = async () => {
      calls += 1
      return { standings: [{ name: 'AFC' }], teamStanding: 'AFC East' }
    }

    await fetchOrCache(key, 3_600_000, fetchFn)
    vi.advanceTimersByTime(3_600_000 - 1000)
    await fetchOrCache(key, 3_600_000, fetchFn)
    expect(calls).toBe(1)
  })

  it('treats { odds: null }, error bodies, and empty standings as failures', async () => {
    for (const shape of [{ odds: null, source: 'espn' }, { error: 'boom' }, { standings: [], teamStanding: 'AFC East' }, []]) {
      let calls = 0
      const key = `t:shape:${Math.random()}`
      await fetchOrCache(key, 3_600_000, async () => { calls += 1; return shape })
      vi.advanceTimersByTime(NEGATIVE_TTL_MS + 1000)
      await fetchOrCache(key, 3_600_000, async () => { calls += 1; return shape })
      expect(calls).toBe(2)
    }
  })

  it('negative entry upgrades to full TTL once a good result lands', async () => {
    let ok = false
    const key = `t:upgrade:${Math.random()}`
    const fetchFn = async () => (ok ? { rows: [1] } : [])
    await fetchOrCache(key, 3_600_000, fetchFn)
    ok = true
    vi.advanceTimersByTime(NEGATIVE_TTL_MS + 1)
    await fetchOrCache(key, 3_600_000, fetchFn)
    // Now positive: still fresh 59 minutes later.
    vi.advanceTimersByTime(3_600_000 - 60_000)
    const again = await fetchOrCache(key, 3_600_000, fetchFn)
    expect(again).toEqual({ rows: [1] })
  })
})

describe('isFailureResult', () => {
  it('flags empty/null/error shapes', () => {
    expect(isFailureResult(null)).toBe(true)
    expect(isFailureResult(undefined)).toBe(true)
    expect(isFailureResult([])).toBe(true)
    expect(isFailureResult({ error: 'x' })).toBe(true)
    expect(isFailureResult({ odds: null })).toBe(true)
    expect(isFailureResult({ standings: [] })).toBe(true)
    expect(isFailureResult({ events: [], problems: ['boom'] })).toBe(true)
  })
  it('accepts healthy shapes', () => {
    expect(isFailureResult([1])).toBe(false)
    expect(isFailureResult({ odds: { spread: 3 } })).toBe(false)
    expect(isFailureResult({ standings: [] , extra: 1 })).toBe(true)
    expect(isFailureResult({ standings: [{ name: 'A' }] })).toBe(false)
    expect(isFailureResult('')).toBe(true) // empty AI content is a failure
    expect(isFailureResult('Real analysis text')).toBe(false)
    expect(isFailureResult({ events: [], problems: [] })).toBe(false)
  })
})

describe('bounded cache + key hashing', () => {
  it('evicts least-recently-used entries at the cap', () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      setCachedChecked(`lru:a${i}`, { i })
    }
    expect(getCached('lru:a0')).not.toBe(null)
    // Touch a0 so it becomes the most-recently-used.
    getCached('lru:a0')
    setCachedChecked('lru:a-new', 1)
    expect(getCached('lru:a1')).toBe(null)
    expect(getCached('lru:a0')).not.toBe(null)
    expect(getCached('lru:a-new')).not.toBe(null)
  })

  it('stores over-long keys hashed (raw user input never lands raw in the map)', () => {
    const long = 'x'.repeat(5000)
    setCachedChecked(`news:long:${long}`, { articles: [1] })
    expect(getCached(`news:long:${long}`)).not.toBe(null)
    expect(memoryKeyFor(long)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(memoryKeyFor('short:key')).toBe('short:key')
    // Boundary: 200 chars stays raw, 201 gets hashed.
    expect(memoryKeyFor('y'.repeat(200))).toHaveLength(200)
    expect(memoryKeyFor('y'.repeat(201))).toMatch(/^sha256:/)
  })
})
