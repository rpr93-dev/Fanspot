import type { ScoringFormat, AdpPlatform } from '@/lib/fantasy-types'
import { getPositionMultipliers } from './steal-engine'
import type { DraftPoolPlayer, MockPosition, StarterSlots } from './mock-draft'
import { MOCK_POSITIONS, DEFAULT_STARTERS, positionCapacity } from './mock-draft'
import type { InjuryTier } from './injury-gate'

/**
 * Auction draft room.
 *
 * A live auction mock that runs entirely client-side over the same unified pool the
 * snake mock drafts from. Each team owns a budget; teams rotate nominating players,
 * everyone with an open slot and money left bids or passes, and the last bidder wins
 * at their final price.
 *
 * Pricing is value-over-replacement in this league's money, the same stance as the
 * Auction Values board. Bots bid with budget discipline: they never spend more than
 * ~40% of what they have left on a single player, so money is spread across the
 * roster instead of blown on the first wave of stars — measured live, undisciplined
 * bots blew their budgets in the first ~30 picks, and every mid-tier player then sold
 * for $1 because nobody could afford a $2 bid.
 *
 * The human makes exactly two kinds of decisions: which player to nominate on their
 * nomination turn (the coach suggests affordable names, and they can search the whole
 * pool), and how much to bid on their bidding turn (or pass). Everything else — other
 * teams' nominations, their bidding wars, price discovery — resolves automatically.
 *
 * All functions are pure; the React side owns state. Drafts are seeded, so the same
 * settings reproduce the same room.
 */

export interface AuctionDraftSettings {
  teams: number
  /** Roster spots per team, including bench. */
  rosterSize: number
  /** Per-team budget, in whole dollars. */
  budget: number
  scoringFormat: ScoringFormat
  adpPlatform: AdpPlatform
  starters: StarterSlots
  /** 0-based index of the human's team in the nomination rotation. */
  userTeam: number
}

export const DEFAULT_AUCTION_DRAFT_SETTINGS: AuctionDraftSettings = {
  teams: 12,
  rosterSize: 16,
  budget: 200,
  scoringFormat: 'ppr',
  adpPlatform: 'espn',
  starters: DEFAULT_STARTERS,
  userTeam: 0,
}

export type AuctionPhase = 'nominating' | 'bidding'

export interface AuctionPick {
  /** 1-based nomination ordinal. */
  slot: number
  manager: number
  playerId: number
  name: string
  pos: MockPosition
  team: string
  projection: number
  /** Winning bid. */
  price: number
  /** The model's estimate of what this player is worth in this league's money. */
  value: number
  adpRank: number
  posRank: number
  injuryTier: InjuryTier
  injuryStatus: string
}

export interface AuctionTeam {
  manager: number
  isUser: boolean
  /** Dollars remaining. */
  budget: number
  /** Dollars committed so far. */
  spent: number
  picks: AuctionPick[]
  projected: number
  byPos: Partial<Record<MockPosition, number>>
}

/**
 * League-wide pricing derived once from the pool: replacement level per position
 * (the projection of the last player the league will actually roster there) and the
 * dollars-per-point rate on the money above the $1-per-slot floor. `auctionValue`
 * turns any pool player into a price, which is what bots bid toward and the coach
 * ranks nominations by.
 */
export interface AuctionPricing {
  replacementLevels: Record<MockPosition, number>
  dollarsPerPoint: number
}

export interface AuctionDraftState {
  settings: AuctionDraftSettings
  teams: AuctionTeam[]
  /** Remaining players, never re-inserted once sold. */
  pool: DraftPoolPlayer[]
  pickedIds: Set<number>
  phase: AuctionPhase
  /** Manager whose turn it is to nominate (phase === 'nominating'). */
  nominateManager: number
  /** Player currently on the block (phase === 'bidding'). */
  nominatingPlayer: DraftPoolPlayer | null
  currentBid: number
  currentBidder: number | null
  /** Managers still able to bid this nomination, in bidding-turn order. */
  activeBidders: number[]
  /** Index into `activeBidders` of whose turn to bid. */
  bidCursor: number
  completed: boolean
  pickLog: AuctionPick[]
  /** Seeded with a random value at createAuctionDraft so a fresh room plays fresh. */
  seed: number
  pricing: AuctionPricing
}

