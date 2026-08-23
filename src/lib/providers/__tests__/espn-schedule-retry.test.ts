import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

/**
 * F3: a non-ok /api/schedule self-fetch sub-response must not collapse into
 * `{ events: [] }` — it is retried once, and a persistent failure surfaces as an
 * explicit provider problem (and is not cached as if it were real data).
 */

const calls = new Map<string, number>()
let responder: (url: string, call: number) => Response | Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Minimal event shape; only `id` is load-bearing for dedup.
function event(id: string): Record<string, unknown> {
  return { id, date: '2026-09-05T17:00Z', competitions: [] }
}

vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
  const url = String(input)
  const call = (calls.get(url) ?? 0) + 1
  calls.set(url, call)
  return responder(url, call)
}))

import { fetchTeamSchedule } from '../espn'

beforeEach(() => {
  calls.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('fetchTeamSchedule self-fetch retry', () => {
  it('retries a failed season sub-fetch once and recovers', async () => {
    responder = (url) => (calls.get(url) === 1 ? jsonResponse({ events: [] }, 500) : jsonResponse({ events: [event('e1')] }))
    const { events } = await fetchTeamSchedule('NFL', 'retryok', 'ROK', 'http://unit.test')
    const seasonUrl = 'http://unit.test/api/schedule?sport=NFL&team=ROK&season=2025'
    expect(calls.get(seasonUrl)).toBe(2)
    expect(events.some((e) => e.id === 'e1')).toBe(true)
  })

  it('surfaces a persistent failure as a provider problem instead of empty-ok data', async () => {
    responder = () => jsonResponse({ events: [] }, 500)
    const { events, problems } = await fetchTeamSchedule('NFL', 'retrybad', 'RBD', 'http://unit.test')
    expect(events).toHaveLength(0)
    expect(problems.join('; ')).toContain('failed after retry')
    // Both attempts happened before giving up.
    const seasonUrl = 'http://unit.test/api/schedule?sport=NFL&team=RBD&season=2025'
    expect(calls.get(seasonUrl)).toBe(2)
  })

  it('does not cache a failed-empty result, so the next poll refetches fresh', async () => {
    responder = () => jsonResponse({ events: [] }, 500)
    await fetchTeamSchedule('NFL', 'nocache', 'NCH', 'http://unit.test')
    const firstPass = calls.get('http://unit.test/api/schedule?sport=NFL&team=NCH&season=2025') ?? 0

    await fetchTeamSchedule('NFL', 'nocache', 'NCH', 'http://unit.test')
    const secondPass = calls.get('http://unit.test/api/schedule?sport=NFL&team=NCH&season=2025') ?? 0
    expect(secondPass).toBeGreaterThan(firstPass)
  })

  it('a genuine empty response with no problems is still cached normally', async () => {
    responder = () => jsonResponse({ events: [] })
    await fetchTeamSchedule('NFL', 'cacheok', 'COK', 'http://unit.test')
    const afterFirst = calls.get('http://unit.test/api/schedule?sport=NFL&team=COK&season=2025') ?? 0
    expect(afterFirst).toBe(1)

    await fetchTeamSchedule('NFL', 'cacheok', 'COK', 'http://unit.test')
    expect(calls.get('http://unit.test/api/schedule?sport=NFL&team=COK&season=2025')).toBe(1)
  })
})
