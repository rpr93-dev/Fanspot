import type { FantasyPlayerEnriched, ScoringFormat, AdpPlatform, AdpSource } from '@/lib/fantasy-types'
import { getPositionMultipliers, formatPoints } from './steal-engine'
import { resolveInjuryTier, type InjuryTier } from './injury-gate'

/**
 * Mock draft room.
 *
 * A snake draft that runs entirely client-side over the unified player pool. Bots pick
 * like reasonable managers: best available at a position they still have a slot for,
 * weighted by a per-position reliability multiplier, a scoring-format twist (PPR
 * rewards WRs, standard rewards RBs) and a round "wave" curve so QBs go mid-draft and
 * kickers/defenses fall to the end. Drafts are seeded, so each fresh mock throws a
 * different spread; bots also read the board — scarcity reacts to early runs, and a
 * team won't take a second QB while other teams are still without their first.
 *
 * The Draft Coach surfaced for the human turn is the same scoring, minus the
 * personalities: it is deterministic, while bot picks carry a seeded tilt and jitter.
 * All functions are pure — the React side owns state.
 */

export interface MockDraftSettings {
  teams: number
  /** The user's draft position, 1-based, within `teams`. */
  pick: number
  /** Roster spots per team, including bench. */
  rosterSize: number
  scoringFormat: ScoringFormat
  adpPlatform: AdpPlatform
  /** Required starters per position; every slot beyond these is a free bench spot. */
  starters: StarterSlots
}

export interface StarterSlots {
  QB: number
  RB: number
  WR: number
  TE: number
  K: number
  'D/ST': number
  /** Flex spots that RB/WR/TE compete for. */
  FLEX: number
}

export const DEFAULT_STARTERS: StarterSlots = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  K: 1,
  'D/ST': 1,
  FLEX: 1,
}

export const DEFAULT_MOCK_SETTINGS: MockDraftSettings = {
  teams: 12,
  pick: 1,
  rosterSize: 16,
  scoringFormat: 'ppr',
  adpPlatform: 'espn',
  starters: DEFAULT_STARTERS,
}

export const MOCK_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const
export type MockPosition = (typeof MOCK_POSITIONS)[number]

/** The three skill positions eligible to fill a flex slot. */
export const FLEX_POSITIONS: MockPosition[] = ['RB', 'WR', 'TE']

export interface DraftPoolPlayer {
  playerId: number
  name: string
  pos: MockPosition
  team: string
  projection: number
  adp: number
  adpSource: AdpSource
  injuryTier: InjuryTier
  injuryStatus: string
  injuryDetail?: string
  suspended?: boolean
  /** Projection rank within position. */
  posRank: number
  /** ADP rank within position. */
  adpRank: number
  /** adpRank - posRank. Positive = falling past its value. */
  gap: number
  /** Pool size at this player's position. */
  posPoolSize: number
}

export interface DraftPick {
  /** 0-based index into the snake order. */
  slot: number
  /** 0-based manager index in the draft. */
  manager: number
  playerId: number
  name: string
  pos: MockPosition
  team: string
  projection: number
  adpRank: number
  posRank: number
  /** Injury tier at draft time — lets the room warn on the pick card. */
  injuryTier: InjuryTier
  injuryStatus: string
}

export interface DraftTeam {
  manager: number
  isUser: boolean
  picks: DraftPick[]
  /** Running total of projected points picked. */
  projected: number
  byPos: Partial<Record<MockPosition, number>>
}

export interface DraftState {
  settings: MockDraftSettings
  starters: StarterSlots
  /** The snake order of manager indices. */
  order: number[]
  /** Next slot index into `order`; the current turn. */
  cursor: number
  teams: DraftTeam[]
  /** Remaining pool players, never re-inserted once picked. */
  pool: DraftPoolPlayer[]
  /** Deduplicated ids removed from `pool`. */
  pickedIds: Set<number>
  completed: boolean
  pickLog: DraftPick[]
  /** Seeded with a random value at createDraft so a fresh draft drafts fresh. */
  seed: number
}

export interface DraftResult {
  state: DraftState
  changed: boolean
  error?: string
}

function posOf(p: FantasyPlayerEnriched): string {
  return p.normalizedPosition ?? ''
}

function projOf(p: FantasyPlayerEnriched, fmt: ScoringFormat): number {
  return formatPoints(p, fmt)
}

