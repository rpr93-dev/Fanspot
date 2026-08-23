import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSleeperPlayers } from '../sleeper'
import { SLEEPER_BASE, SLEEPER_PLAYERS_TTL_MS } from '../fantasy-constants'

const mockPlayers = {
  '12345': { player_id: '12345', first_name: 'Patrick', last_name: 'Mahomes', full_name: 'Patrick Mahomes', position: 'QB', fantasy_positions: ['QB'], espn_id: 2580, yahoo_id: 1, rotowire_id: 1, team: 'KC', age: 28, years_exp: 7, injury_status: 'ACTIVE', search_rank: 1 },
  '67890': { player_id: '67890', first_name: 'Travis', last_name: 'Kelce', full_name: 'Travis Kelce', position: 'TE', fantasy_positions: ['TE'], espn_id: 2581, yahoo_id: 2, rotowire_id: 2, team: 'KC', age: 34, years_exp: 11, injury_status: 'ACTIVE', search_rank: 2 },
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getSleeperPlayers', () => {
  it('fetches and caches players', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPlayers),
    } as Response)

    const result = await getSleeperPlayers('nfl')
    expect(Object.keys(result).length).toBe(2)
    expect(result['12345'].full_name).toBe('Patrick Mahomes')

    const result2 = await getSleeperPlayers('nfl')
    expect(result2).toBe(result)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('TTL expiry triggers re-fetch', async () => {
    const mockFetch = vi.fn()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlayers),
    } as Response)

    global.fetch = mockFetch

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SLEEPER_PLAYERS_TTL_MS + 1000)

    await getSleeperPlayers('nfl')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('fetch error returns stale cache when available', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlayers),
    } as Response)

    await getSleeperPlayers('nfl')

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const result = await getSleeperPlayers('nfl')
    expect(Object.keys(result).length).toBe(2)
  })

  it('malformed response returns {} not throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('not-an-object'),
    } as Response)

    const result = await getSleeperPlayers('nba')
    expect(result).toEqual({})
  })
})

