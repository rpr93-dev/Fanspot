import type { StarterSlots } from '@/lib/fantasy/auction-engine'
import { positionCapacity, type MockPosition } from '@/lib/fantasy/mock-draft'
import { normalizeName } from '../names'

const AUCTION_POSITIONS: MockPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']

/**
 * Pure decision logic for the draft room. Everything here is a function of the
 * snapshot + the value index, so it is unit-testable without a browser.
 *
 * Bid stance mirrors the web app's auction mock: a player is worth the model's
 * value, but never more than `maxShareOfBudget` of what the team has left, and never
 * so much that it strands the roster without the $1-per-slot reserve. The hybrid
 * layer splits decisions at `autoBidCap` — cheap raises are placed automatically,
 * anything crossing the cap pauses and asks the human.
 */

/** Same "nice" increments the mock auction uses: cheap players don't jump, stars don't nickel. */
export function bidIncrement(currentBid: number): number {
  if (currentBid < 10) return 1
  if (currentBid < 30) return 2
  if (currentBid < 60) return 5
  return 10
}

export interface BidContext {
  /** Model value of the player on the block. */
  value: number
  currentBid: number
  remainingBudget: number
  remainingSlots: number
  /** My team is at capacity at this position. */
  positionFilled: boolean
  /** Player is injured/suspended and should not be bid on. */
  unavailable: boolean
  /** Auto-bid up to this amount; above it, pause and ask. */
  autoBidCap: number
  /** Never spend more than this share of remaining budget on one player. */
  maxShareOfBudget: number
}

export type BidDecision =
  | { action: 'pass'; reason: string }
  | { action: 'auto-bid'; amount: number; note: string }
  | { action: 'prompt'; amount: number; note: string }

export function decideBid(ctx: BidContext): BidDecision {
  if (ctx.positionFilled) return { action: 'pass', reason: 'position already full' }

  const shareCap = Math.floor(ctx.remainingBudget * ctx.maxShareOfBudget)
  const reserveCap = ctx.remainingBudget - Math.max(0, ctx.remainingSlots - 1)
  const maxBid = Math.max(0, Math.floor(Math.min(ctx.value, shareCap, reserveCap)))

  if (maxBid <= ctx.currentBid) {
    return { action: 'pass', reason: `out of my range (value $${ctx.value}, bid $${ctx.currentBid})` }
  }

  // Injury-watch players are never auto-bid — the model's value doesn't trust the
  // projection, and the human may know the designation is stale (e.g. a preseason
  // QUESTIONABLE on a Week 1 starter). Surface them and let the human decide.
  if (ctx.unavailable) {
    return {
      action: 'prompt',
      amount: maxBid,
      note: `on injury watch — model value $${ctx.value}, bid $${ctx.currentBid}`,
    }
  }

  // Bid the next clean increment, never past max. If that increment is within the
  // auto cap, place it; otherwise the human gets the call.
  const next = Math.min(maxBid, ctx.currentBid + bidIncrement(ctx.currentBid))
  if (next <= ctx.autoBidCap) {
    return { action: 'auto-bid', amount: next, note: `value $${ctx.value}` }
  }
  return {
    action: 'prompt',
    amount: maxBid,
    note: `value $${ctx.value} (next increment $${next})`,
  }
}

export interface NominationCandidate {
  name: string
  pos: string
  team: string
  value: number
  surplus: number | null
}

export interface NominationInput {
  rows: NominationCandidate[]
  /** Normalized names already taken off the board. */
  pickedKeys: Set<string>
  /** Players I already own, by position. */
  myByPos: Record<string, number>
  starters: StarterSlots
  rosterSize: number
  remainingBudget: number
  count?: number
}

/**
 * The players I'd most like to see on the block: affordable, open position, highest
 * surplus first (biggest expected discount to market). Nominating players I want
 * means landing them cheap if the room sleeps; the surplus sort keeps the
 * suggestions aligned with what the model thinks is underpriced.
 */
export function suggestNominations(input: NominationInput): NominationCandidate[] {
  const count = input.count ?? 3
  const candidates = input.rows.filter((r) => {
    const pos = r.pos as MockPosition
    if (!AUCTION_POSITIONS.includes(pos)) return false
    if (input.pickedKeys.has(normalizeName(r.name))) return false
    const cap = positionCapacity(input.starters, input.rosterSize, pos)
    if ((input.myByPos[r.pos] ?? 0) >= cap) return false
    // Must be able to afford it while keeping the $1-per-slot reserve.
    const owned = Object.values(input.myByPos).reduce((a, b) => a + b, 0)
    const reserve = Math.max(0, input.rosterSize - owned - 1)
    return r.value <= input.remainingBudget - reserve
  })

  candidates.sort((a, b) => {
    const sa = a.surplus ?? -Infinity
    const sb = b.surplus ?? -Infinity
    return sb - sa || b.value - a.value
  })

  return candidates.slice(0, count)
}
