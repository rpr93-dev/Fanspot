import { describe, it, expect } from 'vitest'
import {
  buildDraftPool,
  createDraft,
  recommend,
  applyPick,
  simulate,
  snakeOrder,
  positionCapacity,
  projectDraftGrade,
  DEFAULT_STARTERS,
} from '../mock-draft'
import type { MockDraftSettings, DraftPoolPlayer } from '../mock-draft'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

let nextId = 1

/** Minimal player shaped the way buildDraftPool reads it. */
function player(
  over: {
    name?: string
    pos?: string
    proj?: number
    adp?: number
    team?: string
    injuryStatus?: string
    injured?: boolean
    active?: boolean
  } = {},
): FantasyPlayerEnriched {
  const id = nextId++
  const proj = over.proj ?? 100
  return {
    id,
    name: over.name ?? `Player ${id}`,
    proTeamAbbr: over.team ?? 'NE',
    normalizedPosition: over.pos ?? 'RB',
    projection: { points: proj, stats: {} },
    // A player with no published ADP has no rank at all.
    pprRank: over.adp,
    adpSource: over.adp == null ? 'espn' : 'espn',
    player: {
      id,
      fullName: over.name ?? `Player ${id}`,
      injuryStatus: over.injuryStatus,
      injured: over.injured ?? false,
      active: over.active ?? true,
    },
  } as unknown as FantasyPlayerEnriched
}

/**
 * A position pool where the best player also has the best ADP: `rank` runs 1..count in
 * the same order as projection, so a sane draft would simply take them top-down.
 */
function pool(pos: string, count: number, top: number, step: number): FantasyPlayerEnriched[] {
  return Array.from({ length: count }, (_, i) =>
    player({ pos, proj: top - i * step, adp: i + 1, name: `${pos}${i + 1}` }),
  )
}

/** A 12-team-shaped league: plenty of everything, kickers & defenses pushed deep. */
function fullLeague(): FantasyPlayerEnriched[] {
  return [
    ...pool('QB', 40, 400, 5),
    ...pool('RB', 80, 320, 3),
    ...pool('WR', 100, 280, 2),
    ...pool('TE', 40, 200, 4),
    ...pool('K', 30, 140, 2),
    ...pool('D/ST', 32, 130, 2),
  ]
}

const settings: MockDraftSettings = {
  teams: 12,
  pick: 1,
  rosterSize: 16,
  scoringFormat: 'ppr',
  adpPlatform: 'espn',
  starters: DEFAULT_STARTERS,
}

function draftPool(): DraftPoolPlayer[] {
  return buildDraftPool(fullLeague(), settings)
}

describe('snakeOrder', () => {
  it('wraps the round at the table edges', () => {
    const order = snakeOrder(4, 2)
    expect(order.slice(0, 8)).toEqual([0, 1, 2, 3, 3, 2, 1, 0])
  })

  it('has one slot per manager per round', () => {
    expect(snakeOrder(12, 16).length).toBe(192)
  })
})

