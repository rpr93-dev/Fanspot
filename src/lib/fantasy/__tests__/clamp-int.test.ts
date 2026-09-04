import { describe, it, expect } from 'vitest'
import { clampInt } from '../clamp-int'

describe('clampInt', () => {
  // F5 regression: Number(null) === 0 and Number('') === 0, so a missing query
  // param used to clamp to the minimum instead of using the documented default.
  it('treats null as "use the fallback default"', () => {
    expect(clampInt(null, 2, 20, 12)).toBe(12)
    expect(clampInt(null, 12, 24, 16)).toBe(16)
  })

  it('treats undefined and empty/whitespace strings as missing', () => {
    expect(clampInt(undefined, 2, 20, 12)).toBe(12)
    expect(clampInt('', 2, 20, 12)).toBe(12)
    expect(clampInt('   ', 2, 20, 12)).toBe(12)
  })

  it('falls back on non-numeric garbage', () => {
    expect(clampInt('abc', 2, 20, 12)).toBe(12)
    expect(clampInt('12x', 2, 20, 12)).toBe(12)
  })

  it('parses and clamps provided values into range', () => {
    expect(clampInt('10', 2, 20, 12)).toBe(10)
    expect(clampInt('0', 2, 20, 12)).toBe(2)
    expect(clampInt('99', 2, 20, 12)).toBe(20)
    expect(clampInt('7.6', 2, 20, 12)).toBe(8)
  })
})
