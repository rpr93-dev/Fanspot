import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'

/**
 * Runs the Python prop-projection model (prop-model/propmodel) on demand.
 *
 * POST /api/prop-model
 *   { targets: [{ player, stat, team, opponent }, ...], lines?: { [team]: { total, spread, favorite } } }
 *
 * Shells out to the venv CLI (`python -m propmodel.cli --input ... --output ...`),
 * which downloads the nflverse weekly file once (then serves it from its disk
 * cache at prop-model/cache, so repeat calls are fast). Returns the projections
 * table rows the CLI emits.
 */
const execFileAsync = promisify(execFile)

const STAT_LABELS: Record<string, { label: string; unit: string }> = {
  passing_yards: { label: 'Passing Yards', unit: 'yds' },
  rushing_yards: { label: 'Rushing Yards', unit: 'yds' },
  receiving_yards: { label: 'Receiving Yards', unit: 'yds' },
  receptions: { label: 'Receptions', unit: 'rec' },
  tds: { label: 'Touchdowns', unit: 'td' },
}

const MODEL_DIR = path.join(process.cwd(), 'prop-model')
const PYTHON = process.platform === 'win32'
  ? path.join(MODEL_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(MODEL_DIR, '.venv', 'bin', 'python')

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const targets = body?.targets
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 12) {
    return NextResponse.json(
      { error: 'targets must be a non-empty array of { player, stat, team, opponent } (max 12)' },
      { status: 400 },
    )
  }

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
    const args = [
      '-m', 'propmodel.cli',
      '--input', batchPath,
      '--output', outPath,
      '--cache-dir', path.join(MODEL_DIR, 'cache'),
    ]
    const lines = body?.lines
    if (lines && typeof lines === 'object' && Object.keys(lines).length > 0) {
      const linesPath = path.join(tmp, 'lines.json')
      await fs.writeFile(linesPath, JSON.stringify(lines))
      args.push('--lines-json', linesPath)
    }
    await execFileAsync(PYTHON, args, {
      cwd: MODEL_DIR,
      timeout: 170000,
      maxBuffer: 64 * 1024 * 1024,
    })
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
    }))
    return NextResponse.json({ projections, source: 'prop-model' })
  } catch (err: any) {
    const detail = (err?.stderr || err?.message || String(err)).toString().slice(-2000)
    console.error('[prop-model] run failed:', detail)
    return NextResponse.json({ error: `Prop model run failed: ${detail}` }, { status: 500 })
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
