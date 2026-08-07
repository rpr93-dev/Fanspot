import { describe, it, expect } from 'vitest'
import { scoreSchemeHeadlines, clampSchemeDelta, relevantToTeam } from '../scheme-news'

describe('scoreSchemeHeadlines', () => {
  it('scores a new offensive coordinator hire as positive', () => {
    const score = scoreSchemeHeadlines(['Steelers hire new offensive coordinator, plan to open up the passing game'])
    expect(score).toBeGreaterThanOrEqual(10)
  })

  it('scores a run-first commitment as negative', () => {
    const score = scoreSchemeHeadlines(['New staff will stay run-first behind a conservative offense'])
    expect(score).toBeLessThanOrEqual(-10)
  })

  it('returns zero for neutral headlines', () => {
    expect(scoreSchemeHeadlines(['Team begins training camp with new faces at practice'])).toBe(0)
    expect(scoreSchemeHeadlines([])).toBe(0)
  })

  it('counts both directions against each other', () => {
    const score = scoreSchemeHeadlines([
      'Team hires pass-heavy coordinator',
      'but remains run-first per new coach',
    ])
    expect(score).toBe(0)
  })
})

describe('clampSchemeDelta', () => {
  it('clamps to the ±20 band', () => {
    expect(clampSchemeDelta(50)).toBe(20)
    expect(clampSchemeDelta(-50)).toBe(-20)
    expect(clampSchemeDelta(10)).toBe(10)
  })
})

describe('relevantToTeam', () => {
  it('accepts headlines naming the team or the league', () => {
    expect(relevantToTeam('Seahawks hire new offensive coordinator', 'Seattle Seahawks')).toBe(true)
    expect(relevantToTeam('NFL coordinator carousel continues', 'Seattle Seahawks')).toBe(true)
  })

  it('rejects college-program noise that shares the coordinator vocabulary', () => {
    expect(relevantToTeam('Joe Sloan hired as Kentucky Football offensive coordinator', 'Seattle Seahawks')).toBe(false)
    expect(relevantToTeam('Northwestern thinks Chip Kelly can be a top OC', 'Tennessee Titans')).toBe(false)
  })
})
