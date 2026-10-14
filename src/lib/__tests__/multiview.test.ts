import { describe, it, expect } from 'vitest'
import {
  MAX_MULTIVIEW_SLOTS,
  addMultiviewSlot,
  isRedzoneSlot,
  multiviewGridClass,
  multiviewHref,
  parseMultiviewParam,
  removeMultiviewSlot,
  serializeMultiviewSlots,
  slotKey,
} from '../multiview'

describe('parseMultiviewParam', () => {
  it('parses sport:eventId pairs', () => {
    expect(parseMultiviewParam('nfl:401123,nba:002456')).toEqual([
      { sport: 'nfl', eventId: '401123' },
      { sport: 'nba', eventId: '002456' },
    ])
  })

  it('returns [] for missing/empty values', () => {
    expect(parseMultiviewParam(null)).toEqual([])
    expect(parseMultiviewParam(undefined)).toEqual([])
    expect(parseMultiviewParam('')).toEqual([])
  })

  it('drops invalid sports, bad ids, and duplicates', () => {
    expect(parseMultiviewParam('soccer:1,nfl:!!!,nba:002,nba:002,NFL:401')).toEqual([
      { sport: 'nba', eventId: '002' },
      { sport: 'nfl', eventId: '401' },
    ])
  })

  it('accepts the redzone special slot and caps at the max', () => {
    const slots = parseMultiviewParam('nfl:redzone,nfl:1,nba:2,nhl:3,mlb:4,nfl:5')
    expect(slots).toHaveLength(MAX_MULTIVIEW_SLOTS)
    expect(slots[0]).toEqual({ sport: 'nfl', eventId: 'redzone' })
  })

  it('is case-insensitive', () => {
    expect(parseMultiviewParam('NFL:401')).toEqual([{ sport: 'nfl', eventId: '401' }])
  })
})

describe('serialize + href', () => {
  it('round-trips through the query param', () => {
    const slots = [
      { sport: 'nfl', eventId: 'redzone' },
      { sport: 'nba', eventId: '002' },
    ] as const
    expect(parseMultiviewParam(serializeMultiviewSlots([...slots]))).toEqual([...slots])
  })

  it('builds a shareable href, bare route when empty', () => {
    expect(multiviewHref([{ sport: 'nfl', eventId: '1' }])).toBe('/multiview?games=nfl%3A1')
    expect(multiviewHref([])).toBe('/multiview')
  })

  it('slotKey + isRedzoneSlot', () => {
    expect(slotKey({ sport: 'nfl', eventId: 'redzone' })).toBe('nfl:redzone')
    expect(isRedzoneSlot({ sport: 'nfl', eventId: 'redzone' })).toBe(true)
    expect(isRedzoneSlot({ sport: 'nfl', eventId: '1' })).toBe(false)
    expect(isRedzoneSlot({ sport: 'nba', eventId: 'redzone' })).toBe(false)
  })
})

describe('add/remove slots', () => {
  it('adds, ignores duplicates, and refuses to exceed the max', () => {
    let slots = addMultiviewSlot([], { sport: 'nfl', eventId: '1' })
    expect(slots).toHaveLength(1)
    expect(addMultiviewSlot(slots, { sport: 'nfl', eventId: '1' })).toHaveLength(1)
    for (let i = 2; i <= 9; i++) slots = addMultiviewSlot(slots, { sport: 'nfl', eventId: `${i}` })
    expect(slots).toHaveLength(MAX_MULTIVIEW_SLOTS)
  })

  it('removes by index', () => {
    const slots = [
      { sport: 'nfl', eventId: '1' },
      { sport: 'nba', eventId: '2' },
    ] as const
    expect(removeMultiviewSlot([...slots], 0)).toEqual([{ sport: 'nba', eventId: '2' }])
  })
})

describe('multiviewGridClass', () => {
  it('is single-column for 0-1 tiles, two-up beyond that', () => {
    expect(multiviewGridClass(0)).toContain('grid-cols-1')
    expect(multiviewGridClass(1)).toContain('grid-cols-1')
    expect(multiviewGridClass(2)).toContain('xl:grid-cols-2')
    expect(multiviewGridClass(4)).toContain('xl:grid-cols-2')
  })
})
