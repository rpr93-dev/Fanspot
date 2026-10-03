import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression: the server must never pass a client-supplied path to the CLI's
 * --weights-json flag (arbitrary file read). It must always use the server's
 * tuned weights path and ignore body.weightsJson.
 */

const cliArgs: string[][] = []
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

vi.mock('@/lib/propModel', () => ({
  CACHE_DIR: '/fake/cache',
  PYTHON: '/fake/venv/python',
  eventDateToAsOf: (d?: string | null) =>
    d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
  isColdStartFailure: async () => false,
  preferredDataSource: async () => 'nflverse',
  propModelSport: (raw: unknown) => (raw === 'nba' ? 'nba' : 'nfl'),
  runModelCli: async (args: string[]) => {
    cliArgs.push(args)
    return { stdout: '[]' }
  },
  tunedWeightsPath: async () => '/fake/cache/tuned_weights_avg.json',
  warmPropModel: () => {},
}))

vi.mock('fs/promises', () => ({
  default: {
    access: async () => {},
    mkdtemp: async () => '/tmp/propmodel-test',
    writeFile: async () => {},
    readFile: async () => '[]',
    rm: async () => {},
  },
}))

import { POST } from '@/app/api/prop-model/route'

const post = (body: unknown) =>
  new Request('http://localhost/api/prop-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const targets = [{ player: 'Drake Maye', stat: 'passing_yards', team: 'NE', opponent: 'NYJ' }]

describe('POST /api/prop-model ignores client-supplied weightsJson', () => {
  beforeEach(() => {
    cliArgs.length = 0
    warnSpy.mockClear()
  })

  it.each(['/etc/passwd', '../../x'])('never passes %s to the CLI', async (evil) => {
    const res = await POST(post({ targets, weightsJson: evil }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.source).toBe('prop-model')

    expect(cliArgs).toHaveLength(1)
    const args = cliArgs[0]
    expect(args).not.toContain(evil)

    const idx = args.indexOf('--weights-json')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('/fake/cache/tuned_weights_avg.json')
  })

  it('logs a server-side warning when weightsJson is present', async () => {
    await POST(post({ targets, weightsJson: '/etc/passwd' }))
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('weightsJson'),
    )
  })

  it('does not warn when weightsJson is absent', async () => {
    await POST(post({ targets }))
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/prop-model sport routing', () => {
  beforeEach(() => {
    cliArgs.length = 0
    warnSpy.mockClear()
  })

  const nbaTargets = [{ player: 'Shai Gilgeous-Alexander', stat: 'points', team: 'OKC', opponent: 'DEN' }]

  it('passes --sport nba and skips NFL flags for sport=nba', async () => {
    const res = await POST(post({ targets: nbaTargets, sport: 'nba' }))
    expect(res.status).toBe(200)
    expect(cliArgs).toHaveLength(1)
    const args = cliArgs[0]
    expect(args).toContain('--sport')
    expect(args[args.indexOf('--sport') + 1]).toBe('nba')
    // The NBA runner reads ESPN box scores and ignores NFL ModelWeights.
    expect(args).not.toContain('--data-source')
    expect(args).not.toContain('--weights-json')
    const json = await res.json()
    expect(json.source).toBe('prop-model')
  })

  it('defaults to the NFL pipeline (weights + data source) when sport is absent', async () => {
    const res = await POST(post({ targets }))
    expect(res.status).toBe(200)
    expect(cliArgs).toHaveLength(1)
    const args = cliArgs[0]
    expect(args).not.toContain('--sport')
    const idx = args.indexOf('--weights-json')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(args[idx + 1]).toBe('/fake/cache/tuned_weights_avg.json')
  })
})