/** Per-position projection reliability, the same stance the steals board uses. */
const POSITION_WEIGHT = getPositionMultipliers()

/** Flex spots split across the positions that can fill them, mirroring the auction board. */
const FLEX_SHARE: Record<MockPosition, number> = { QB: 0, RB: 0.4, WR: 0.5, TE: 0.1, K: 0, 'D/ST': 0 }

/**
 * A team never spends more than this share of its remaining budget on one player.
 * Without the cap, bots all value the same elites the same way and war every early
 * star up to ~max, then run out of money and let the whole mid-market go for $1.
 */
const MAX_SHARE_OF_BUDGET = 0.4

function isUnavailable(p: DraftPoolPlayer): boolean {
  return p.suspended === true || p.injuryTier === 'severe' || p.injuryTier === 'out'
}

function replacementLevels(pool: DraftPoolPlayer[], settings: AuctionDraftSettings): Record<MockPosition, number> {
  const levels = {} as Record<MockPosition, number>
  for (const pos of MOCK_POSITIONS) {
    const projs = pool
      .filter((p) => p.pos === pos)
      .map((p) => p.projection)
      .sort((a, b) => b - a)
    if (projs.length === 0) {
      levels[pos] = 0
      continue
    }
    const flex = (FLEX_SHARE[pos] ?? 0) * settings.starters.FLEX
    // Replacement is the last player a league actually rosters at the position —
    // starters plus the bench share each position draws — not just the last starter.
    // Starter-depth replacement prices only ~125 of 282 players, flooding the rest
    // at the  floor; roster-depth spreads value into the first-bench tier, which
    // is where real -9 players live.
    const benchSlots = Math.max(0, settings.rosterSize - (settings.starters.QB + settings.starters.RB + settings.starters.WR + settings.starters.TE + settings.starters.K + settings.starters['D/ST'] + settings.starters.FLEX))
    const benchShare: Record<MockPosition, number> = { QB: 1.2, RB: 1.6, WR: 1.6, TE: 1.2, K: 0, 'D/ST': 0 }
    const benchSum = Object.values(benchShare).reduce((a, b) => a + b, 0)
    const bench = benchShare[pos] ?? 0
    // Blend starter- and roster-depth: full roster depth prices stars too cheap
    // (Gibbs 4), starter depth floods the bench at . The midpoint keeps stars
    // around 5-80 while giving first-bench players real -10 value.
    const depth = Math.max(1, Math.round((settings.starters[pos] + flex + 0.5 * (benchSlots * bench) / benchSum) * settings.teams))
    levels[pos] = projs[Math.min(depth, projs.length) - 1]
  }
  return levels
}

export function computeAuctionPricing(
  pool: DraftPoolPlayer[],
  settings: AuctionDraftSettings,
): AuctionPricing {
  const replacementLevelsMap = replacementLevels(pool, settings)
  // Only the players a league will actually roster absorb the money: the top
  // 'slots' by value-over-replacement. Pricing against the whole pool (including
  // players who never get drafted) dilutes the dollars-per-point rate.
  const slots = settings.teams * settings.rosterSize
  const vorps = pool
    .map((p) => Math.max(0, (p.projection - (replacementLevelsMap[p.pos] ?? 0)) * (POSITION_WEIGHT[p.pos] ?? 1)))
    .sort((a, b) => b - a)
  const totalVorp = vorps.slice(0, slots).reduce((sum, v) => sum + v, 0)
  const discretionary = Math.max(0, settings.budget * settings.teams - slots)
  return {
    replacementLevels: replacementLevelsMap,
    dollarsPerPoint: totalVorp > 0 ? discretionary / totalVorp : 0,
  }
}

/**
 * What this league's money says a player is worth. Starters price off VORP above
 * replacement; players below replacement aren't worthless — a bench spot still has
 * to be filled — so they price at $1-3 scaled by how close they are to startable.
 */