function getAdp(p: FantasyPlayerEnriched, platform: AdpPlatform): { adp: number | undefined; source: AdpSource } {
  if (platform === 'sleeper') return { adp: p.sleeper?.search_rank, source: 'popularity_fallback' }
  if (p.pprRank != null) return { adp: p.pprRank, source: p.adpSource ?? 'espn' }
  return { adp: p.standardRank, source: 'espn' }
}

/**
 * Per-position reliability, the same stance the steals board uses for price noise.
 * Multiplied by a scoring-format twist so a PPR mock (catches feed WRs) and a
 * standard mock (raw volume favors RBs) draft like their real markets.
 */
const POSITION_WEIGHT = getPositionMultipliers()

/**
 * How much a position's value shifts by scoring format, on top of the steals-board
 * base. PPR nudges WR/TE up and RB down; standard rewards RBs; half-PPR splits it.
 * QB/K/D/ST never swing much — their mid- and late-round waves are scripted by the
 * launch curve instead.
 */
const FORMAT_WEIGHT: Partial<Record<ScoringFormat, Partial<Record<MockPosition, number>>>> = {
  ppr: { QB: 1.0, RB: 0.97, WR: 1.1, TE: 1.05, K: 0.9, 'D/ST': 0.9 },
  'half-ppr': { QB: 1.0, RB: 1.04, WR: 1.03, TE: 1.02, K: 0.95, 'D/ST': 0.95 },
  standard: { QB: 1.0, RB: 1.12, WR: 0.95, TE: 0.95, K: 1.15, 'D/ST': 1.15 },
}

/**
 * How much of a player's projection the bot trusts while they carry an injury tag.
 * Questionable eats 15% of the grade; Doubtful eats 40% — a doubtful player is more
 * likely than not to miss the game the projection assumed. Out/severe players never
 * reach the board (createDraft filters them), but grade stays 0 defensively.
 */
export const INJURY_GRADE: Record<InjuryTier, number> = {
  healthy: 1,
  probable: 1,
  questionable: 0.85,
  doubtful: 0.6,
  out: 0,
  severe: 0,
}

function posWeight(pos: MockPosition): number {
  return POSITION_WEIGHT[pos] ?? 1
}

function resolveInjury(p: FantasyPlayerEnriched): { tier: InjuryTier; status: string; detail?: string; suspended?: boolean } {
  const injury = resolveInjuryTier({
    espnStatus: p.player.injuryStatus,
    espnInjured: p.player.injured,
    sleeperStatus: (p.sleeper as Record<string, unknown> | undefined)?.injury_status as string | undefined,
    rosterStatus: (p.sleeper as Record<string, unknown> | undefined)?.status as string | undefined,
    bodyPart: (p.sleeper as Record<string, unknown> | undefined)?.injury_body_part as string | undefined,
    notes: (p.sleeper as Record<string, unknown> | undefined)?.injury_notes as string | undefined,
  })
  return { tier: injury.tier, status: p.player.injuryStatus || 'UNKNOWN', detail: injury.detail || undefined, suspended: injury.suspended }
}

function isUnavailable(p: DraftPoolPlayer): boolean {
  return p.suspended === true || p.injuryTier === 'severe' || p.injuryTier === 'out'
}

/** Snake pick order: rounds alternate forward/reverse so picks wrap around the table. */
export function snakeOrder(teams: number, rounds: number): number[] {
  const order: number[] = []
  for (let round = 0; round < rounds; round++) {
    const base = Array.from({ length: teams }, (_, i) => i)
    if (round % 2 === 1) base.reverse()
    order.push(...base)
  }
  return order
}

