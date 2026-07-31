import { describe, it, expect } from 'vitest'
import { scoreStory, rankStories, dedupeKey, type RawStory } from '../story-ranking'

const HOURS = 3_600_000

function story(over: Partial<RawStory> & { title: string }): RawStory {
  return {
    url: `https://example.com/${encodeURIComponent(over.title)}`,
    source: 'Web',
    snippet: '',
    publishedAt: new Date(Date.now() - 2 * HOURS).toISOString(),
    league: 'nfl',
    ...over,
  }
}

describe('scoreStory', () => {
  it('scores a star trade above a bottom-roster move', () => {
    const star = scoreStory(story({ title: 'Micah Parsons traded to the Packers', source: 'ESPN' }))
    const minor = scoreStory(story({ title: 'Packers waive practice squad tackle', source: 'ESPN' }))
    expect(star.significance).toBeGreaterThan(minor.significance)
  })

  it('names the signals that drove the score', () => {
    const { drivers } = scoreStory(story({ title: 'Josh Allen signs record extension', source: 'ESPN' }))
    expect(drivers).toContain('signing')
    expect(drivers).toContain('Josh Allen')
    expect(drivers).toContain('ESPN')
  })

  it('takes only the strongest event, not the sum of every keyword', () => {
    const one = scoreStory(story({ title: 'Bears trade for a cornerback' }))
    const many = scoreStory(story({ title: 'Bears trade for a cornerback, sign a guard and waive a tackle' }))
    expect(many.significance).toBeLessThanOrEqual(one.significance + 8)
  })

  it('discounts speculation', () => {
    const real = scoreStory(story({ title: 'Jets trade Sauce Gardner to the Colts' }))
    const rumour = scoreStory(story({ title: 'Proposed trade sends Sauce Gardner to the Colts' }))
    expect(rumour.significance).toBeLessThan(real.significance)
    expect(rumour.drivers).toContain('speculative')
  })

  it('does not discount a confirmed move that also reads as a rumour', () => {
    const s = scoreStory(story({ title: 'Bears officially trade for a cornerback, ending weeks of rumours' }))
    expect(s.drivers).not.toContain('speculative')
  })

  it('only credits a star named in the headline, not one buried in the summary', () => {
    const inTitle = scoreStory(story({ title: 'Patrick Mahomes signs an extension' }))
    const inSnippet = scoreStory(
      story({ title: 'Chiefs sign a long snapper', snippet: 'Patrick Mahomes was not involved.' }),
    )
    expect(inTitle.significance).toBeGreaterThan(inSnippet.significance)
  })

  it('treats recency as a tiebreaker, not a ranking axis', () => {
    const oldBigNews = scoreStory(
      story({
        title: 'Justin Jefferson traded to the Ravens',
        publishedAt: new Date(Date.now() - 6 * 24 * HOURS).toISOString(),
      }),
    )
    const freshMinorNews = scoreStory(
      story({ title: 'Ravens waive a reserve lineman', publishedAt: new Date().toISOString() }),
    )
    expect(oldBigNews.significance).toBeGreaterThan(freshMinorNews.significance)
  })

  it('scores stars in every league, not just the NFL', () => {
    for (const [league, title] of [
      ['nba', 'Nikola Jokic signs a supermax extension'],
      ['nhl', 'Connor McDavid signs an extension'],
      ['mlb', 'Shohei Ohtani signs a record deal'],
    ] as const) {
      const { drivers } = scoreStory(story({ title, league }))
      expect(drivers.length, title).toBeGreaterThan(1)
    }
  })
})

describe('dedupeKey', () => {
  it('collapses syndicated variants of the same headline', () => {
    expect(dedupeKey('Micah Parsons Traded to the Packers!')).toBe(
      dedupeKey('micah parsons traded to the packers'),
    )
  })

  it('keeps genuinely different headlines apart', () => {
    expect(dedupeKey('Micah Parsons traded to the Packers')).not.toBe(
      dedupeKey('Justin Jefferson traded to the Ravens'),
    )
  })
})

describe('rankStories', () => {
  it('orders by significance and honours the limit', () => {
    const ranked = rankStories(
      [
        story({ title: 'Vikings waive a reserve safety' }),
        story({ title: 'Justin Jefferson traded to the Ravens', source: 'ESPN' }),
        story({ title: 'Vikings hire a special teams assistant' }),
      ],
      2,
    )
    expect(ranked).toHaveLength(2)
    expect(ranked[0].title).toContain('Justin Jefferson')
    expect(ranked[0].significance).toBeGreaterThanOrEqual(ranked[1].significance)
  })

  it('drops duplicates across leagues and empty titles', () => {
    const ranked = rankStories(
      [
        story({ title: 'Star player traded to a contender' }),
        story({ title: 'Star Player Traded To A Contender' }),
        story({ title: '' }),
      ],
      10,
    )
    expect(ranked).toHaveLength(1)
  })
})