export function auctionValue(p: DraftPoolPlayer, pricing: AuctionPricing): number {
  const repl = pricing.replacementLevels[p.pos] ?? 0
  const vorp = (p.projection - repl) * (POSITION_WEIGHT[p.pos] ?? 1)
  if (vorp <= 0) {
    if (repl <= 0 || p.projection <= 0) return 1
    const ratio = Math.min(1, Math.max(0, p.projection / repl))
    return Math.max(1, Math.round((1 + ratio * 2) * 10) / 10)
  }
  return Math.max(1, Math.round((1 + vorp * pricing.dollarsPerPoint) * 10) / 10)
}

function remainingSlots(team: AuctionTeam, rosterSize: number): number {
  return Math.max(0, rosterSize - team.picks.length)
}

/** A team must keep $1 per slot it still has to fill, so it never strands a $0 roster. */
function canAfford(team: AuctionTeam, rosterSize: number, amount: number): boolean {
  return team.budget - amount >= Math.max(0, remainingSlots(team, rosterSize) - 1)
}

function hasOpenSlot(team: AuctionTeam, pos: MockPosition, starters: StarterSlots, rosterSize: number): boolean {
  return (team.byPos[pos] ?? 0) < positionCapacity(starters, rosterSize, pos)
}

/** Next manager in the rotation who still has a roster slot to fill; null when done. */
function nextNominator(settings: AuctionDraftSettings, teams: AuctionTeam[], from: number): number | null {
  for (let step = 1; step <= settings.teams; step++) {
    const m = (from + step) % settings.teams
    if (teams[m]!.picks.length < settings.rosterSize) return m
  }
  return null
}

/** Deterministic pseudo-random generator — same seed, same auction, every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createAuctionDraft(
  pool: DraftPoolPlayer[],
  settings: AuctionDraftSettings,
  seed = (Math.random() * 0x7fffffff) >>> 0,
): AuctionDraftState {
  const eligible = pool.filter((p) => !isUnavailable(p))
  const userIdx = Math.max(0, Math.min(settings.teams - 1, settings.userTeam))
  const teams: AuctionTeam[] = Array.from({ length: settings.teams }, (_, i) => ({
    manager: i,
    isUser: i === userIdx,
    budget: settings.budget,
    spent: 0,
    picks: [],
    projected: 0,
    byPos: {},
  }))
  const pricing = computeAuctionPricing(eligible, settings)
  // The human nominates first so the room opens on a decision they can make.
  return {
    settings,
    teams,
    pool: eligible,
    pickedIds: new Set(),
    phase: 'nominating',
    nominateManager: userIdx,
    nominatingPlayer: null,
    currentBid: 0,
    currentBidder: null,
    activeBidders: [],
    bidCursor: 0,
    completed: eligible.length === 0,
    pickLog: [],
    seed,
    pricing,
  }
}

/**
 * Put a player on the block. The nominator holds the opening bid; every other team
 * with an open slot at the position and enough money to outbid by $1 joins the
 * bidding order (nominator acts last, so they can defend their own nomination).
 */
export function nominate(
  state: AuctionDraftState,
  player: DraftPoolPlayer,
  openingBid = 1,
): AuctionDraftState {
  if (state.completed || state.phase !== 'nominating') return state
  if (state.pickedIds.has(player.playerId) || !state.pool.some((p) => p.playerId === player.playerId)) {
    return state
  }
  const nominator = state.teams[state.nominateManager]
  if (!nominator) return state
  const bid = Math.max(1, Math.round(openingBid))
  if (!canAfford(nominator, state.settings.rosterSize, bid)) return state

  const s = state.settings
  const active = state.teams
    .filter((t) => {
      if (!hasOpenSlot(t, player.pos, s.starters, s.rosterSize)) return false
      // The nominator only needs to afford the opening bid; everyone else must be
      // able to outbid by $1 or they could never win the player.
      if (t.manager === state.nominateManager) return canAfford(t, s.rosterSize, bid)
      return canAfford(t, s.rosterSize, bid + 1)
    })
    .map((t) => t.manager)
  if (active.length === 0) return state

  // Bid turns rotate from the team after the nominator; the nominator is last.
  const startIdx = active.indexOf(state.nominateManager)
  const ordered = [...active.slice(startIdx + 1), ...active.slice(0, startIdx + 1)]

  return {
    ...state,
    phase: 'bidding',
    nominatingPlayer: player,
    currentBid: bid,
    currentBidder: state.nominateManager,
    activeBidders: ordered,
    bidCursor: 0,
  }
}