export function buildDraftPool(
  players: FantasyPlayerEnriched[],
  settings: Pick<MockDraftSettings, 'scoringFormat' | 'adpPlatform'>,
): DraftPoolPlayer[] {
  const pool: DraftPoolPlayer[] = []
  for (const p of players) {
    const pos = posOf(p)
    if (!(MOCK_POSITIONS as readonly string[]).includes(pos)) continue
    if (p.player.active === false) continue
    if (!p.proTeamAbbr || p.proTeamAbbr.trim().toUpperCase() === 'FA') continue
    const proj = projOf(p, settings.scoringFormat)
    if (proj <= 0) continue
    const { adp, source } = getAdp(p, settings.adpPlatform ?? 'espn')
    if (adp == null || adp <= 0) continue
    const injury = resolveInjury(p)
    pool.push({
      playerId: p.id,
      name: p.player.fullName,
      pos: pos as MockPosition,
      team: p.proTeamAbbr,
      projection: proj,
      adp,
      adpSource: source,
      injuryTier: injury.tier,
      injuryStatus: injury.status,
      injuryDetail: injury.detail,
      suspended: injury.suspended,
      posRank: 0,
      adpRank: 0,
      gap: 0,
      posPoolSize: 0,
    })
  }

  const byPos = new Map<MockPosition, DraftPoolPlayer[]>()
  for (const p of pool) {
    const list = byPos.get(p.pos) ?? []
    list.push(p)
    byPos.set(p.pos, list)
  }
  for (const [pos, group] of byPos) {
    const poolSize = group.length
    const byProj = [...group].sort((a, b) => b.projection - a.projection)
    const byAdp = [...group].sort((a, b) => a.adp - b.adp)
    const projRank = new Map<number, number>()
    const adpRank = new Map<number, number>()
    byProj.forEach((p, i) => projRank.set(p.playerId, i + 1))
    byAdp.forEach((p, i) => adpRank.set(p.playerId, i + 1))
    for (const p of group) {
      p.posRank = projRank.get(p.playerId) as number
      p.adpRank = adpRank.get(p.playerId) as number
      p.gap = p.adpRank - p.posRank
      p.posPoolSize = poolSize
    }
  }

  return pool
}

/**
 * Per-team capacity at a position. Exactly `starters[pos]` slots are *required*
 * starters — a team may never finish the draft under a starter count. The remaining
 * roster spots (rosterSize minus the total required starters) are bench, and "anything
 * goes" there, with one rule: bench intake is capped per position by a weight so a bot
 * can't stack 8 running backs in the flex while leaving receivers thin. The weights
 * still sum the caps to exactly rosterSize, so a 16-spot roster really drafts 16
 * players, and shrinking the starter counts just widens the flexible bench.
 */
const BENCH_WEIGHTS: Record<MockPosition, number> = {
  QB: 1.2,
  RB: 1.6,
  WR: 1.6,
  TE: 1.2,
  K: 0,
  'D/ST': 0,
}

export const POSITION_ORDER: MockPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']

function starterTotal(starters: StarterSlots): number {
  return starters.QB + starters.RB + starters.WR + starters.TE + starters.K + starters['D/ST'] + starters.FLEX
}

/** Spread `slots` across positions by weight, rounding so the total is exactly `slots`. */
function spreadBench(slots: number): Record<MockPosition, number> {
  const out = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, 'D/ST': 0 } as Record<MockPosition, number>
  const weightSum = POSITION_ORDER.reduce((s, p) => s + BENCH_WEIGHTS[p], 0)
  let allocated = 0
  const fracs = new Map<MockPosition, number>()
  for (const p of POSITION_ORDER) {
    const raw = (slots * BENCH_WEIGHTS[p]) / weightSum
    const floor = Math.floor(raw)
    out[p] = floor
    fracs.set(p, raw - floor)
    allocated += floor
  }
  // Remainder slots (rounding drift) go to the largest fractional remainders.
  let left = slots - allocated
  const remainders = [...fracs.entries()].sort((a, b) => b[1] - a[1])
  let i = 0
  while (left > 0) {
    const [p] = remainders[i % remainders.length]!
    out[p as MockPosition] += 1
    left -= 1
    i += 1
  }
  return out
}

/** Flex slots (FLEX starters) are shared across RB/WR/TE for capacity counting. */
function flexCapacity(starters: StarterSlots, pos: MockPosition): number {
  if (pos !== 'RB' && pos !== 'WR' && pos !== 'TE') return 0
  const skill = [starters.RB, starters.WR, starters.TE]
  const total = skill[0]! + skill[1]! + skill[2]!
  if (total === 0) return 0
  const own = starters[pos]
  return Math.round((starters.FLEX * own) / Math.max(1, total))
}

export function positionCapacity(starters: StarterSlots, rosterSize: number, pos: MockPosition): number {
  const starterSlots = starterTotal(starters)
  const benchSlots = Math.max(0, rosterSize - starterSlots)
  const bench = spreadBench(benchSlots)
  return starters[pos] + flexCapacity(starters, pos) + bench[pos]
}

/** The human's slot in a draft, from a 1-based pick number. */
function managerOfPick(settings: MockDraftSettings): number {
  return Math.max(0, Math.min(settings.teams - 1, settings.pick - 1))
}