describe('buildDraftPool', () => {
  it('computes posRank, adpRank and gap per position', () => {
    nextId = 1
    const pool = buildDraftPool(fullLeague(), settings)
    const rbs = pool.filter((p) => p.pos === 'RB').sort((a, b) => a.posRank - b.posRank)
    expect(rbs[0]?.name).toBe('RB1')
    expect(rbs[0]?.posRank).toBe(1)
    expect(rbs[0]?.adpRank).toBe(1)
    expect(rbs[0]?.gap).toBe(0)
    expect(rbs[rbs.length - 1]?.posRank).toBe(80)
    expect(rbs[rbs.length - 1]?.adpRank).toBe(80)
  })

  it('flags players who are falling past their projection rank', () => {
    nextId = 1
    // 5 RBs projected 300..280, ADP matching. Falling is projected 3rd but is the
    // 6th off the board — the classic steal shape.
    const league = [
      player({ pos: 'RB', proj: 300, adp: 1, name: 'RB1' }),
      player({ pos: 'RB', proj: 295, adp: 2, name: 'RB2' }),
      player({ pos: 'RB', proj: 290, adp: 6, name: 'Falling' }),
      player({ pos: 'RB', proj: 285, adp: 4, name: 'RB4' }),
      player({ pos: 'RB', proj: 280, adp: 5, name: 'RB5' }),
    ]
    const built = buildDraftPool(league, settings)
    const falling = built.find((p) => p.name === 'Falling')!
    expect(falling.posRank).toBe(3)
    // ADPs are 1,2,4,5,6 → a rank-5 number against the rest of the board.
    expect(falling.adpRank).toBe(5)
    expect(falling.gap).toBe(2)
  })

  it('drops inactive, zero-projection and unranked players', () => {
    nextId = 1
    const league = [
      player({ pos: 'QB', proj: 0, adp: 5, name: 'Zero' }),
      player({ pos: 'QB', proj: 300, adp: 5, active: false, name: 'Retired' }),
      player({ pos: 'QB', proj: 300, name: 'NoRank' }),
      ...fullLeague(),
    ]
    const built = buildDraftPool(league, settings)
    expect(built.some((p) => p.name === 'Zero')).toBe(false)
    expect(built.some((p) => p.name === 'Retired')).toBe(false)
    expect(built.some((p) => p.name === 'NoRank')).toBe(false)
    expect(built.some((p) => p.name === 'QB1')).toBe(true)
  })

  it('keeps free agents out of the mock draft pool', () => {
    nextId = 1
    const league = [
      player({ pos: 'QB', proj: 320, adp: 2, team: 'FA', name: 'FreeAgentFlier' }),
      player({ pos: 'QB', proj: 310, adp: 3, team: '', name: 'NoTeamShell' }),
      ...pool('QB', 12, 400, 5),
    ]
    const built = buildDraftPool(league, settings)
    expect(built.some((p) => p.name === 'FreeAgentFlier')).toBe(false)
    expect(built.some((p) => p.name === 'NoTeamShell')).toBe(false)
  })

  it('carries the injury tier onto every pool row so the room can warn on it', () => {
    nextId = 1
    const league = [
      player({ pos: 'QB', proj: 380, adp: 1, injuryStatus: 'QUESTIONABLE', injured: true, name: 'Hurt QB' }),
      ...pool('QB', 12, 400, 5),
    ]
    const built = buildDraftPool(league, settings)
    const qb = built.find((p) => p.name === 'Hurt QB')!
    expect(qb).toBeDefined()
    expect(qb.injuryTier).toBe('questionable')
    expect(qb.injuryStatus).toBe('QUESTIONABLE')
  })
})

describe('createDraft + applyPick', () => {
  it('snakes to the user when pick 1 leads the room', () => {
    const state = createDraft(draftPool(), settings)
    expect(state.teams[0].isUser).toBe(true)
    expect(state.order[0]).toBe(0)
    expect(state.completed).toBe(false)
  })

  it('reflects picks back onto the team and pushes the cursor forward', () => {
    const state = createDraft(draftPool(), settings)
    const [top] = recommend(state, 1)
    const { state: next, changed } = applyPick(state, top)
    expect(changed).toBe(true)
    expect(next.teams[0].picks).toHaveLength(1)
    expect(next.teams[0].byPos[top.pos]).toBe(1)
    expect(next.cursor).toBe(1)
  })

  it('rejects drafting a player twice', () => {
    const state = createDraft(draftPool(), settings)
    const [top] = recommend(state, 1)
    const { state: next } = applyPick(state, top)
    const { changed, error } = applyPick(next, top)
    expect(changed).toBe(false)
    expect(error).toMatch(/already drafted/)
  })

  it('rejects a pick with no open slot at the position', () => {
    // Two teams, two rounds, but the QB pool has a spare third QB: on round two a team
    // has already locked its lone QB slot and must be told the QB1 taken is theirs.
    nextId = 1
    const league = [...pool('QB', 3, 400, 5), ...pool('RB', 1, 300, 0)]
    const built = buildDraftPool(league, settings)
    const two = { ...settings, teams: 2, rosterSize: 2 }
    let state = createDraft(built, two)
    // Round 1: team 0 and team 1 each take a QB.
    const [qb1] = recommend(state, 1)
    state = applyPick(state, qb1).state
    const [qb2] = recommend(state, 1)
    state = applyPick(state, qb2).state
    // Round 2 starts with team 1 (snake wraps); its QB slot is full, so the leftover
    // QB must be rejected with a position error, not silently accepted.
    const leftover = state.pool.find((p) => p.pos === 'QB')!
    const { changed, error } = applyPick(state, leftover)
    expect(changed).toBe(false)
    expect(error).toMatch(/No open QB slot/)
  })
})