/** Sell the player on the block to `currentBidder` at `currentBid`. */
function closeNomination(state: AuctionDraftState): AuctionDraftState {
  const player = state.nominatingPlayer
  const winner = state.currentBidder
  if (!player || winner == null) {
    // No valid winner — skip the nomination and move on.
    return advanceNominator({ ...state, phase: 'nominating', nominatingPlayer: null, currentBid: 0 })
  }
  const price = state.currentBid
  const pick: AuctionPick = {
    slot: state.pickLog.length + 1,
    manager: winner,
    playerId: player.playerId,
    name: player.name,
    pos: player.pos,
    team: player.team,
    projection: player.projection,
    price,
    value: auctionValue(player, state.pricing),
    adpRank: player.adpRank,
    posRank: player.posRank,
    injuryTier: player.injuryTier,
    injuryStatus: player.injuryStatus,
  }

  const teams = state.teams.map((t) => {
    if (t.manager !== winner) return t
    return {
      ...t,
      budget: t.budget - price,
      spent: t.spent + price,
      picks: [...t.picks, pick],
      projected: t.projected + player.projection,
      byPos: { ...t.byPos, [player.pos]: (t.byPos[player.pos] ?? 0) + 1 },
    }
  })
  const pickedIds = new Set(state.pickedIds)
  pickedIds.add(player.playerId)
  const pool = state.pool.filter((p) => p.playerId !== player.playerId)
  const pickLog = [...state.pickLog, pick]

  return advanceNominator({
    ...state,
    teams,
    pool,
    pickedIds,
    pickLog,
    phase: 'nominating',
    nominatingPlayer: null,
    currentBid: 0,
    currentBidder: null,
    activeBidders: [],
    bidCursor: 0,
  })
}

function advanceNominator(state: AuctionDraftState): AuctionDraftState {
  const next = nextNominator(state.settings, state.teams, state.nominateManager)
  const completed =
    next == null || state.pool.length === 0 || state.teams.every((t) => t.picks.length >= state.settings.rosterSize)
  return { ...state, nominateManager: next ?? state.nominateManager, completed }
}

/**
 * Advance past a bid or pass; when only one bidder remains, they win. Otherwise the
 * cursor moves to the next bidder who is not the current high bidder — the high
 * bidder never acts against themselves, so the room can't spiral into self-raising.
 */
function advanceBid(state: AuctionDraftState): AuctionDraftState {
  const bidders = state.activeBidders
  if (bidders.length <= 1) return closeNomination(state)
  let idx = state.bidCursor
  let next = (idx + 1) % bidders.length
  while (next !== idx && bidders[next] === state.currentBidder) {
    next = (next + 1) % bidders.length
  }
  return { ...state, bidCursor: next }
}

/** The human (or a bot) raises the current bid. Must exceed the current price. */
export function placeBid(state: AuctionDraftState, manager: number, amount: number): AuctionDraftState {
  if (state.phase !== 'bidding' || !state.nominatingPlayer) return state
  if (state.activeBidders[state.bidCursor] !== manager) return state
  const amt = Math.round(amount)
  if (amt <= state.currentBid) return state
  if (!canAfford(state.teams[manager]!, state.settings.rosterSize, amt)) return state
  return advanceBid({
    ...state,
    currentBid: amt,
    currentBidder: manager,
    bidCursor: state.bidCursor + 1,
  })
}

/** Drop out of the current bidding war. The high bidder cannot pass — only be outbid. */
export function pass(state: AuctionDraftState, manager: number): AuctionDraftState {
  if (state.phase !== 'bidding' || !state.nominatingPlayer) return state
  if (state.activeBidders[state.bidCursor] !== manager) return state
  if (manager === state.currentBidder) return state
  const active = state.activeBidders.filter((m) => m !== manager)
  return advanceBid({
    ...state,
    activeBidders: active,
    bidCursor: Math.min(state.bidCursor, Math.max(0, active.length - 1)),
  })
}

