import { describe, it, expect } from 'vitest'
import {
  applyInjuryGate,
  composeNote,
  detectSevereLanguage,
  resolveInjuryTier,
  DOUBTFUL_RANK_FLOOR,
} from '../injury-gate'
import type { StealRow } from '../steal-engine'

function row(over: Partial<StealRow> = {}): StealRow {
  return {
    playerId: 1,
    name: 'Test Player',
    pos: 'WR',
    team: 'KC',
    posRank: 20,
    adpRank: 40,
    gap: 20,
    adpSource: 'espn',
    conf: 70,
    ownedPct: 50,
    note: '',
    posPoolSize: 100,
    projectedPoints: 150,
    overallAdp: 120,
    injuryTier: 'healthy',
    injuryStatus: 'ACTIVE',
    gateApplied: false,
    confidenceDriver: '120 FP last season',
    ...over,
  }
}

describe('resolveInjuryTier', () => {
  it('maps ESPN designations to tiers', () => {
    expect(resolveInjuryTier({ espnStatus: 'ACTIVE' }).tier).toBe('healthy')
    expect(resolveInjuryTier({ espnStatus: 'QUESTIONABLE' }).tier).toBe('questionable')
    expect(resolveInjuryTier({ espnStatus: 'DOUBTFUL' }).tier).toBe('doubtful')
    expect(resolveInjuryTier({ espnStatus: 'OUT' }).tier).toBe('out')
    expect(resolveInjuryTier({ espnStatus: 'INJURY_RESERVE' }).tier).toBe('severe')
  })

  it('upgrades an under-reported ESPN tier from the structured injury detail', () => {
    // The real Tyreek Hill case: ESPN said Questionable, Sleeper carried the ACL detail.
    const resolved = resolveInjuryTier({
      espnStatus: 'QUESTIONABLE',
      sleeperStatus: 'Questionable',
      bodyPart: 'Knee - ACL',
      notes: 'Surgery',
    })
    expect(resolved.tier).toBe('severe')
    expect(resolved.source).toBe('sleeper-detail')
    expect(resolved.detail).toContain('ACL')
  })

  it('treats a bare injured flag as questionable, not severe', () => {
    expect(resolveInjuryTier({ espnStatus: 'ACTIVE', espnInjured: true }).tier).toBe('questionable')
  })

  it('separates a reported clean status from no report at all', () => {
    expect(resolveInjuryTier({ espnStatus: 'ACTIVE' }).designationKnown).toBe(true)
    expect(resolveInjuryTier({ sleeperStatus: 'Questionable' }).designationKnown).toBe(true)
    // Both still land on `healthy`, so the tier alone cannot tell these apart.
    expect(resolveInjuryTier({}).designationKnown).toBe(false)
    expect(resolveInjuryTier({ espnStatus: '' }).designationKnown).toBe(false)
    expect(resolveInjuryTier({ espnStatus: 'unknown' }).designationKnown).toBe(false)
    expect(resolveInjuryTier({ espnStatus: 'unknown' }).tier).toBe('healthy')
  })

  it('flags a suspension from any provider without calling it an injury', () => {
    for (const s of [
      { espnStatus: 'SUSPENDED' },
      { sleeperStatus: 'Sus' },
      { rosterStatus: 'Suspended' },
    ]) {
      const r = resolveInjuryTier(s)
      expect(r.suspended).toBe(true)
      // A suspended player is often perfectly healthy, so the tier must not move.
      expect(r.tier).toBe('healthy')
      expect(r.designationKnown).toBe(true)
    }
    expect(resolveInjuryTier({ espnStatus: 'ACTIVE' }).suspended).toBe(false)
  })

  it('catches an IR placement that only Sleeper roster status knows about', () => {
    // The live feed carries players ESPN still lists ACTIVE with no injury_status at all.
    const r = resolveInjuryTier({
      espnStatus: 'ACTIVE',
      sleeperStatus: undefined,
      rosterStatus: 'Injured Reserve',
    })
    expect(r.tier).toBe('severe')
  })

  it('does not treat an uninterpretable code as a clearance', () => {
    expect(resolveInjuryTier({ espnStatus: 'DNR' }).designationKnown).toBe(false)
    expect(resolveInjuryTier({ sleeperStatus: 'NA' }).designationKnown).toBe(false)
  })
})

