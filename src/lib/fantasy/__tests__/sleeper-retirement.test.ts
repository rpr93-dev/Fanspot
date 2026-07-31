import { describe, it, expect } from 'vitest'
import { sleeperToCanonical } from '../sleeper-master'

/**
 * The retirement filter has to separate two players Sleeper describes almost
 * identically: Aaron Rodgers and Ben Roethlisberger are both PIT quarterbacks with
 * 18+ years of experience, age 39+, `active: true` and `status: "Active"`. Only the
 * depth chart tells them apart.
 */
function sleeperPlayer(over: Record<string, unknown>): Record<string, unknown> {
  return {
    full_name: 'Test Player',
    first_name: 'Test',
    last_name: 'Player',
    position: 'QB',
    sport: 'nfl',
    active: true,
    years_exp: 5,
    age: 27,
    team: 'PIT',
    ...over,
  }
}

describe('sleeperToCanonical retirement filter', () => {
  it('keeps a veteran who is still on his team depth chart', () => {
    const rodgers = sleeperToCanonical(
      '96',
      sleeperPlayer({
        full_name: 'Aaron Rodgers',
        first_name: 'Aaron',
        last_name: 'Rodgers',
        team: 'PIT',
        years_exp: 21,
        age: 42,
        depth_chart_order: 1,
      }),
    )
    expect(rodgers).not.toBeNull()
    expect(rodgers?.team).toBe('PIT')
  })

  it('drops a same-team, same-age veteran with no depth chart slot', () => {
    const roethlisberger = sleeperToCanonical(
      '1234',
      sleeperPlayer({
        full_name: 'Ben Roethlisberger',
        first_name: 'Ben',
        last_name: 'Roethlisberger',
        team: 'PIT',
        years_exp: 18,
        age: 39,
        depth_chart_order: null,
      }),
    )
    expect(roethlisberger).toBeNull()
  })

  it('keeps a backup who is on the depth chart below the starter', () => {
    const flacco = sleeperToCanonical(
      '1837',
      sleeperPlayer({
        full_name: 'Joe Flacco',
        first_name: 'Joe',
        last_name: 'Flacco',
        team: 'CIN',
        years_exp: 18,
        age: 41,
        depth_chart_order: 2,
      }),
    )
    expect(flacco).not.toBeNull()
  })

  it('still drops long-retired players who have no team', () => {
    for (const p of [
      { full_name: 'Tom Brady', years_exp: 23, age: 45 },
      { full_name: 'Drew Brees', years_exp: 20, age: 43 },
      { full_name: 'Cam Newton', years_exp: 11, age: 36 },
    ]) {
      const result = sleeperToCanonical(
        '9999',
        sleeperPlayer({ ...p, first_name: 'X', last_name: 'Y', team: '' }),
      )
      expect(result, `${p.full_name} should be filtered out`).toBeNull()
    }
  })

  it('a depth chart slot does not rescue a player with no team', () => {
    const stale = sleeperToCanonical(
      '9998',
      sleeperPlayer({ full_name: 'Stale Vet', team: '', years_exp: 16, age: 40, depth_chart_order: 1 }),
    )
    expect(stale).toBeNull()
  })

  it('drops non-NFL and inactive records regardless of depth chart', () => {
    expect(sleeperToCanonical('1', sleeperPlayer({ sport: 'nba' }))).toBeNull()
    expect(sleeperToCanonical('2', sleeperPlayer({ active: false }))).toBeNull()
  })
})