/** Next "nice" bid increment, scaled so cheap players don't jump and stars don't nickel. */
function bidIncrement(currentBid: number): number {
  if (currentBid < 10) return 1
  if (currentBid < 30) return 2
  if (currentBid < 60) return 5
  return 10
}

/**
 * What a bot is willing to pay for the player on the block: the model's value with
 * a seeded personality swing, capped by budget discipline — never more than
 * `MAX_SHARE_OF_BUDGET` of what it has left, and never more than it can spend while
 * keeping the $1-per-slot reserve.
 */
function botMaxBid(state: AuctionDraftState, manager: number): number {
  const player = state.nominatingPlayer
  if (!player) return 0
  const rng = mulberry32(state.seed ^ Math.imul(manager + 1, 0x9e3779b1) ^ (state.pickLog.length + 1) * 7919)
  const jitter = 0.85 + rng() * 0.35
  const value = auctionValue(player, state.pricing)
  const team = state.teams[manager]!
  const budgetCap = Math.floor(team.budget * MAX_SHARE_OF_BUDGET)
  const reserveCap = team.budget - Math.max(0, state.settings.rosterSize - team.picks.length - 1)
  return Math.max(0, Math.min(Math.floor(value * jitter), budgetCap, reserveCap))
}

/** The player a bot nominates on its turn: the best affordable value it can win. */
function botNomination(state: AuctionDraftState): DraftPoolPlayer | null {
  const team = state.teams[state.nominateManager]
  if (!team) return null
  const s = state.settings
  const rng = mulberry32(state.seed ^ Math.imul(state.nominateManager + 1, 0x27d4eb2d) ^ (state.pickLog.length + 1) * 104729)
  const candidates = state.pool.filter(
    (p) =>
      !state.pickedIds.has(p.playerId) &&
      hasOpenSlot(team, p.pos, s.starters, s.rosterSize) &&
      canAfford(team, s.rosterSize, 1),
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    const score = (p: DraftPoolPlayer) => auctionValue(p, state.pricing) * (0.9 + rng() * 0.2)
    return score(b) - score(a)
  })
  return candidates[0] ?? null
}

/**
 * A bot bids its (jittered, budget-capped) value or passes. Usually it nudges the
 * price up by one increment; occasionally it jumps toward its max to put a war away.
 */
function botBidAmount(state: AuctionDraftState, manager: number): number | null {
  const maxBid = botMaxBid(state, manager)
  if (maxBid <= state.currentBid) return null
  const rng = mulberry32(state.seed ^ Math.imul(manager + 1, 0x85ebca6b) ^ (state.pickLog.length + 1) * 15485863)
  const increment = bidIncrement(state.currentBid)
  const conservative = Math.min(maxBid, state.currentBid + increment)
  const candidate = rng() < 0.1 ? maxBid : conservative
  const team = state.teams[manager]!
  if (!canAfford(team, state.settings.rosterSize, candidate)) return null
  return candidate > state.currentBid ? candidate : null
}

/**
 * Run every bot decision until the next human turn (or the end of the auction).
 * Bots nominate their best affordable value and bid up to their jittered, budget-
 * capped max, so the room resolves price discovery without any human babysitting.
 */
export function simulate(
  state: AuctionDraftState,
  opts: { untilUser: boolean } = { untilUser: true },
): AuctionDraftState {
  let s = state
  let guard = 0
  while (!s.completed && guard < 5000) {
    guard += 1
    if (s.phase === 'bidding' && s.activeBidders[s.bidCursor] === s.currentBidder) {
      // The high bidder never acts against themselves — skip their turn.
      s = advanceBid(s)
      continue
    }
    const actor = s.phase === 'nominating' ? s.nominateManager : s.activeBidders[s.bidCursor]
    if (actor == null) {
      if (s.phase === 'bidding' && s.activeBidders.length <= 1) {
        s = closeNomination(s)
        continue
      }
      break
    }
    if (opts.untilUser && s.teams[actor]?.isUser) break

    if (s.phase === 'nominating') {
      const player = botNomination(s)
      if (!player) {
        // Nominator can't afford anything or has no fits — skip their turn.
        const next = nextNominator(s.settings, s.teams, s.nominateManager)
        if (next == null) {
          s = { ...s, completed: true }
          break
        }
        s = { ...s, nominateManager: next }
        continue
      }
      s = nominate(s, player)
    } else {
      const amount = botBidAmount(s, actor)
      s = amount == null ? pass(s, actor) : placeBid(s, actor, amount)
    }
  }
  return s
}

