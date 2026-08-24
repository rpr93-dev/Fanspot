import type { AuctionAssumptions } from '@/lib/fantasy/auction-engine'

/**
 * Shared engine types. `BotValue` is what the draft room actually bids on —
 * a name-keyed dollar figure plus market/surplus context. `ValueIndex.rows`
 * feeds nomination suggestions.
 */

export type ValueSource = 'fanspot' | 'fantasypros' | 'blend'

export interface BotValue {
  name: string
  pos: string
  team: string
  /** What the bot is willing to pay, in dollars. */
  value: number
  /** Market reference (ESPN rescaled or FantasyPros-derived), when known. */
  market: number | null
  /** value - market. Positive = model expects a bargain. */
  surplus: number | null
  /** True for injury-watch/suspended players — bid on these only with a human's call. */
  unavailable: boolean
  unavailableReason?: string
  source: 'board' | 'fallback' | 'fantasypros' | 'blend'
  /** FantasyPros context, when the value came from FantasyPros. */
  fp?: { ecr: number; posEcr: number; tier: number | null; owned: number }
}

/** Shape used for nomination suggestions. */
export interface PricedRow {
  name: string
  pos: string
  team: string
  value: number
  surplus: number | null
}

export interface ValueIndex {
  rows: PricedRow[]
  injuryWatch: PricedRow[]
  byKey: Map<string, BotValue>
  assumptions: AuctionAssumptions
  builtAtMs: number
  source: ValueSource
}
