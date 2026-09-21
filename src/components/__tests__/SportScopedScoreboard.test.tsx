import { describe, it, expect } from 'vitest'
import { shouldShowScoreboard } from '../SportScopedScoreboard'

describe('shouldShowScoreboard', () => {
  it('hides the strip on the homepage', () => {
    expect(shouldShowScoreboard('/')).toBe(false)
    expect(shouldShowScoreboard(null)).toBe(false)
  })

  it('hides the strip everywhere inside the league sections', () => {
    expect(shouldShowScoreboard('/nfl')).toBe(false)
    expect(shouldShowScoreboard('/nba/lal')).toBe(false)
    expect(shouldShowScoreboard('/nhl/game/123')).toBe(false)
    expect(shouldShowScoreboard('/MLB/bos')).toBe(false)
    expect(shouldShowScoreboard('/nfl/player/123')).toBe(false)
  })

  it('keeps the strip on cross-league pages', () => {
    expect(shouldShowScoreboard('/scores')).toBe(true)
    expect(shouldShowScoreboard('/news')).toBe(true)
    expect(shouldShowScoreboard('/search')).toBe(true)
    expect(shouldShowScoreboard('/favorites')).toBe(true)
    expect(shouldShowScoreboard('/fantasy/nfl')).toBe(true)
  })
})