describe('detectSevereLanguage', () => {
  it('flags season-ending language', () => {
    expect(detectSevereLanguage('Star WR suffers torn ACL, out for the season')).toBeTruthy()
    expect(detectSevereLanguage('RB placed on injured reserve')).toBeTruthy()
    expect(detectSevereLanguage('QB has no timetable for return')).toBeTruthy()
  })

  it('ignores routine coverage', () => {
    expect(detectSevereLanguage('WR posts big numbers in camp')).toBeNull()
    expect(detectSevereLanguage(undefined)).toBeNull()
  })

  it('lets recovery language clear soft signals but never a structural tear', () => {
    expect(detectSevereLanguage('Cleared to play after offseason surgery')).toBeNull()
    expect(detectSevereLanguage('Torn ACL recovery: cleared for full participant work')).toBeTruthy()
  })
})

describe('applyInjuryGate', () => {
  it('keeps a severe-injury player out of the board no matter how high the raw score', async () => {
    const ranked = [
      row({ playerId: 1, name: 'Wrecked Star', gap: 92, injuryTier: 'severe', injuryDetail: 'Knee - ACL' }),
      ...Array.from({ length: 15 }, (_, i) => row({ playerId: 100 + i, name: `Healthy ${i}`, gap: 20 - i })),
    ]

    const { board, injuryWatch } = await applyInjuryGate(ranked, { sport: 'nfl' })

    expect(board.some((r) => r.name === 'Wrecked Star')).toBe(false)
    expect(injuryWatch.map((r) => r.name)).toEqual(['Wrecked Star'])
    expect(injuryWatch[0].gateApplied).toBe(true)
    expect(injuryWatch[0].gateReason).toBe('severe-injury')
    // Not silently dropped: still carries its earned rank for the UI.
    expect(injuryWatch[0].rankByGap).toBe(1)
  })

  it('holds a doubtful player out of the top 10 without removing them', async () => {
    const ranked = [
      row({ playerId: 1, name: 'Doubtful Star', gap: 90, injuryTier: 'doubtful', injuryDetail: 'Hamstring' }),
      ...Array.from({ length: 15 }, (_, i) => row({ playerId: 100 + i, name: `Healthy ${i}`, gap: 20 - i })),
    ]

    const { board } = await applyInjuryGate(ranked, { sport: 'nfl' })

    const idx = board.findIndex((r) => r.name === 'Doubtful Star')
    expect(idx).toBeGreaterThanOrEqual(DOUBTFUL_RANK_FLOOR)
    expect(board[idx].gateApplied).toBe(true)
    expect(board[idx].gateReason).toBe('doubtful-rank-floor')
  })

  it('upgrades an under-reported tier from headlines and gates on it', async () => {
    const ranked = [row({ playerId: 1, name: 'Hidden Injury', gap: 80, injuryTier: 'questionable' })]

    const { board, injuryWatch } = await applyInjuryGate(ranked, {
      sport: 'nfl',
      fetchHeadlines: async () => ['Hidden Injury to miss the season after torn Achilles'],
    })

    expect(board).toHaveLength(0)
    expect(injuryWatch[0].injuryTier).toBe('severe')
    expect(injuryWatch[0].injurySource).toBe('headlines')
  })

  it('holds a suspended player off the board however large the gap', async () => {
    const ranked = [
      row({ playerId: 1, name: 'Banned', gap: 99, suspended: true }),
      row({ playerId: 2, name: 'Fine', gap: 10 }),
    ]

    const { board, injuryWatch } = await applyInjuryGate(ranked, { sport: 'nfl' })

    expect(board.map((r) => r.playerId)).toEqual([2])
    expect(injuryWatch[0].playerId).toBe(1)
    expect(injuryWatch[0].gateReason).toBe('suspended')
  })

  it('does not spend a headline lookup on a suspended player', async () => {
    const checked: string[] = []
    await applyInjuryGate([row({ playerId: 1, name: 'Banned', suspended: true })], {
      sport: 'nfl',
      fetchHeadlines: async (name) => {
        checked.push(name)
        return []
      },
    })
    expect(checked).toEqual([])
  })

  it('only cross-checks the top of the leaderboard', async () => {
    const checked: string[] = []
    const ranked = Array.from({ length: 40 }, (_, i) => row({ playerId: i, name: `P${i}`, gap: 40 - i }))

    const { board } = await applyInjuryGate(ranked, {
      sport: 'nfl',
      crossCheckTop: 5,
      fetchHeadlines: async (name) => {
        checked.push(name)
        return []
      },
    })

    expect(checked).toHaveLength(5)
    // Rows past the cutoff had no verification, so their notes must not imply any.
    expect(board.filter((r) => r.injuryChecked)).toHaveLength(5)
    expect(board[39].injuryChecked).toBe(false)
    expect(board[39].note).toContain('recent headlines were not checked')
    expect(board[0].note).toContain('headline cross-check found no severe-injury language')
  })

  it('survives a failing headline fetch', async () => {
    const ranked = [row({ playerId: 1, name: 'Fine' })]
    const { board } = await applyInjuryGate(ranked, {
      sport: 'nfl',
      fetchHeadlines: async () => {
        throw new Error('upstream down')
      },
    })
    expect(board).toHaveLength(1)
    expect(board[0].injuryTier).toBe('healthy')
    // A failed lookup is not a clean result.
    expect(board[0].injuryChecked).toBe(false)
    expect(board[0].note).not.toContain('headline cross-check found no severe-injury language')
  })
})

