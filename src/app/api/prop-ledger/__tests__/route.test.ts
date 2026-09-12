import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression: POST /api/prop-ledger rejects oversized bodies (413), bad
 * record schemas (400), and second pre-snapshots for a game key (409),
 * without ever echoing Python internals to the client.
 */

let ledgerFile: { version: number; games: Record<string, any> } = { version: 1, games: {} }
const cliCalls: string[][] = []

vi.mock('@/lib/propModel', () => ({
  MODEL_DIR: '/fake/prop-model',
  PYTHON: '/fake/venv/python',
  runModelCli: async (args: string[]) => {
    cliCalls.push(args)
    // Simulate the CLI's write so write-once checks see prior snapshots.
    const action = args[1]
    if (action === 'pre') {
      const di = args.indexOf('--event-date')
      const ti = args.indexOf('--team')
      const oi = args.indexOf('--opponent')
      ledgerFile.games[`${args[di + 1]}|${args[ti + 1]}|${args[oi + 1]}`] = { pre: { rows: [] } }
    }
    return { stdout: JSON.stringify({ ok: true, recordedAt: new Date().toISOString() }) }
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    readFile: async () => JSON.stringify(ledgerFile),
    access: async () => {},
    mkdtemp: async () => '/tmp/propledger-test',
    writeFile: async () => {},
    rm: async () => {},
  },
}))

import { POST } from '@/app/api/prop-ledger/route'

function postJson(body: unknown, raw?: string) {
  return new Request('http://localhost/api/prop-ledger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
}

const preBody = {
  action: 'pre',
  team: 'NE',
  opponent: 'NYJ',
  eventDate: '20260913',
  record: { asOf: '2026-09-12', rows: [{ player: 'Drake Maye', stat: 'passing_yards', projection: 241.5 }] },
}

beforeEach(() => {
  ledgerFile = { version: 1, games: {} }
  cliCalls.length = 0
})

describe('413 body cap', () => {
  it('rejects bodies over ~256KB before any parsing', async () => {
    const res = await POST(postJson(null, JSON.stringify({ ...preBody, pad: 'x'.repeat(300_000) })))
    expect(res.status).toBe(413)
    expect(cliCalls).toHaveLength(0)
  })
})

describe('record schema validation', () => {
  it('rejects rows that are not an array (pre)', async () => {
    const res = await POST(postJson({ ...preBody, record: { rows: { a: 1 } } }))
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toBe('INVALID_RECORD')
  })
  it('rejects pre rows over 200 entries', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ player: `P${i}`, stat: 'tds', projection: 1 }))
    const res = await POST(postJson({ ...preBody, record: { rows } }))
    expect(res.status).toBe(400)
  })
  it.each([
    { player: '', stat: 'tds', projection: 1 },
    { player: 'x'.repeat(101), stat: 'tds', projection: 1 },
    { player: 'x', stat: 'y'.repeat(101), projection: 1 },
    { player: 'x', stat: 'tds', projection: 'lots' },
    { player: 42, stat: 'tds', projection: 1 },
  ])('rejects malformed row %j', async (row) => {
    const res = await POST(postJson({ ...preBody, record: { rows: [row] } }))
    expect(res.status).toBe(400)
  })
  it('accepts projection: null (model-refused target rows)', async () => {
    const res = await POST(postJson({ ...preBody, record: { rows: [{ player: 'P', stat: 'tds', projection: null }] } }))
    expect(res.status).toBe(200)
  })
  it('accepts live points (rows map, quarters number)', async () => {
    const res = await POST(postJson({
      action: 'live', team: 'NE', opponent: 'NYJ', eventDate: '20260913',
      record: { quarters: 2, state: 'in', rows: { 'Drake Maye': { passing_yards: 167 } } },
    }))
    expect(res.status).toBe(200)
  })
  it('rejects live points with a non-numeric quarters', async () => {
    const res = await POST(postJson({
      action: 'live', team: 'NE', opponent: 'NYJ', eventDate: '20260913',
      record: { quarters: 'two', rows: {} },
    }))
    expect(res.status).toBe(400)
  })
})

describe('write-once pre snapshots', () => {
  it('returns 409 SNAPSHOT_EXISTS when a pre snapshot already exists', async () => {
    expect((await POST(postJson(preBody))).status).toBe(200)
    const second = await POST(postJson(preBody))
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe('SNAPSHOT_EXISTS')
    // The CLI is never invoked a second time.
    expect(cliCalls.filter((a) => a.includes('pre'))).toHaveLength(1)
  })

  it('live records still append after a pre snapshot exists', async () => {
    await POST(postJson(preBody))
    const live = await POST(postJson({
      action: 'live', team: 'NE', opponent: 'NYJ', eventDate: '20260913',
      record: { quarters: 1, rows: { 'Drake Maye': { passing_yards: 10 } } },
    }))
    expect(live.status).toBe(200)
  })
})

describe('error hygiene', () => {
  it('a failing CLI run never echoes the Python traceback tail', async () => {
    const err: any = new Error('boom')
    err.stderr = 'Traceback (most recent call last):\n  File "/opt/secret/path/ledger.py", line 9\nValueError: nope'
    vi.resetModules()
    vi.doMock('@/lib/propModel', () => ({
      MODEL_DIR: '/fake/prop-model',
      PYTHON: '/fake/venv/python',
      runModelCli: async () => { throw err },
    }))
    const mod = await import('@/app/api/prop-ledger/route')
    const res = await mod.POST(postJson(preBody))
    expect(res.status).toBe(500)
    const j = await res.json()
    expect(j.error).toBeDefined()
    expect(JSON.stringify(j)).not.toContain('Traceback')
    expect(JSON.stringify(j)).not.toContain('/opt/secret/path')
  })
})
