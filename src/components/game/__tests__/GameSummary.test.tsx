import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LiveGameSummary,
  selectBigPlays,
  selectConciseStats,
  selectGameStories,
  selectRecentPlays,
  storyMentionsTeam,
} from '../GameSummary'
import { sportForPathname } from '@/components/SportScopedScoreboard'
import type { NormalizedPlay } from '@/lib/plays'
import type { FeedStory } from '@/components/NewsFeed'

function play(over: Partial<NormalizedPlay> & { id: string; text: string }): NormalizedPlay {
  return {
    period: 1,
    periodLabel: 'Q1',
    clock: '10:00',
    teamAbbr: 'KC',
    scoring: false,
    highlight: false,
    detail: null,
    ...over,
  }
}

describe('selectBigPlays', () => {
  const plays = [
    play({ id: '1', text: '1st & 10 run for 2 yards' }),
    play({ id: '2', text: 'Patrick Mahomes pass complete for 12 yards' }),
    play({ id: '3', text: 'TOUCHDOWN Chiefs!', scoring: true }),
    play({ id: '4', text: 'Punt, fair catch' }),
    play({ id: '5', text: 'INTERCEPTED by the defense', highlight: true }),
  ]

  it('keeps only scoring/highlight plays, oldest first', () => {
    expect(selectBigPlays(plays).map((p) => p.id)).toEqual(['3', '5'])
  })

  it('caps at the limit from the newest end', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      play({ id: `s${i}`, text: `Touchdown ${i}`, scoring: true }),
    )
    expect(selectBigPlays(many, 6).map((p) => p.id)).toEqual([
      's4',
      's5',
      's6',
      's7',
      's8',
      's9',
    ])
  })

  it('returns [] for null/empty', () => {
    expect(selectBigPlays(null)).toEqual([])
    expect(selectBigPlays([])).toEqual([])
  })
})

describe('selectRecentPlays', () => {
  const plays = ['1', '2', '3', '4', '5', '6', '7'].map((id) =>
    play({ id, text: `Play ${id}` }),
  )

  it('returns the newest plays, chronological (PlayByPlay reverses them)', () => {
    expect(selectRecentPlays(plays, 3).map((p) => p.id)).toEqual(['5', '6', '7'])
  })

  it('keeps the latest big moment in the window when the tail is quiet', () => {
    const withBig = [
      play({ id: 'b1', text: 'TOUCHDOWN Chiefs!', scoring: true }),
      ...['2', '3', '4', '5'].map((id) => play({ id, text: `Play ${id}` })),
    ]
    // Newest plays kept, the big play takes the oldest slot, newest last.
    const out = selectRecentPlays(withBig, 3)
    expect(out.map((p) => p.id)).toEqual(['4', '5', 'b1'])
  })

  it('leaves a window that already contains a big play untouched', () => {
    const withBig = [
      ...['1', '2'].map((id) => play({ id, text: `Play ${id}` })),
      play({ id: 'b', text: 'INTERCEPTED', highlight: true }),
    ]
    expect(selectRecentPlays(withBig, 3).map((p) => p.id)).toEqual(['1', '2', 'b'])
  })

  it('returns [] for null/empty or a zero limit', () => {
    expect(selectRecentPlays(null)).toEqual([])
    expect(selectRecentPlays([])).toEqual([])
    expect(selectRecentPlays(plays, 0)).toEqual([])
  })
})

describe('selectConciseStats', () => {
  const away = [
    { name: 'totalYards', displayValue: '260' },
    { name: 'firstDowns', displayValue: '16' },
    { name: 'turnovers', displayValue: '0' },
    { name: 'rushingYards', displayValue: '101' },
    { name: 'netPassingYards', displayValue: '159' },
    { name: 'thirdDownEff', displayValue: '7-14' },
    { name: 'possessionTime', displayValue: '24:48' },
    { name: 'sacks', displayValue: '2-15' },
  ]
  const home = [
    { name: 'totalYards', displayValue: '358' },
    { name: 'firstDowns', displayValue: '23' },
    { name: 'turnovers', displayValue: '1' },
    { name: 'rushingYards', displayValue: '69' },
    { name: 'netPassingYards', displayValue: '289' },
    { name: 'thirdDownEff', displayValue: '6-15' },
    { name: 'possessionTime', displayValue: '35:12' },
    { name: 'sacks', displayValue: '1-8' },
  ]

  it('returns the leading rows, capped', () => {
    const rows = selectConciseStats(away, home)
    expect(rows).toHaveLength(6)
    // Football priority leads with total yards, not alphabetical order.
    expect(rows[0].awayValue).toBe('260')
    expect(rows[0].homeValue).toBe('358')
  })

  it('drops rows with no values on either side', () => {
    const rows = selectConciseStats(
      [{ name: 'totalYards', displayValue: '260' }],
      [{ name: 'other', displayValue: '' }],
    )
    expect(rows.every((r) => (r.awayValue ?? '') !== '' || (r.homeValue ?? '') !== '')).toBe(true)
  })
})

describe('storyMentionsTeam', () => {
  const chiefs = { abbr: 'KC', name: 'Kansas City Chiefs' }

  it('matches full name, nickname, and abbreviation', () => {
    expect(
      storyMentionsTeam({ title: 'Kansas City Chiefs win in overtime', snippet: '' }, chiefs),
    ).toBe(true)
    expect(storyMentionsTeam({ title: 'Chiefs defense stands tall', snippet: '' }, chiefs)).toBe(
      true,
    )
    expect(storyMentionsTeam({ title: 'KC hosts Buffalo on Sunday', snippet: '' }, chiefs)).toBe(
      true,
    )
  })

  it('rejects unrelated stories', () => {
    expect(
      storyMentionsTeam({ title: 'Lakers trade for veteran guard', snippet: 'Los Angeles' }, chiefs),
    ).toBe(false)
    expect(storyMentionsTeam({ title: '', snippet: '' }, chiefs)).toBe(false)
  })
})

