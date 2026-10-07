import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildMatchContext } from '@/lib/fantasy/player-matching-engine'
import { enrichFromEspn } from '@/lib/fantasy/enrichers/espn-enricher'
import type { CanonicalPlayer } from '@/lib/fantasy/player-types'

/**
 * Regression: one ESPN row with no `stats` array used to throw
 * ("Cannot read properties of undefined (reading 'filter')") inside the
 * enrichment loop, failing the whole unified-DB build — which emptied
 * /api/props projections and 500'd team-outlook, gating the Prop Model off
 * so it never loaded in the game hub.
 */

const canon = (espnId: number, fullName: string): CanonicalPlayer => ({
  sleeperId: `sleeper-${espnId}`,
  espnId,
  fullName,
  firstName: fullName.split(' ')[0],
  lastName: fullName.split(' ').slice(1).join(' '),
  position: 'QB',
  team: 'BUF',
  rookie: false,
  active: true,
})

const espnPlayer = (id: number, fullName: string, withStats: boolean) => ({
  id,
  player: {
    id,
    firstName: fullName.split(' ')[0],
    lastName: fullName.split(' ').slice(1).join(' '),
    fullName,
    defaultPositionId: 1,
    proTeamId: 2,
    active: true,
    injured: false,
    injuryStatus: 'ACTIVE',
    droppable: true,
    eligibleSlots: [1],
    jersey: '17',
    ownership: { averageDraftPosition: 10, percentOwned: 99, percentStarted: 90, auctionValueAverage: 40, activityLevel: 100 },
    draftRanksByRankType: { PPR: { rank: 10, auctionValue: 40, rankType: 'PPR' } },
    ...(withStats
      ? {
          stats: [
            { statSourceId: 1, statSplitTypeId: 0, seasonId: 2026, appliedTotal: 4000, appliedAverage: 235, stats: { 3: 4000 } },
            { statSourceId: 0, statSplitTypeId: 0, seasonId: 2025, appliedTotal: 3800, appliedAverage: 224, stats: { 3: 3800 } },
          ],
        }
      : {}),
  },
  ratings: {},
  draftAuctionValue: 40,
  onTeamId: 0,
  keeperValue: 0,
  keeperValueFuture: 0,
  status: '',
})

describe('enrichFromEspn with statless ESPN rows', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips the missing stats array instead of failing the whole build', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          players: [
            espnPlayer(1001, 'Josh Allen', true),
            // Simulates the production row that crashed the build: no `stats` key at all.
            espnPlayer(1002, 'Statless Player', false),
          ],
        }),
      })),
    )

    const players = [canon(1001, 'Josh Allen'), canon(1002, 'Statless Player')]
    const master = {
      players,
      bySleeperId: new Map(players.map((p) => [p.sleeperId, p])),
      byEspnId: new Map(players.map((p) => [p.espnId as number, p])),
      byGsisId: new Map<string, CanonicalPlayer>(),
      byPfrId: new Map<string, CanonicalPlayer>(),
    }
    const ctx = buildMatchContext(master)

    const result = await enrichFromEspn(ctx, 2026)
    expect(result.totalFetched).toBe(2)
    // Both players still enrich (the statless one falls back to a zero-point projection).
    expect(result.matchedCount).toBe(2)
    expect(result.projections.get('sleeper-1002')?.projection.points).toBe(0)
  })
})