describe('INJURY_GRADE penalties in recommend', () => {
  it('prefers the healthy player over a questionable one when otherwise equal', () => {
    nextId = 1
    // Same projection and same ADP, so only the health tag can separate them.
    const league = [
      player({ pos: 'QB', proj: 300, adp: 2, injuryStatus: 'QUESTIONABLE', injured: true, name: 'Hurt' }),
      player({ pos: 'QB', proj: 300, adp: 2, name: 'Fit' }),
    ]
    const built = buildDraftPool(league, settings)
    const state = createDraft(built, settings)
    const [top] = recommend(state, 1)
    expect(top.name).toBe('Fit')
  })

  it('drafts the market\'s ADP-1 player first even when questionable', () => {
    nextId = 1
    // The ADP anchor reproduces real drafts: the ADP-1 QB is taken first overall
    // despite a questionable tag — a healthy lesser QB doesn't jump ahead of him.
    const league = [
      player({ pos: 'QB', proj: 300, adp: 1, injuryStatus: 'QUESTIONABLE', injured: true, name: 'Hurt' }),
      player({ pos: 'QB', proj: 290, adp: 2, name: 'Fit' }),
    ]
    const built = buildDraftPool(league, settings)
    const state = createDraft(built, settings)
    const [top] = recommend(state, 1)
    expect(top.name).toBe('Hurt')
  })

  it('still keeps Doubtful players rankable but behind healthy equals', () => {
    nextId = 1
    const league = [
      player({ pos: 'QB', proj: 300, adp: 1, injuryStatus: 'DOUBTFUL', injured: true, name: 'BangedUp' }),
      player({ pos: 'QB', proj: 250, adp: 2, name: 'HealthyAlt' }),
    ]
    const built = buildDraftPool(league, settings)
    const state = createDraft(built, settings)
    const [top] = recommend(state, 1)
    // Doubtful: 300 × 0.6 = 180 grade < HealthyAlt 250, so HealthyAlt wins outright.
    expect(top.name).toBe('HealthyAlt')
  })
})

describe('positionCapacity', () => {
  it('grants at least the required starters, plus bench depth on top', () => {
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'QB')).toBeGreaterThanOrEqual(DEFAULT_STARTERS.QB)
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'K')).toBeGreaterThanOrEqual(DEFAULT_STARTERS.K)
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'D/ST')).toBeGreaterThanOrEqual(DEFAULT_STARTERS['D/ST'])
  })

  it('keeps skill positions at their starter count plus flex share', () => {
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'RB')).toBeGreaterThan(DEFAULT_STARTERS.RB)
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'WR')).toBeGreaterThan(DEFAULT_STARTERS.WR)
    expect(positionCapacity(DEFAULT_STARTERS, 16, 'TE')).toBeGreaterThanOrEqual(DEFAULT_STARTERS.TE)
  })

  it('sizes every position so the caps add up to the roster', () => {
    const total = (['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const).reduce(
      (s, pos) => s + positionCapacity(DEFAULT_STARTERS, 16, pos),
      0,
    )
    expect(total).toBe(16)
  })

  it('frees bench spots when starters are dropped', () => {
    const noK = { ...DEFAULT_STARTERS, K: 0 }
    const total = (['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const).reduce(
      (s, pos) => s + positionCapacity(noK, 16, pos),
      0,
    )
    expect(total).toBe(16) // caps always sum to the roster
    // No required kickers, but bench is anything-goes: kickers may still hitch a bench
    // seat, they just no longer guarantee one.
    expect(positionCapacity(noK, 16, 'K')).toBeGreaterThanOrEqual(0)
  })

  it('supports heavy flex lineups', () => {
    const twoFlex = { ...DEFAULT_STARTERS, FLEX: 3, RB: 2, WR: 2 }
    const total = (['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const).reduce(
      (s, pos) => s + positionCapacity(twoFlex, 16, pos),
      0,
    )
    expect(total).toBe(16)
    expect(positionCapacity(twoFlex, 16, 'RB')).toBeGreaterThanOrEqual(2)
    expect(positionCapacity(twoFlex, 16, 'WR')).toBeGreaterThanOrEqual(2)
  })
})

describe('simulate', () => {
  it('runs a full draft to completion: every one of the 192 slots drafts a player', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    expect(state.completed).toBe(true)
    expect(state.pickLog).toHaveLength(192)
    for (const team of state.teams) {
      expect(team.picks).toHaveLength(16)
    }
  })

  it('halts at the user turn', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: true })
    expect(state.completed).toBe(false)
    const manager = state.order[state.cursor]
    expect(state.teams[manager].isUser).toBe(true)
  })

  it('stocks a balanced, startable team for every manager', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    for (const team of state.teams) {
      expect(team.picks).toHaveLength(settings.rosterSize)
      expect(team.byPos.QB ?? 0).toBeGreaterThanOrEqual(1)
      expect(team.byPos.K ?? 0).toBeGreaterThanOrEqual(1)
      expect(team.byPos['D/ST'] ?? 0).toBeGreaterThanOrEqual(1)
      expect(team.byPos.RB ?? 0).toBeGreaterThanOrEqual(DEFAULT_STARTERS.RB)
      expect(team.byPos.WR ?? 0).toBeGreaterThanOrEqual(DEFAULT_STARTERS.WR)
      expect(team.byPos.TE ?? 0).toBeGreaterThanOrEqual(DEFAULT_STARTERS.TE)
    }
  })

  it('never drafts the same player twice across the league', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    const ids = state.pickLog.map((p) => p.playerId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never loads a roster with a second kicker or defense', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    for (const team of state.teams) {
      expect(team.byPos.K ?? 0).toBeLessThanOrEqual(1)
      expect(team.byPos['D/ST'] ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it('gates backup QBs: nobody grabs a second QB while a team still lacks a starter', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    const counts = new Map<number, number>()
    for (const pick of state.pickLog) {
      if (pick.pos !== 'QB') continue
      counts.set(pick.manager, (counts.get(pick.manager) ?? 0) + 1)
      if (counts.get(pick.manager)! >= 2) {
        // By the time anyone takes QB #2, every team must already have their QB1.
        for (const team of state.teams) {
          expect(team.byPos.QB ?? 0).toBeGreaterThanOrEqual(1)
        }
        break
      }
    }
  })

  it('seeded drafts are deterministic: same seed reproduces the same board', () => {
    const pool = draftPool()
    const a = simulate(createDraft(pool, settings, undefined, 4242), { untilUser: false })
    const b = simulate(createDraft(pool, settings, undefined, 4242), { untilUser: false })
    expect(a.pickLog.map((p) => p.playerId)).toEqual(b.pickLog.map((p) => p.playerId))
  })

  it('different seeds spread different drafts', () => {
    const pool = draftPool()
    const a = simulate(createDraft(pool, settings, undefined, 1001), { untilUser: false })
    const b = simulate(createDraft(pool, settings, undefined, 2002), { untilUser: false })
    expect(a.pickLog.map((p) => p.playerId)).not.toEqual(b.pickLog.map((p) => p.playerId))
  })

  it('drafts that share a seed do not drift across separate simulate calls', () => {
    const pool = draftPool()
    const base = createDraft(pool, settings, undefined, 777)
    const one = simulate(base, { untilUser: false })
    const two = simulate(createDraft(pool, settings, undefined, 777), { untilUser: false })
    expect(one.pickLog.map((p) => p.playerId)).toEqual(two.pickLog.map((p) => p.playerId))
  })
})

