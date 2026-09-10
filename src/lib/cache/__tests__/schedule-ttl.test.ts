import { TTL, scheduleTtlFor } from '@/lib/cache/ttl'

const H = 60 * 60 * 1000

function ev(dateMs: number, state?: string, completed = false) {
  return {
    date: new Date(dateMs).toISOString(),
    competitions: [{ status: { type: { state, completed } } }],
  }
}

describe('scheduleTtlFor', () => {
  it('fast when a game is live', () => {
    const now = Date.now()
    const events = [ev(now - H, 'in'), ev(now + 7 * 24 * H, 'pre')]
    expect(scheduleTtlFor(events)).toBe(TTL.SCHEDULE_FAST)
  })
  it('fast when a cached-pre game started recently (stale feed case)', () => {
    // The exact bug: feed cached pre-kickoff still says `pre` after kickoff.
    const now = Date.now()
    expect(scheduleTtlFor([ev(now - H, 'pre')])).toBe(TTL.SCHEDULE_FAST)
  })
  it('fast when kickoff is imminent', () => {
    const now = Date.now()
    expect(scheduleTtlFor([ev(now + 2 * H, 'pre')])).toBe(TTL.SCHEDULE_FAST)
  })
  it('slow for a quiet week (next game days out, last game done)', () => {
    const now = Date.now()
    const events = [ev(now + 4 * 24 * H, 'pre'), ev(now - 3 * 24 * H, 'post', true)]
    expect(scheduleTtlFor(events)).toBe(TTL.SCHEDULE)
  })
  it('slow on garbage input', () => {
    expect(scheduleTtlFor(null)).toBe(TTL.SCHEDULE)
    expect(scheduleTtlFor([])).toBe(TTL.SCHEDULE)
    expect(scheduleTtlFor([{ nope: true }])).toBe(TTL.SCHEDULE)
  })
})
