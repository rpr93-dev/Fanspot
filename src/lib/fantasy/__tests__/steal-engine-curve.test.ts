import { describe, it, expect } from 'vitest'
import { fitPositionCurve } from '../steal-engine'

/**
 * Build a realistic rank→points array for a position: steep at the top, flat past
 * startable depth. Values model real PPR season totals (RB1 ~ 300, RB24 ~ 150, deep
 * bench clustering near ~90-110).
 */
function realisticRbs(count = 90): number[] {
  const pts: number[] = []
  for (let i = 1; i <= count; i++) {
    const top = Math.max(150, 300 - (i - 1) * 6.5) // steep decline through ~RB24
    const deep = 100 - Math.floor((i - 24) / 5) // flat-ish deep bench
    pts.push(i <= 24 ? top : deep)
  }
  return pts.sort((a, b) => b - a)
}

describe('fitPositionCurve (Bug 4: curve must flatten past startable depth)', () => {
  const rbCurve = fitPositionCurve(realisticRbs(), 24)

  it('keeps the top of the position steep', () => {
    expect(rbCurve(1)).toBeGreaterThan(rbCurve(20))
    expect(rbCurve(1) - rbCurve(10)).toBeGreaterThan(40)
  })

  it('flattens hard past startable depth (RB24)', () => {
    // Deep-bench ranks must produce small point deltas, not the old 50-70 point gaps.
    const delta50to60 = Math.abs(rbCurve(50) - rbCurve(60))
    const delta50to80 = Math.abs(rbCurve(50) - rbCurve(80))
    expect(delta50to60).toBeLessThan(20)
    expect(delta50to80).toBeLessThan(25)
  })

  it('gaps near the top exceed gaps near the bottom', () => {
    const topGap = Math.abs(rbCurve(1) - rbCurve(20))
    const bottomGap = Math.abs(rbCurve(50) - rbCurve(60))
    expect(topGap).toBeGreaterThan(bottomGap * 2)
  })

  it('clamps past the array end to the replacement baseline', () => {
    expect(rbCurve(120)).toBe(rbCurve(90))
  })

  it('returns 0 for an empty position (no real scoring data)', () => {
    const empty = fitPositionCurve([], 24)
    expect(empty(5)).toBe(0)
  })
})
