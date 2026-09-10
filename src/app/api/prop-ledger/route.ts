import { NextResponse } from 'next/server'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { MODEL_DIR, PYTHON, runModelCli } from '@/lib/propModel'

/**
 * Game-day prop ledger (backed by prop-model/propmodel/ledger.py):
 * one pre-game model snapshot per game + live in-game stat points.
 *
 * GET  /api/prop-ledger?team=NE&opponent=NYJ&eventDate=20260909
 *   -> { game: { eventDate, team, opponent, pre, live } | null }
 *      (reads the JSON file directly — no Python needed)
 *
 * POST /api/prop-ledger
 *   { action: 'pre'|'live', team, opponent, eventDate, record }
 *   -> { ok, recordedAt, ... } — shells out to prop-model-ledger.py
 *      which validates and atomically appends to prop-model/ledger/ledger.json.
 */

const LEDGER_PATH = path.join(MODEL_DIR, 'ledger', 'ledger.json')

function keyOf(team: string, opponent: string, eventDate: string): string | null {
  const t = String(team ?? '').toUpperCase()
  const o = String(opponent ?? '').toUpperCase()
  const d = String(eventDate ?? '').replace(/\D/g, '').slice(0, 8)
  if (!/^[A-Z]{1,4}$/.test(t) || !/^[A-Z]{1,4}$/.test(o) || d.length !== 8) return null
  return `${d}|${t}|${o}`
}

async function readLedger(): Promise<{ version: number; games: Record<string, any> }> {
  try {
    const raw = await fs.readFile(LEDGER_PATH, 'utf-8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && data.games && typeof data.games === 'object') return data
  } catch {}
  return { version: 1, games: {} }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const key = keyOf(
    searchParams.get('team') ?? '',
    searchParams.get('opponent') ?? '',
    searchParams.get('eventDate') ?? '',
  )
  if (!key) {
    return NextResponse.json({ error: 'team, opponent (1-4 letters) and eventDate (YYYYMMDD) required' }, { status: 400 })
  }
  const ledger = await readLedger()
  return NextResponse.json({ game: ledger.games[key] ?? null })
}

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const action = body?.action
  if (action !== 'pre' && action !== 'live') {
    return NextResponse.json({ error: "action must be 'pre' or 'live'" }, { status: 400 })
  }
  const key = keyOf(body?.team, body?.opponent, body?.eventDate)
  if (!key) {
    return NextResponse.json({ error: 'team, opponent (1-4 letters) and eventDate (YYYYMMDD) required' }, { status: 400 })
  }
  if (body?.record == null || typeof body.record !== 'object') {
    return NextResponse.json({ error: 'record object required' }, { status: 400 })
  }

  try {
    await fs.access(PYTHON)
  } catch {
    return NextResponse.json(
      { error: 'prop-model venv not set up. Run: cd prop-model && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt' },
      { status: 503 },
    )
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'propledger-'))
  const dataPath = path.join(tmp, 'record.json')
  try {
    await fs.writeFile(dataPath, JSON.stringify(body.record))
    const [date, team, opponent] = key.split('|')
    const { stdout } = await runModelCli([
      'prop-model-ledger.py', action,
      '--team', team,
      '--opponent', opponent,
      '--event-date', date,
      '--data', dataPath,
    ])
    const result = JSON.parse(stdout)
    if (!result?.ok) throw new Error('ledger CLI rejected the record')
    return NextResponse.json(result)
  } catch (err: any) {
    const detail = (err?.stderr || err?.message || String(err)).toString()
    console.error('[prop-ledger] record failed:', detail.slice(-1500))
    const lastLine = detail.trim().split('\n').filter(Boolean).pop() ?? 'unknown error'
    return NextResponse.json({ error: `Ledger record failed: ${lastLine}` }, { status: 500 })
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