/**
 * Suggestions for the human's nomination turn: the best affordable values that still
 * fit their roster, ordered by what this league's money says they're worth.
 */
export function auctionCoach(state: AuctionDraftState, limit = 6): DraftPoolPlayer[] {
  if (state.completed || state.phase !== 'nominating') return []
  const team = state.teams[state.nominateManager]
  if (!team?.isUser) return []
  const s = state.settings
  const candidates = state.pool.filter(
    (p) =>
      !state.pickedIds.has(p.playerId) &&
      hasOpenSlot(team, p.pos, s.starters, s.rosterSize) &&
      canAfford(team, s.rosterSize, 1),
  )
  candidates.sort((a, b) => auctionValue(b, state.pricing) - auctionValue(a, state.pricing))
  return candidates.slice(0, limit)
}

/**
 * What the human should bid on their turn: the current price, the honest top of
 * their range (model value, no bot jitter), and the next increment to offer.
 */
export function suggestBid(state: AuctionDraftState): {
  currentBid: number
  currentBidder: number | null
  maxBid: number
  nextBid: number
} | null {
  if (state.phase !== 'bidding' || !state.nominatingPlayer) return null
  const player = state.nominatingPlayer
  const value = auctionValue(player, state.pricing)
  const maxBid = Math.floor(value)
  const increment = bidIncrement(state.currentBid)
  return {
    currentBid: state.currentBid,
    currentBidder: state.currentBidder,
    maxBid,
    nextBid: Math.min(maxBid, state.currentBid + increment),
  }
}

export interface AuctionDraftGrade {
  total: number
  leagueAvg: number
  rank: number
  grade: string
  /** Dollars per projected point for the user's roster. */
  dollarsPerPoint: number
  leagueDollarsPerPoint: number
  /** Picks bought below the model's estimate. */
  bargains: number
  spent: number
  remainingBudget: number
}

/** End-of-auction verdict, same shape as the snake grade but with money efficiency. */
export function auctionDraftGrade(state: AuctionDraftState): AuctionDraftGrade {
  const teams = state.teams.map((t, i) => ({ i, projected: t.projected, spent: t.spent }))
  const user = teams.find((t) => state.teams[t.i]?.isUser)
  const total = user?.projected ?? 0
  const spent = user?.spent ?? 0
  const leagueAvg = teams.length > 0 ? teams.reduce((sum, t) => sum + t.projected, 0) / teams.length : 0
  const sorted = [...teams].sort((a, b) => b.projected - a.projected)
  const rank = (user ? sorted.findIndex((t) => t.i === user.i) : -1) + 1

  const userPicks = user ? state.teams[user.i]!.picks : []
  const bargains = userPicks.filter((p) => p.price < p.value).length

  const leagueSpent = teams.reduce((sum, t) => sum + t.spent, 0) || 1
  const dollarsPerPoint = total > 0 ? spent / total : 0
  const leagueDollarsPerPoint = leagueAvg > 0 ? leagueSpent / teams.length / leagueAvg : 0

  let grade = 'C'
  if (total >= leagueAvg * 1.05) grade = 'A'
  else if (total >= leagueAvg * 1.0) grade = 'B'
  else if (total >= leagueAvg * 0.95) grade = 'C'
  else grade = 'D'

  return {
    total,
    leagueAvg,
    rank,
    grade,
    dollarsPerPoint,
    leagueDollarsPerPoint,
    bargains,
    spent,
    remainingBudget: state.settings.budget - spent,
  }
}
