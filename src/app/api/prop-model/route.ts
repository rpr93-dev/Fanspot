import { NextResponse } from 'next/server'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import {
  CACHE_DIR,
  PYTHON,
  eventDateToAsOf,
  isColdStartFailure,
  preferredDataSource,
  runModelCli,
  tunedWeightsPath,
  warmPropModel,
} from '@/lib/propModel'

/**
 * Runs the Python prop-projection model (prop-model/propmodel) on demand.
 *
 * POST /api/prop-model
 *   { targets: [{ player, stat, team, opponent }, ...],
 *     lines?: { [team]: { total, spread, favorite } },
 *     eventDate?: "YYYYMMDD" }   // projections use only data before this date
 *
 * Shells out to the venv CLI (`python -m propmodel.cli --input ... --output ...`),
 * which reads the nflverse weekly file from its disk cache at prop-model/cache
 * (the first-ever run downloads it; a background warm-up also runs on server
 * boot). Returns the projections table rows the CLI emits.
 */

const STAT_LABELS: Record<string, { label: string; unit: string }> = {
  passing_yards: { label: 'Passing Yards', unit: 'yds' },
  rushing_yards: { label: 'Rushing Yards', unit: 'yds' },
  receiving_yards: { label: 'Receiving Yards', unit: 'yds' },
  receptions: { label: 'Receptions', unit: 'rec' },
  tds: { label: 'Touchdowns', unit: 'td' },
}

const WARMING_MESSAGE =
  'The prop model is warming up — its first run downloads NFL data. Try again in a minute.'

export async function POST(request: Request) {
  warmPropModel()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const targets = body?.targets
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 40) {
    return NextResponse.json(
      { error: 'targets must be a non-empty array of { player, stat, team, opponent } (max 40)' },
      { status: 400 },
    )
  }
  const asOf = eventDateToAsOf(body?.eventDate)

  try {
    await fs.access(PYTHON)
  } catch {
    return NextResponse.json(
      {
        error:
          'prop-model venv not set up. Run: cd prop-model && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt',
      },
      { status: 503 },
    )
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'propmodel-'))
  const batchPath = path.join(tmp, 'batch.json')
  const outPath = path.join(tmp, 'out.json')
  try {
    await fs.writeFile(batchPath, JSON.stringify(targets))
    const dataSource = body?.dataSource === 'espn' || body?.dataSource === 'nflverse'
      ? body.dataSource as string
      : await preferredDataSource()
    const weightsPath = body?.weightsJson || await tunedWeightsPath()
    const args = [
      '-m', 'propmodel.cli',
      '--input', batchPath,
      '--output', outPath,
      '--cache-dir', CACHE_DIR,
      '--data-source', dataSource,
    ]
    if (weightsPath) args.push('--weights-json', weightsPath)
    if (asOf) args.push('--as-of', asOf)
    if (body?.preseason) args.push('--preseason')
    const lines = body?.lines
    if (lines && typeof lines === 'object' && Object.keys(lines).length > 0) {
      const linesPath = path.join(tmp, 'lines.json')
      await fs.writeFile(linesPath, JSON.stringify(lines))
      args.push('--lines-json', linesPath)
    }
    await runModelCli(args)
    const out = JSON.parse(await fs.readFile(outPath, 'utf-8'))
    const projections = (Array.isArray(out) ? out : []).map((r: any) => ({
      player: r.player,
      stat: r.stat,
      stat_label: STAT_LABELS[r.stat]?.label ?? r.stat,
      unit: STAT_LABELS[r.stat]?.unit ?? '',
      projection: r.my_projection,
      baseline: r.baseline,
      low: r.low,
      high: r.high,
      confidence: r.confidence,
      n_games: r.n_games,
      opponent_factor: r.opponent_factor,
      script_factor: r.script_factor,
      refused_reason: r.refused_reason,
      note: r.note ?? null,
      last_updated: r.last_updated ?? null,
      reliability: r.reliability ?? 0,
    }))
    return NextResponse.json({ projections, source: 'prop-model' })
  } catch (err: any) {
    const detail = (err?.stderr || err?.message || String(err)).toString()
    console.error('[prop-model] run failed:', detail.slice(-2000))
    if (await isColdStartFailure(err)) {
      // Cold start (empty cache → multi-MB download) or a stale data pull:
      // a friendly retry beats a Python traceback tail. The warm-up fetch has
      // been kicked off in the background; the next click usually succeeds.
      warmPropModel()
      return NextResponse.json({ error: WARMING_MESSAGE, warmingUp: true }, { status: 503 })
    }
    const lastLine = detail.trim().split('\n').filter(Boolean).pop() ?? 'unknown error'
    return NextResponse.json(
      { error: `Prop model run failed: ${lastLine}` },
      { status: 500 },
    )
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