describe('projectDraftGrade', () => {
  it('scores the user roster against the league average', () => {
    const state = simulate(createDraft(draftPool(), settings), { untilUser: false })
    const grade = projectDraftGrade(state)
    expect(grade.rank).toBeGreaterThanOrEqual(1)
    expect(grade.rank).toBeLessThanOrEqual(12)
    expect(grade.leagueAvg).toBeGreaterThan(0)
    expect(['A', 'B', 'C', 'D']).toContain(grade.grade)
  })
})
describe('ADP-anchored market timing (real-data validated)', () => {
  it('keeps a high-projection, far-ahead-of-ADP player off the early board', () => {
    nextId = 1
    // A QB projects like a star (ESPN full-season totals) but the market prices him
    // 40+ picks later. The exponential reach penalty must keep him off the early
    // board — real drafts don't reach 40 picks for a projection alone.
    const league = [
      player({ pos: 'QB', proj: 340, adp: 45, name: 'Fallback QB' }),
      ...pool('QB', 12, 400, 3),
      ...pool('RB', 40, 320, 3),
      ...pool('WR', 48, 300, 2),
      ...pool('TE', 20, 220, 2),
    ]
    const built = buildDraftPool(league, settings)
    const state = createDraft(built, settings)
    const top = recommend(state, 6)
    expect(top.some((p) => p.name === 'Fallback QB')).toBe(false)
  })

  it('does not draft backup QBs mid-draft even when they project like starters', () => {
    nextId = 1
    // 12 starter QBs at ADP 1-12, then 12 "backup" QBs whose ESPN projections are
    // nearly starter-level (full-season totals) but whose ADP is rounds 5-6.
    const qbs = [
      ...Array.from({ length: 12 }, (_, i) => player({ pos: 'QB', proj: 400 - i * 3, adp: i + 1, name: `QB${i + 1}` })),
      ...Array.from({ length: 12 }, (_, i) => player({ pos: 'QB', proj: 350 - i * 3, adp: 60 + i, name: `QBB${i + 1}` })),
    ]
    const league = [
      ...qbs,
      ...pool('RB', 60, 320, 3),
      ...pool('WR', 60, 300, 2),
      ...pool('TE', 24, 220, 2),
      ...pool('K', 12, 140, 0),
      ...pool('D/ST', 12, 130, 0),
    ]
    const built = buildDraftPool(league, settings)
    const state = simulate(createDraft(built, settings), { untilUser: false })
    // Find the first pick that is a manager's SECOND QB.
    const firstBackup = state.pickLog.findIndex((p, i) => {
      const already = state.pickLog.slice(0, i).filter((x) => x.manager === p.manager && x.pos === 'QB').length
      return p.pos === 'QB' && already >= 1
    })
    // Round 8 (pick 96) at the earliest — backups are a late-round market.
    expect(firstBackup).toBeGreaterThanOrEqual(96)
  })
})
