import { describe, it, expect } from 'vitest'
import { buildOutlook } from '../steal-engine'

const base = {
  confidence: 50,
  adpDiscount: 10,
  leagueWinnerPct: 50,
  injured: false,
  missedSeason: false,
}

describe('buildOutlook', () => {
  it('names the season the player actually missed', () => {
    const out = buildOutlook({ ...base, missedSeason: true, missedSeasonYear: 2025 })
    expect(out).toContain('2025')
    expect(out).not.toContain('2024')
  })

  it('stays vague rather than inventing a year when the pipeline reports none', () => {
    const out = buildOutlook({ ...base, missedSeason: true })
    expect(out).toContain('the most recent season')
    expect(out).not.toMatch(/\b20\d\d\b/)
  })

  it('leads with a missed season over an injury flag', () => {
    expect(buildOutlook({ ...base, missedSeason: true, injured: true, missedSeasonYear: 2025 })).toContain(
      'Missed',
    )
  })

  it('flags a currently injured player', () => {
    expect(buildOutlook({ ...base, injured: true })).toContain('Currently injured')
  })

  it('reserves the league-winner line for high confidence and high upside', () => {
    expect(buildOutlook({ ...base, confidence: 75, leagueWinnerPct: 85 })).toContain('league-winning')
    expect(buildOutlook({ ...base, confidence: 75, leagueWinnerPct: 50 })).not.toContain('league-winning')
  })

  it('falls back to a neutral line when nothing stands out', () => {
    expect(buildOutlook(base)).toContain('Solid value at current ADP')
  })
})