export function createDraft(
  pool: DraftPoolPlayer[],
  settings: MockDraftSettings,
  starters: StarterSlots = settings.starters ?? DEFAULT_STARTERS,
  seed = (Math.random() * 0x7fffffff) >>> 0,
): DraftState {
  const order = snakeOrder(settings.teams, settings.rosterSize)
  const eligible = pool.filter((p) => !isUnavailable(p))
  const userManager = managerOfPick(settings)

  const teams: DraftTeam[] = Array.from({ length: settings.teams }, (_, i) => ({
    manager: i,
    isUser: i === userManager,
    picks: [],
    projected: 0,
    byPos: {},
  }))

  return {
    settings,
    starters,
    order,
    cursor: 0,
    teams,
    pool: eligible,
    pickedIds: new Set<number>(),
    completed: eligible.length === 0 || order.length === 0,
    pickLog: [],
    seed,
  }
}

function countAt(t: DraftTeam, pos: MockPosition): number {
  return t.byPos[pos] ?? 0
}

function hasOpenSlot(
  t: DraftTeam,
  pos: MockPosition,
  starters: StarterSlots,
  rosterSize: number,
): boolean {
  return countAt(t, pos) < positionCapacity(starters, rosterSize, pos)
}

/** Deterministic pseudo-random generator — same seed, same draft, every time. */
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

/**
 * Where in the draft we are, as a 0..1 fraction of the snake's depth. Wave timing and
 * scarcity decisions read this fraction, not the raw slot index.
 */
function roundFraction(state: DraftState): number {
  const totalRounds = Math.max(1, state.settings.rosterSize)
  const round = Math.floor(state.cursor / state.settings.teams) + 1
  return Math.min(1, (round - 1) / totalRounds)
}

/**
 * Position "wave" tax by draft depth. RBs and WRs stock the board first, QBs surf a
 * rise a few rounds in (their market is fast-moving and crowded, so waiting is cheap
 * until the wave builds), TEs drift, and kickers/defenses are invisible until the
 * closing stretch. 0..1 is the fraction of the draft elapsed.
 */
function waveScore(pos: MockPosition, ratio: number): number {
  switch (pos) {
    case 'QB':
      if (ratio < 0.3) return 0.25 + 0.9 * (ratio / 0.3)
      if (ratio < 0.55) return 1.0 - ((ratio - 0.3) / 0.25) * 0.25
      return 0.75 - ((ratio - 0.55) / 0.45) * 0.3
    case 'RB':
      return 1.2 - 0.42 * ratio
    case 'WR':
      return 1.12 - 0.18 * ratio
    case 'TE':
      if (ratio < 0.2) return 0.5
      if (ratio < 0.42) return 0.5 + 0.6 * ((ratio - 0.2) / 0.22)
      return 1.1 - ((ratio - 0.42) / 0.58) * 0.75
    case 'K':
    case 'D/ST':
      // Invisible until the closing rounds, then very available.
      if (ratio < 0.6) return 0.02
      if (ratio < 0.84) return 0.02 + ((ratio - 0.6) / 0.24) * 1.0
      return 1.02 + ((ratio - 0.84) / 0.16) * 0.4
  }
}

/** How many teams still need a starting player at each position right now. */
function startingNeed(state: DraftState): Record<MockPosition, number> {
  const need: Record<MockPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, 'D/ST': 0 }
  for (const t of state.teams) {
    for (const pos of MOCK_POSITIONS) {
      if ((state.starters[pos] ?? 0) > 0 && countAt(t, pos) < (state.starters[pos] ?? 0)) need[pos] += 1
    }
  }
  return need
}

/**
 * Reactionary scarcity: if a position is running drier than the number of teams that
 * still need a starter there, the remaining good players at that spot get a boost — a
 * "run" that makes the machine look like it was paying attention to the other teams.
 */
function scarcityFactor(state: DraftState, pos: MockPosition, need: Record<MockPosition, number>): number {
  const deficit = need[pos] ?? 0
  if (deficit === 0) return 1
  const startable = state.pool.filter((p) => p.pos === pos && p.posRank <= deficit + 2).length
  if (startable >= deficit) return 1
  return 1 + ((deficit - startable) / deficit) * 0.65
}

