import { gradeGame, closingLineMap, scorePicks } from '@/lib/propGrades'

function game() {
  return {
    eventDate: '20260909',
    team: 'NE',
    opponent: 'NYJ',
    pre: {
      recordedAt: '2026-09-09T00:00:00+00:00',
      rows: [
        { player: 'Drake Maye', stat: 'passing_yards', projection: 240, line: 232.5, pick: 'over' },
        { player: 'Drake Maye', stat: 'tds', projection: 1.4, line: null, pick: null },
      ],
    },
    lines: [
      {
        recordedAt: '2026-09-09T10:00:00+00:00',
        source: 'hourly-refresh',
        lines: [{ player: 'Drake Maye', stat: 'passing_yards', line: 232.5, book: 'DraftKings' }],
      },
      {
        recordedAt: '2026-09-09T16:00:00+00:00',
        source: 'hourly-refresh',
        // Line moved late: the frozen snapshot below must win for grading.
        lines: [{ player: 'Drake Maye', stat: 'passing_yards', line: 235.5, book: 'DraftKings' }],
      },
    ],
    finalLines: {
      recordedAt: '2026-09-09T16:00:00+00:00',
      source: 'hourly-refresh',
      frozen: true,
      lines: [{ player: 'Drake Maye', stat: 'passing_yards', line: 235.5, book: 'DraftKings' }],
    },
    live: [
      { quarters: 4, state: 'post', final: true, rows: { 'Drake Maye': { passing_yards: 250, tds: 2 } } },
    ],
  }
}

describe('closingLineMap', () => {
  it('prefers the frozen closing snapshot over earlier ones', () => {
    const map = closingLineMap(game())
    expect(map.get('Drake Maye|passing_yards')).toBe(235.5)
  })
  it('falls back to pre rows for games without snapshots', () => {
    const g = game()
    delete (g as any).lines
    delete (g as any).finalLines
    expect(closingLineMap(g).get('Drake Maye|passing_yards')).toBe(232.5)
  })
})

describe('gradeGame', () => {
  it('grades projections vs actuals at the closing line', () => {
    const g = gradeGame(game())
    // passing_yards: proj 240 vs actual 250 -> err 10, pick over 235.5 -> hit.
    // tds: proj 1.4 vs actual 2 -> err 0.6, no line -> graded but unpicked.
    expect(g).not.toBeNull()
    expect(g!.n).toBe(2)
    expect(g!.mae).toBeCloseTo(5.3, 5)
    expect(g!.hits).toBe(1)
    expect(g!.picks).toBe(1)
    expect(g!.hitRate).toBe(1)
  })
  it('returns null without a final', () => {
    const g = game()
    g.live = [{ quarters: 2, state: 'in', rows: { 'Drake Maye': { passing_yards: 120 } } }]
    expect(gradeGame(g)).toBeNull()
  })
  it('counts a push when the actual lands exactly on the line', () => {
    const g = game()
    g.live = [{ quarters: 4, state: 'post', final: true, rows: { 'Drake Maye': { passing_yards: 235.5, tds: 1 } } }]
    const out = gradeGame(g)
    expect(out!.pushes).toBe(1)
    expect(out!.picks).toBe(1)
    expect(out!.hitRate).toBeNull()
  })
})

describe('scorePicks (mid-game scorecard, any sport)', () => {
  const rows = [
    { player: 'Jalen Brunson', stat: 'points', projection: 27.5, line: 26.5, pick: 'over' },
    { player: 'Jalen Brunson', stat: 'assists', projection: 6.2, line: 6.5, pick: 'under' },
    { player: 'Josh Hart', stat: 'rebounds', projection: 8.1, line: null, pick: null },
  ]
  it('scores locked picks against current actuals', () => {
    const s = scorePicks(rows, {
      'Jalen Brunson': { points: 20, assists: 7 },
      'Josh Hart': { rebounds: 9 },
    })
    // Mid-game snapshot: over 26.5 sitting on 20 and under 6.5 sitting on 7
    // both score as misses right now; the final grade re-scores at the whistle.
    expect(s).toEqual({ picks: 2, hits: 0, pushes: 0, graded: 3 })
  })
  it('counts pushes and skips players without actuals', () => {
    const s = scorePicks(rows, { 'Jalen Brunson': { points: 26.5, assists: null } })
    expect(s).toEqual({ picks: 0, hits: 0, pushes: 1, graded: 1 })
  })
  it('returns null with nothing gradeable', () => {
    expect(scorePicks(rows, {})).toBeNull()
  })
})
