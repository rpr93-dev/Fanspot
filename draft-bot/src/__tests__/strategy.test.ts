import { describe, expect, it } from 'vitest'
import { bidIncrement, decideBid, suggestNominations, type BidContext } from '../engine/strategy'
import { DEFAULT_STARTERS } from '@/lib/fantasy/auction-engine'

function ctx(over: Partial<BidContext> = {}): BidContext {
  return {
    value: 20,
    currentBid: 5,
    remainingBudget: 200,
    remainingSlots: 10,
    positionFilled: false,
    unavailable: false,
    autoBidCap: 15,
    maxShareOfBudget: 0.4,
    ...over,
  }
}

describe('bidIncrement', () => {
  it('scales increments with the current price', () => {
    expect(bidIncrement(3)).toBe(1)
    expect(bidIncrement(15)).toBe(2)
    expect(bidIncrement(40)).toBe(5)
    expect(bidIncrement(80)).toBe(10)
  })
})

describe('decideBid', () => {
  it('passes when the position is full', () => {
    const d = decideBid(ctx({ positionFilled: true }))
    expect(d.action).toBe('pass')
  })

  it('prompts on unavailable (injured/suspended) players instead of silently passing', () => {
    const d = decideBid(ctx({ unavailable: true }))
    if (d.action !== 'prompt') throw new Error('expected prompt')
    expect(d.amount).toBe(20)
    expect(d.note).toContain('injury watch')
  })

  it('passes on unavailable players who are already out of range', () => {
    const d = decideBid(ctx({ unavailable: true, value: 10, currentBid: 12 }))
    expect(d.action).toBe('pass')
  })

  it('passes when the player is already past my range', () => {
    const d = decideBid(ctx({ value: 10, currentBid: 12 }))
    expect(d.action).toBe('pass')
  })

  it('auto-bids cheap raises with clean increments', () => {
    // Bid is $13, increment is $2, so $15 lands exactly on the cap.
    expect(decideBid(ctx({ value: 30, currentBid: 13 }))).toEqual({
      action: 'auto-bid',
      amount: 15,
      note: 'value $30',
    })

    const d2 = decideBid(ctx({ value: 5, currentBid: 3 }))
    if (d2.action !== 'auto-bid') throw new Error('expected auto-bid')
    expect(d2.amount).toBe(4)
  })

  it('prompts when the next bid would cross the auto cap', () => {
    const d = decideBid(ctx({ value: 30, currentBid: 15 }))
    if (d.action !== 'prompt') throw new Error('expected prompt')
    expect(d.amount).toBe(30)
  })

  it('respects the budget share cap', () => {
    // Budget $100 -> share cap $40; bid at $15 means the $2 increment crosses the cap.
    const d = decideBid(ctx({ value: 200, remainingBudget: 100, currentBid: 15 }))
    if (d.action !== 'prompt') throw new Error('expected prompt')
    expect(d.amount).toBe(40) // 40% of $100
  })

  it('keeps the $1-per-slot reserve', () => {
    const d = decideBid(ctx({ value: 200, remainingBudget: 5, remainingSlots: 5, currentBid: 1 }))
    expect(d.action).toBe('pass') // maxBid = min(200, 2, 1) = 1 <= currentBid
  })

  it('never auto-bids above the cap even when value is huge', () => {
    const d = decideBid(ctx({ value: 100, currentBid: 40 }))
    if (d.action !== 'prompt') throw new Error('expected prompt')
    expect(d.amount).toBe(80) // share cap, not value
  })
})

describe('suggestNominations', () => {
  const rows = [
    { name: 'Bijan Robinson', pos: 'RB', team: 'ATL', value: 50, surplus: 8 },
    { name: 'CeeDee Lamb', pos: 'WR', team: 'DAL', value: 45, surplus: 12 },
    { name: 'Sam LaPorta', pos: 'TE', team: 'DET', value: 15, surplus: 5 },
    { name: 'Chiefs D/ST', pos: 'D/ST', team: 'KC', value: 2, surplus: 1 },
  ]

  it('returns affordable, open-position players sorted by surplus', () => {
    const picks = suggestNominations({
      rows,
      pickedKeys: new Set(),
      myByPos: {},
      starters: DEFAULT_STARTERS,
      rosterSize: 16,
      remainingBudget: 200,
    })
    expect(picks.map((p) => p.name)).toEqual(['CeeDee Lamb', 'Bijan Robinson', 'Sam LaPorta'])
  })

  it('excludes picked players', () => {
    const picks = suggestNominations({
      rows,
      pickedKeys: new Set(['ceedee lamb']),
      myByPos: {},
      starters: DEFAULT_STARTERS,
      rosterSize: 16,
      remainingBudget: 200,
    })
    expect(picks.some((p) => p.name === 'CeeDee Lamb')).toBe(false)
  })

  it('excludes positions my team is full at', () => {
    const picks = suggestNominations({
      rows,
      pickedKeys: new Set(),
      myByPos: { TE: 3 }, // DEFAULT_STARTERS + bench caps TE at 3
      starters: DEFAULT_STARTERS,
      rosterSize: 16,
      remainingBudget: 200,
    })
    expect(picks.some((p) => p.pos === 'TE')).toBe(false)
  })

  it('excludes players I cannot afford with the reserve kept', () => {
    const picks = suggestNominations({
      rows,
      pickedKeys: new Set(),
      myByPos: {},
      starters: DEFAULT_STARTERS,
      rosterSize: 16,
      remainingBudget: 30, // reserve 15 slots -> can only afford <= $15
    })
    expect(picks.every((p) => p.value <= 15)).toBe(true)
  })
})