/** Recent-pick momentum: teams lean into the position the draft is currently "running" on. */
function runBump(state: DraftState, pos: MockPosition): number {
  const lastSpots = state.pickLog.slice(-3)
  const same = lastSpots.filter((p) => p.pos === pos).length
  if (same >= 3) return 1.2
  if (same === 2) return 1.1
  return 1
}

/**
 * Backup gating: don't let a team add a backup at a position it already fills while a
 * team across the room is still empty there. Kickers/defenses are naturally capped at
 * the starter count by capacity, this guards QB/TE (and, if someone configures a bench
 * seat for a K, keeps real-draft logic intact).
 */
function backupGate(state: DraftState, team: DraftTeam, pos: MockPosition): number {
  const starterNeed = state.starters[pos] ?? 0
  if (starterNeed === 0) return 1
  if (countAt(team, pos) < starterNeed) return 1
  const missing = state.teams.some((t) => (t.byPos[pos] ?? 0) < starterNeed)
  return missing ? 0.25 : 1
}

/** Bot temperament: deterministic per (seed, manager), stable personalities per draft. */
interface BotPersona {
  tilt: Record<MockPosition, number>
  jitter: number
}

function botPersona(seed: number, manager: number): BotPersona {
  const rng = mulberry32(seed ^ Math.imul(manager + 1, 0x27d4eb2d))
  const gauss = () => 1 + (rng() - 0.5) * 0.14
  return {
    tilt: { QB: gauss(), RB: gauss(), WR: gauss(), TE: gauss(), K: gauss(), 'D/ST': gauss() },
    jitter: 0.02 + rng() * 0.08,
  }
}

interface RankOptions {
  persona?: BotPersona
  rng?: () => number
}

/**
 * Rank every legal candidate for a manager. Deterministic unless a seeded persona/rng
 * are passed — the coach and the bots share this exact model, the bots just add a
 * personality and a little market noise around it.
 */
