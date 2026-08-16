import { describe, expect, it } from 'vitest'
import {
  createAuctionDraft,
  nominate,
  placeBid,
  pass,
  simulate,
  auctionCoach,
  auctionValue,
  auctionDraftGrade,
  computeAuctionPricing,
  DEFAULT_AUCTION_DRAFT_SETTINGS,
} from '../auction-draft-engine'
import type { AuctionDraftState, AuctionDraftSettings } from '../auction-draft-engine'
import type { DraftPoolPlayer, MockPosition } from '../mock-draft'
import { DEFAULT_STARTERS } from '../mock-draft'

const POSITIONS: MockPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']

let seq = 0
function mkPlayer(pos: MockPosition, proj: number, over: Partial<DraftPoolPlayer> = {}): DraftPoolPlayer {
  seq += 1
  return {
    playerId: seq,
    name: `P${seq} ${pos}`,
    pos,
    team: 'TST',
    projection: proj,
    adp: 50 + seq,
    adpSource: 'espn',
    injuryTier: 'healthy',
    injuryStatus: '',
    posRank: 1,
    adpRank: 1,
    gap: 0,
    posPoolSize: 0,
    ...over,
  }
}

/** A league-sized pool: 40 QB / 60 RB / 80 WR / 40 TE / 20 K / 20 D/ST. */
function makePool(): DraftPoolPlayer[] {
  const counts: Record<MockPosition, number> = { QB: 40, RB: 60, WR: 80, TE: 40, K: 20, 'D/ST': 20 }
  const pool: DraftPoolPlayer[] = []
  for (const pos of POSITIONS) {
    for (let i = 0; i < counts[pos]; i++) {
      pool.push(mkPlayer(pos, 320 - i * 3))
    }
  }
  return pool
}

function settings(over: Partial<AuctionDraftSettings> = {}): AuctionDraftSettings {
  return { ...DEFAULT_AUCTION_DRAFT_SETTINGS, ...over }
}

const TEAMS_12 = settings({ teams: 12, rosterSize: 16, budget: 200, userTeam: 0 })

describe('createAuctionDraft', () => {
  it('allocates budgets, seeds the user team, and opens on the user nomination', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 42)
    expect(s.teams).toHaveLength(12)
    expect(s.teams[0].isUser).toBe(true)
    for (const t of s.teams) {
      expect(t.budget).toBe(200)
      expect(t.picks).toHaveLength(0)
    }
    expect(s.phase).toBe('nominating')
    expect(s.nominateManager).toBe(0)
    expect(s.completed).toBe(false)
  })

  it('filters out unavailable players (severe injury / suspension)', () => {
    const pool = makePool()
    pool.push(mkPlayer('WR', 250, { injuryTier: 'severe', injuryStatus: 'IR' }))
    pool.push(mkPlayer('RB', 250, { suspended: true }))
    const s = createAuctionDraft(pool, TEAMS_12, 1)
    expect(s.pool.some((p) => p.injuryTier === 'severe')).toBe(false)
    expect(s.pool.some((p) => p.suspended)).toBe(false)
  })
})

describe('auctionValue & pricing', () => {
  it('prices the best players above replacement and floors everyone at $1', () => {
    const pool = makePool()
    const pricing = computeAuctionPricing(pool, TEAMS_12)
    const best = pool.filter((p) => p.pos === 'WR').sort((a, b) => b.projection - a.projection)[0]!
    const worst = pool.filter((p) => p.pos === 'D/ST').sort((a, b) => a.projection - b.projection)[0]!
    expect(auctionValue(best, pricing)).toBeGreaterThan(auctionValue(worst, pricing))
    expect(auctionValue(worst, pricing)).toBeGreaterThanOrEqual(1)
  })
})

describe('nominate', () => {
  it('puts the player on the block at $1 with the nominator as high bidder', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 7)
    const p = s.pool[0]!
    const next = nominate(s, p)
    expect(next.phase).toBe('bidding')
    expect(next.nominatingPlayer?.playerId).toBe(p.playerId)
    expect(next.currentBid).toBe(1)
    expect(next.currentBidder).toBe(0)
    // Bid turns start with the team after the nominator; the nominator is last.
    expect(next.activeBidders[0]).not.toBe(0)
    expect(next.activeBidders[next.activeBidders.length - 1]).toBe(0)
  })

  it('rejects an already-sold player', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 7)
    const p = s.pool[0]!
    const nominated = nominate(s, p)
    const again = nominate(nominated, p)
    expect(again).toBe(nominated)
  })

  it('keeps the nominator in the bidding even when they cannot afford to outbid by $1', () => {
    const budget = 17 // 16 slots -> reserve keeps 15; nominator can afford the $1 open but not $2
    const s = createAuctionDraft(makePool(), settings({ teams: 12, rosterSize: 16, budget, userTeam: 0 }), 3)
    const p = s.pool[0]!
    const next = nominate(s, p)
    expect(next.phase).toBe('bidding')
    expect(next.activeBidders).toContain(0)
  })
})