describe('composeNote', () => {
  it('leads with a severe injury', () => {
    const note = composeNote(row({ injuryTier: 'severe', injuryDetail: 'Knee - ACL', gap: 92 }))
    expect(note).toBe('Severe injury (Knee - ACL) — excluded from main board, moved to the watch list.')
  })

  it('leads with doubtful over the ADP gap', () => {
    const note = composeNote(row({ injuryTier: 'doubtful', injuryDetail: 'knee', rankByGap: 3 }))
    expect(note).toBe('Ranked #3 by ADP-gap, but tagged Doubtful (knee) — treat as a hold, not a steal.')
  })

  it('frames out as week-specific rather than season-long', () => {
    const note = composeNote(row({ injuryTier: 'out', rankByGap: 5 }))
    expect(note).toContain('week-specific')
    expect(note).not.toContain('watch list')
  })

  it('describes a suspension as an availability problem, not an injury', () => {
    const note = composeNote(row({ suspended: true, gap: 30 }))
    expect(note).toContain('Suspended')
    expect(note).not.toContain('injury')
    expect(note).not.toContain('Injury')
  })

  it('leads with a suspension even when the player is otherwise healthy', () => {
    const note = composeNote(row({ suspended: true, injuryTier: 'healthy', gap: 12 }))
    expect(note).not.toContain('listed active')
    expect(note).not.toContain('projection at')
  })

  it('falls back to gap direction then confidence driver when healthy', () => {
    const note = composeNote(
      row({ pos: 'RB', posRank: 2, adpRank: 4, gap: 2, confidenceDriver: '210 FP last season' }),
    )
    expect(note).toBe(
      'Falling past projected value — RB2 projection at RB4 price — listed active, though recent headlines were not checked. 210 FP last season.',
    )
  })

  it('never claims a player has no injury concerns', () => {
    for (const r of [
      row({ gap: 2 }),
      row({ gap: 2, injuryChecked: true }),
      row({ gap: 2, injuryDesignationKnown: false }),
    ]) {
      expect(composeNote(r)).not.toContain('no injury concerns')
    }
  })

  it('only claims the headline cross-check found no severe language when it actually ran', () => {
    expect(composeNote(row({ gap: 2, injuryChecked: true }))).toContain(
      'headline cross-check found no severe-injury language',
    )
    expect(composeNote(row({ gap: 2, injuryChecked: false }))).toContain(
      'recent headlines were not checked',
    )
  })

  it('says nothing was reported when no provider gave a designation', () => {
    const note = composeNote(row({ gap: 2, injuryDesignationKnown: false, injuryChecked: true }))
    expect(note).toContain('no injury status reported either way')
    expect(note).not.toContain('listed active')
  })

  it('describes a negative gap as a reach', () => {
    const note = composeNote(row({ pos: 'WR', posRank: 40, adpRank: 20, gap: -20 }))
    expect(note).toContain('Going ahead of projection')
  })
})