describe('selectGameStories', () => {
  const mk = (title: string): FeedStory => ({
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    source: 'ESPN',
    league: 'nfl',
    publishedAt: null,
    snippet: '',
    significance: 50,
    drivers: [],
    teamIds: [],
  })
  const teams = [
    { abbr: 'KC', name: 'Kansas City Chiefs' },
    { abbr: 'BUF', name: 'Buffalo Bills' },
  ]

  it('keeps only stories about either side, capped', () => {
    const stories = [
      mk('Chiefs defense stands tall'),
      mk('Lakers trade for veteran guard'),
      mk('Bills Mafia packs the stadium'),
      mk('BUF signs new cornerback'),
      mk('Cowboys hire new coordinator'),
      mk('Chiefs Kingdom celebrates'),
    ]
    const out = selectGameStories(stories, teams, 3)
    expect(out.map((s) => s.title)).toEqual([
      'Chiefs defense stands tall',
      'Bills Mafia packs the stadium',
      'BUF signs new cornerback',
    ])
  })
})

describe('sportForPathname', () => {
  it('scopes league, team, and game routes', () => {
    expect(sportForPathname('/nfl')).toBe('NFL')
    expect(sportForPathname('/nba/lal')).toBe('NBA')
    expect(sportForPathname('/nhl/game/123')).toBe('NHL')
    expect(sportForPathname('/MLB/bos')).toBe('MLB')
    expect(sportForPathname('/fantasy/nfl')).toBe('NFL')
  })

  it('leaves cross-league routes alone', () => {
    expect(sportForPathname('/')).toBeNull()
    expect(sportForPathname('/scores')).toBeNull()
    expect(sportForPathname('/news')).toBeNull()
    expect(sportForPathname('/fantasy')).toBeNull()
    expect(sportForPathname(null)).toBeNull()
  })
})

describe('LiveGameSummary', () => {
  it('renders big plays and concise stats', () => {
    const html = renderToStaticMarkup(
      <LiveGameSummary
        sport="NFL"
        away={{ abbr: 'KC', name: 'Kansas City Chiefs' }}
        home={{ abbr: 'BUF', name: 'Buffalo Bills' }}
        boxScore={{
          teams: [
            {
              abbreviation: 'KC',
              homeAway: 'away',
              score: { displayValue: '24' },
              statistics: [{ name: 'totalYards', displayValue: '300' }],
            },
            {
              abbreviation: 'BUF',
              homeAway: 'home',
              score: { displayValue: '21' },
              statistics: [{ name: 'totalYards', displayValue: '280' }],
            },
          ],
        }}
        plays={[play({ id: '1', text: 'TOUCHDOWN Chiefs!', scoring: true })]}
        playsChecked
        playsError={null}
        onRetryPlays={() => {}}
        lastPlayBlock={null}
        onViewTeamStats={() => {}}
      />,
    )
    expect(html).toContain('Recent Plays')
    expect(html).toContain('TOUCHDOWN Chiefs!')
    expect(html).toContain('Team Stats')
    expect(html).toContain('300')
    // No player stats in this payload → the leaders block stays out entirely.
    expect(html).not.toContain('Game Leaders')
  })

  it('renders game leaders from the box score player stats', () => {
    const html = renderToStaticMarkup(
      <LiveGameSummary
        sport="NFL"
        away={{ abbr: 'KC', name: 'Kansas City Chiefs' }}
        home={{ abbr: 'BUF', name: 'Buffalo Bills' }}
        boxScore={{
          teams: [
            { abbreviation: 'KC', homeAway: 'away', score: { displayValue: '24' }, statistics: [] },
            { abbreviation: 'BUF', homeAway: 'home', score: { displayValue: '21' }, statistics: [] },
          ],
          playerStats: [
            {
              teamAbbr: 'KC',
              categories: [
                {
                  label: 'Passing',
                  statNames: ['YDS'],
                  athletes: [
                    { id: '3139477', displayName: 'Patrick Mahomes', position: 'QB', stats: { YDS: '305' } },
                  ],
                },
              ],
            },
            { teamAbbr: 'BUF', categories: [] },
          ],
        }}
        plays={[]}
        playsChecked
        playsError={null}
        onRetryPlays={() => {}}
        lastPlayBlock={null}
        onViewTeamStats={() => {}}
      />,
    )
    expect(html).toContain('Game Leaders')
    expect(html).toContain('Patrick Mahomes')
    expect(html).toContain('Pass Yds')
    expect(html).toContain('305')
    expect(html).toContain('/nfl/player/3139477')
    // The other team has no stats → no zero rows are fabricated.
    expect(html).toContain('No player stats yet.')
  })

  it('shows a gentle note when the game has no data yet', () => {
    const html = renderToStaticMarkup(
      <LiveGameSummary
        sport="NFL"
        away={{ abbr: 'KC', name: 'Kansas City Chiefs' }}
        home={{ abbr: 'BUF', name: 'Buffalo Bills' }}
        boxScore={null}
        plays={[]}
        playsChecked
        playsError={null}
        onRetryPlays={() => {}}
        lastPlayBlock={null}
        onViewTeamStats={() => {}}
      />,
    )
    expect(html).toContain('Team stats fill in as the game progresses.')
  })
})
