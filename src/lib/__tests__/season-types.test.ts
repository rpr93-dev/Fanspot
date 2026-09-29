import { describe, it, expect } from 'vitest'
import { eventSeasonType, isPreseasonEvent, seasonTypeLabel } from '@/lib/season-types'

describe('eventSeasonType', () => {
  it('prefers seasonType.type when present (provider-built events)', () => {
    expect(eventSeasonType({ seasonType: { type: 1, name: 'Spring Training' }, season: { year: 2026, type: 2 } })).toBe(1)
    expect(eventSeasonType({ seasonType: { type: 3 }, season: { year: 2025, type: 2 } })).toBe(3)
  })

  it('falls back to season.type for ESPN scoreboard events (seasonType null)', () => {
    expect(eventSeasonType({ seasonType: null, season: { year: 2026, type: 1, slug: 'preseason' } })).toBe(1)
    expect(eventSeasonType({ seasonType: null, season: { year: 2025, type: 2, slug: 'regular-season' } })).toBe(2)
    expect(eventSeasonType({ seasonType: null, season: { year: 2025, type: 3, slug: 'post-season' } })).toBe(3)
  })

  it('derives the phase from slug text as a last resort', () => {
    expect(eventSeasonType({ season: { year: 2026, type: 0, slug: 'pre-season' } })).toBe(1)
    expect(eventSeasonType({ season: { year: 2026, type: 0, slug: 'spring-training' } })).toBe(1)
    expect(eventSeasonType({ season: { year: 2026, type: 0, slug: 'summer-league' } })).toBe(4)
    expect(eventSeasonType({ season: { year: 2025, type: 0, slug: 'post-season' } })).toBe(3)
    expect(eventSeasonType({ season: { year: 2025, type: 0, slug: 'regular-season' } })).toBe(2)
  })

  it('returns null when no phase info is present', () => {
    expect(eventSeasonType({})).toBeNull()
    expect(eventSeasonType(null)).toBeNull()
    expect(eventSeasonType({ season: { year: 2025 } })).toBeNull()
  })
})

describe('isPreseasonEvent', () => {
  it('is true only for phase 1', () => {
    expect(isPreseasonEvent({ season: { type: 1 } })).toBe(true)
    expect(isPreseasonEvent({ seasonType: { type: 1 } })).toBe(true)
    expect(isPreseasonEvent({ season: { type: 2 } })).toBe(false)
    expect(isPreseasonEvent({ season: { type: 3 } })).toBe(false)
    expect(isPreseasonEvent({})).toBe(false)
  })
})

describe('seasonTypeLabel', () => {
  it('uses Spring Training / Postseason for MLB, Preseason / Playoffs elsewhere', () => {
    expect(seasonTypeLabel('MLB', 1)).toBe('Spring Training')
    expect(seasonTypeLabel('MLB', 3)).toBe('Postseason')
    expect(seasonTypeLabel('NBA', 1)).toBe('Preseason')
    expect(seasonTypeLabel('NHL', 1)).toBe('Preseason')
    expect(seasonTypeLabel('NFL', 1)).toBe('Preseason')
    expect(seasonTypeLabel('NBA', 3)).toBe('Playoffs')
    expect(seasonTypeLabel('NHL', 3)).toBe('Playoffs')
  })

  it('Summer League for 4; regular season and unknown get no label', () => {
    expect(seasonTypeLabel('NBA', 4)).toBe('Summer League')
    expect(seasonTypeLabel('NBA', 2)).toBeUndefined()
    expect(seasonTypeLabel('NBA', null)).toBeUndefined()
    expect(seasonTypeLabel('NBA', 9)).toBeUndefined()
  })
})
