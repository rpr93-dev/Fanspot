import type { SportKey } from '@/lib/models'

/**
 * ESPN scoreboard events carry the season phase in `season.type` with
 * `seasonType` null (verified across NFL / NBA / NHL / MLB); provider-built
 * events (NHL API, MLB Stats API, NBA summer league) set `seasonType`
 * instead. Read both, with slug / name text as a last resort.
 *
 * Phase codes: 1 = preseason (Spring Training for MLB), 2 = regular,
 * 3 = postseason, 4 = NBA Summer League.
 */
export function eventSeasonType(event: any): number | null {
  const seasonType = event?.seasonType?.type
  if (typeof seasonType === 'number' && seasonType > 0) return seasonType
  const season = event?.season?.type
  if (typeof season === 'number' && season > 0) return season
  const text = String(event?.season?.slug ?? event?.seasonType?.name ?? '').toLowerCase()
  if (text.includes('pre') || text.includes('spring')) return 1
  if (text.includes('summer')) return 4
  if (text.includes('post') || text.includes('playoff')) return 3
  if (text.includes('regular')) return 2
  return null
}

/** True for preseason games (NBA / NHL / NFL) and Spring Training (MLB). */
export function isPreseasonEvent(event: any): boolean {
  return eventSeasonType(event) === 1
}

/** Display label for a season phase with per-league wording (regular → none, it is the default). */
export function seasonTypeLabel(sport: string, type: number | null): string | undefined {
  if (type == null) return undefined
  const key = String(sport).toUpperCase() as SportKey
  if (type === 1) return key === 'MLB' ? 'Spring Training' : 'Preseason'
  if (type === 3) return key === 'MLB' ? 'Postseason' : 'Playoffs'
  if (type === 4) return 'Summer League'
  return undefined
}
