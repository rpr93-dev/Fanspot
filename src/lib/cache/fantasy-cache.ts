import { invalidateFantasyCache, getFantasyCacheStats } from '@/lib/providers/fantasy'
import { clearSleeperCache, getSleeperCacheStats } from '@/lib/providers/sleeper'
import type { FantasySport } from '@/lib/fantasy-types'

let hitCount = 0
let missCount = 0

export function recordCacheHit(): void {
  hitCount++
}

export function recordCacheMiss(): void {
  missCount++
}

export function invalidateSport(sport: FantasySport, season?: number): void {
  invalidateFantasyCache(sport, season)
  clearSleeperCache(sport)
}

export function getStats(): {
  espnEntries: { key: string; expired: boolean }[]
  sleeperEntries: { sport: string; entries: number; expired: boolean }[]
  hitRate: number
  missRate: number
} {
  const total = hitCount + missCount
  return {
    espnEntries: getFantasyCacheStats(),
    sleeperEntries: getSleeperCacheStats() as any[],
    hitRate: total > 0 ? hitCount / total : 0,
    missRate: total > 0 ? missCount / total : 0,
  }
}

export function invalidateAll(): void {
  invalidateFantasyCache()
  clearSleeperCache()
}