describe('placeBid & pass', () => {
  it('only lets the bidder whose turn it is raise the price', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 9)
    const next = nominate(s, s.pool[0]!)
    const bidder = next.activeBidders[0]!
    const raised = placeBid(next, bidder, 5)
    expect(raised.currentBid).toBe(5)
    expect(raised.currentBidder).toBe(bidder)
    // Not your turn: no change.
    const other = next.activeBidders[1] ?? 1
    const wrong = placeBid(next, other, 10)
    expect(wrong).toBe(next)
  })

  it('rejects bids at or below the current price and bids beyond the budget', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 11)
    const next = nominate(s, s.pool[0]!)
    const bidder = next.activeBidders[0]!
    expect(placeBid(next, bidder, 1)).toBe(next) // must exceed $1
    expect(placeBid(next, bidder, 999)).toBe(next) // unaffordable
  })

  it('the high bidder cannot pass; when everyone else passes they win', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 13)
    const next = nominate(s, s.pool[0]!)
    // Everyone except the nominator passes in turn.
    let cur = next
    const nominator = 0
    for (let i = 0; i < 30 && cur.phase === 'bidding'; i++) {
      const actor = cur.activeBidders[cur.bidCursor]
      if (actor == null || actor === nominator) break
      cur = pass(cur, actor)
    }
    expect(cur.phase).toBe('nominating') // closed
    expect(cur.pickLog).toHaveLength(1)
    expect(cur.pickLog[0]!.manager).toBe(0) // nominator won at $1
    expect(cur.pickLog[0]!.price).toBe(1)
    expect(cur.teams[0].spent).toBe(1)
  })
})

describe('simulate', () => {
  it('a full auto-draft fills every roster, never duplicates, and never overspends', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 1234)
    const done = simulate(s, { untilUser: false })
    expect(done.completed).toBe(true)
    for (const t of done.teams) {
      expect(t.picks.length).toBe(16)
      expect(t.budget).toBeGreaterThanOrEqual(0)
      for (const p of t.picks) {
        expect(p.price).toBeGreaterThanOrEqual(1)
      }
    }
    const ids = done.pickLog.map((p) => p.playerId)
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    // Every team has at least the required starters.
    const starters = DEFAULT_STARTERS
    for (const t of done.teams) {
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as MockPosition[]) {
        if (starters[pos] > 0) expect((t.byPos[pos] ?? 0)).toBeGreaterThanOrEqual(starters[pos])
      }
    }
  })

  it('prices land within the league money supply', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 99)
    const done = simulate(s, { untilUser: false })
    const totalSpent = done.teams.reduce((sum, t) => sum + t.spent, 0)
    expect(totalSpent).toBeLessThanOrEqual(12 * 200)
    expect(done.pickLog.every((p) => p.price <= 200)).toBe(true)
  })

  it('stops at the human turn when asked', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 5)
    // User nominates first, so simulate stops immediately on the user decision.
    const stopped = simulate(s, { untilUser: true })
    expect(stopped).toBe(s)
    // After the user nominates, bots resolve until the user's next decision.
    const nominated = nominate(s, s.pool[0]!)
    const next = simulate(nominated, { untilUser: true })
    const actor = next.phase === 'nominating' ? next.nominateManager : next.activeBidders[next.bidCursor]
    expect(next.teams[actor]?.isUser).toBe(true)
  })
})

describe('auctionCoach', () => {
  it('only suggests affordable, roster-fitting players on the user nomination turn', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 21
)
    const coach = auctionCoach(s, 6)
    expect(coach.length).toBeGreaterThan(0)
    expect(coach.length).toBeLessThanOrEqual(6)
    const team = s.teams[0]
    for (const p of coach) {
      expect((team.byPos[p.pos] ?? 0)).toBeLessThan(16) // fits
      expect(team.budget).toBeGreaterThanOrEqual(1)
    }
    // Not on the user's turn: empty.
    const botTurn = { ...s, nominateManager: 3 }
    expect(auctionCoach(botTurn, 6)).toHaveLength(0)
  })
})

describe('auctionDraftGrade', () => {
  it('produces a grade with money efficiency for a completed draft', () => {
    const s = createAuctionDraft(makePool(), TEAMS_12, 77)
    const done = simulate(s, { untilUser: false })
    const grade = auctionDraftGrade(done)
    expect(grade.total).toBeGreaterThan(0)
    expect(grade.leagueAvg).toBeGreaterThan(0)
    expect(grade.rank).toBeGreaterThanOrEqual(1)
    expect(grade.rank).toBeLessThanOrEqual(12)
    expect(['A', 'B', 'C', 'D']).toContain(grade.grade)
    expect(grade.spent).toBe(done.teams[0].spent)
  })
})