function rankCandidates(state: DraftState, manager: number, opts: RankOptions = {}): { player: DraftPoolPlayer; score: number }[] {
  if (state.cursor >= state.order.length) return []
  const team = state.teams[manager]
  const ratio = roundFraction(state)
  const need = startingNeed(state)
  const formatW = FORMAT_WEIGHT[state.settings.scoringFormat] ?? {}

  const candidates: { player: DraftPoolPlayer; score: number }[] = []
  for (const p of state.pool) {
    if (state.pickedIds.has(p.playerId)) continue
    if (!hasOpenSlot(team, p.pos, state.starters, state.settings.rosterSize)) continue
    let score = p.projection * INJURY_GRADE[p.injuryTier] * posWeight(p.pos) * (formatW[p.pos] ?? 1)
    score *= waveScore(p.pos, ratio)
    score *= scarcityFactor(state, p.pos, need)
    score *= runBump(state, p.pos)
    score *= backupGate(state, team, p.pos)
    if (opts.persona) score *= opts.persona.tilt[p.pos]
    if (opts.rng) score *= 1 + (opts.rng() - 0.5) * (opts.persona?.jitter ?? 0.08)
    score += Math.max(0, p.gap) * 0.4
    candidates.push({ player: p, score })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates
}

/**
 * The Draft Coach ranking: candidates for a manager, ordered by how much a measurable
 * drafter would want them at this exact point in the draft. Only players who still fit
 * an open position slot are candidates. Value is projection weighted by position
 * reliability and a scoring-format twist, gated by the round wave and run/scarcity, so
 * the advice matches the flow of the room. The user sees the top N of this exact list.
 */
export function recommend(
  state: DraftState,
  limit = 8,
): DraftPoolPlayer[] {
  if (state.cursor >= state.order.length) return []
  const manager = state.order[state.cursor]
  return rankCandidates(state, manager).slice(0, limit).map((c) => c.player)
}

function makePick(
  state: DraftState,
  player: DraftPoolPlayer,
  manager: number,
): DraftState {
  const picks: DraftPick = {
    slot: state.cursor,
    manager,
    playerId: player.playerId,
    name: player.name,
    pos: player.pos,
    team: player.team,
    projection: player.projection,
    adpRank: player.adpRank,
    posRank: player.posRank,
    injuryTier: player.injuryTier,
    injuryStatus: player.injuryStatus,
  }

  const teams = state.teams.map((t) => {
    if (t.manager !== manager) return t
    return {
      ...t,
      picks: [...t.picks, picks],
      projected: t.projected + player.projection,
      byPos: { ...t.byPos, [player.pos]: countAt(t, player.pos) + 1 },
    }
  })

  const pickedIds = new Set(state.pickedIds)
  pickedIds.add(player.playerId)
  const pool = state.pool.filter((p) => p.playerId !== player.playerId)
  const pickLog = [...state.pickLog, picks]

  return {
    ...state,
    teams,
    pickedIds,
    pool,
    pickLog,
    cursor: state.cursor + 1,
    completed: state.cursor + 1 >= state.order.length,
  }
}

/**
 * Apply a user's explicit choice, or a bot's. Returns a new state; `changed` is false
 * when the draft is over or the player is gone.
 */
export function applyPick(
  state: DraftState,
  player: DraftPoolPlayer,
): DraftResult {
  if (state.completed) return { state, changed: false, error: 'Draft already complete' }
  if (state.pickedIds.has(player.playerId) || !state.pool.some((p) => p.playerId === player.playerId)) {
    return { state, changed: false, error: 'Player already drafted' }
  }
  const manager = state.order[state.cursor]
  const team = state.teams[manager]
  if (!hasOpenSlot(team, player.pos, state.starters, state.settings.rosterSize)) {
    return { state, changed: false, error: `No open ${player.pos} slot on this roster` }
  }
  return { state: makePick(state, player, manager), changed: true }
}

/**
 * Advance the draft to the next human turn, letting the bots fill every slot in
 * between. With `untilUser`, it stops at the user's next pick; otherwise it runs the
 * whole remainder of the board (usable for an "auto-draft me a team" flow).
 *
 * Each bot drafts from the same model the coach shows, but with a deterministic
 * persona and a little jitter drawn from the state seed — two auto-drafts seeded
 * differently will spread differently, and the same seed always reproduces the same
 * board.
 */
export function simulate(
  state: DraftState,
  opts: { untilUser: boolean } = { untilUser: true },
): DraftState {
  let s = state
  while (!s.completed) {
    const manager = s.order[s.cursor]
    if (opts.untilUser && s.teams[manager]?.isUser) break
    // Seeded persona for this manager + jitter keyed to this exact pick slot.
    const persona = botPersona(s.seed, manager)
    const rng = mulberry32(s.seed ^ (s.cursor + 1013) * 1_000_003)
    const ranked = rankCandidates(s, manager, { persona, rng })
    if (ranked.length === 0) {
      // No candidate fits an open slot — drop the turn to keep the board moving
      // (only reachable with a tiny pool or a huge bench favoring K).
      s = { ...s, cursor: s.cursor + 1, completed: s.cursor + 1 >= s.order.length }
      continue
    }
    const res = applyPick(s, ranked[0].player)
    if (!res.changed) {
      s = { ...s, cursor: s.cursor + 1, completed: s.cursor + 1 >= s.order.length }
      continue
    }
    s = res.state
  }
  return s
}

/** Sum of projected points for a manager index. */
export function teamProjection(state: DraftState, manager: number): number {
  const t = state.teams[manager]
  return t?.projected ?? 0
}

/**
 * End-of-draft verdict: how the user's roster projects against the simulated league.
 * Surplus is a points measure: if your picks earned ADPs that were each later than the
 * projection rank, you gained value over a market-priced roster.
 */
export function projectDraftGrade(state: DraftState): {
  total: number
  leagueAvg: number
  rank: number
  grade: string
  valueSurplus: number
  steals: number
} {
  const teams = state.teams.map((t, i) => ({ i, projected: t.projected }))
  const user = teams.find((t) => state.teams[t.i].isUser)
  const total = user?.projected ?? 0
  const leagueAvg = teams.length > 0 ? teams.reduce((s, t) => s + t.projected, 0) / teams.length : 0
  const sorted = [...teams].sort((a, b) => b.projected - a.projected)
  const rank = (user ? sorted.findIndex((t) => t.i === user.i) : -1) + 1

  const userPicks = user ? state.teams[user.i].picks : []
  const valueSurplus = userPicks.reduce((s, p) => s + p.posRank - p.adpRank, 0)
  const steals = userPicks.filter((p) => p.posRank < p.adpRank).length

  let grade = 'C'
  if (total >= leagueAvg * 1.05) grade = 'A'
  else if (total >= leagueAvg * 1.0) grade = 'B'
  else if (total >= leagueAvg * 0.95) grade = 'C'
  else grade = 'D'

  return { total, leagueAvg, rank, grade, valueSurplus, steals }
}