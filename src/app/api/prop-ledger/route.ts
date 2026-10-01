import { NextResponse } from 'next/server'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { MODEL_DIR, PYTHON, runModelCli } from '@/lib/propModel'
import { gradeGame } from '@/lib/propGrades'

/**
 * Game-day prop ledger (backed by prop-model/propmodel/ledger.py):
 * one pre-game model snapshot per game + live in-game stat points +
 * hourly book-line snapshots that freeze into closing lines for grading.
 *
 * GET  /api/prop-ledger?team=NE&opponent=NYJ&eventDate=20260909
 *   -> { game: { eventDate, team, opponent, pre, live, lines, finalLines } | null,
 *        grade: {...} | null }
 *      (reads the JSON file directly — no Python needed; grade is computed
 *      in-process from the frozen closing lines + final actuals)
 *
 * POST /api/prop-ledger
 *   { action: 'pre'|'live'|'lines'|'finalize', team, opponent, eventDate, record? }
 *   -> { ok, recordedAt, ... } — shells out to prop-model-ledger.py
 *      which validates and atomically appends to prop-model/ledger/ledger.json.
 *   `lines` record: { lines: [{ player, stat, line, book?, over?, under? }...],
 *                     source? } — one hourly book-line snapshot (append-only).
 *   `finalize` takes no record: freezes the most recent pre-final snapshot
 *      as the closing lines the running grade is scored on.
 */

const LEDGER_PATH = path.join(MODEL_DIR, 'ledger', 'ledger.json')

/** Bodies bigger than this are rejected outright (413) before any parsing. */
const MAX_BODY_BYTES = 256 * 1024
/** Model tables (per team per game) stay well under 200 rows. */
const MAX_RECORD_ROWS = 200
const MAX_NAME_LEN = 100

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
  const game = ledger.games[key] ?? null
  return NextResponse.json({ game, grade: game ? gradeGame(game) : null })
}

function isValidPreRow(row: unknown): boolean {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return false
  const r = row as Record<string, unknown>
  if (typeof r.player !== 'string' || r.player.length === 0 || r.player.length > MAX_NAME_LEN) return false
  if (typeof r.stat !== 'string' || r.stat.length === 0 || r.stat.length > MAX_NAME_LEN) return false
  // Projection must be numeric; null happens for model-refused targets and is
  // part of the existing shape, so only other types are rejected.
  if (r.projection != null && !(typeof r.projection === 'number' && Number.isFinite(r.projection))) return false
  return true
}

function isValidLivePoint(record: Record<string, any>): string | null {
  if (Array.isArray(record.rows)) {
    if (record.rows.length > MAX_RECORD_ROWS) return `record.rows exceeds ${MAX_RECORD_ROWS} entries`
    return null
  }
  if (record.rows != null && typeof record.rows !== 'object') {
    return "record.rows must be an array (pre) or object map (live)"
  }
  if (record.rows != null && Object.keys(record.rows).length > MAX_RECORD_ROWS) {
    return `record.rows exceeds ${MAX_RECORD_ROWS} entries`
  }
  if (record.quarters != null && typeof record.quarters !== 'number') return 'quarters must be a number'
  return null
}

function isValidLineRow(row: unknown): boolean {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return false
  const r = row as Record<string, unknown>
  if (typeof r.player !== 'string' || r.player.length === 0 || r.player.length > MAX_NAME_LEN) return false
  if (typeof r.stat !== 'string' || r.stat.length === 0 || r.stat.length > MAX_NAME_LEN) return false
  if (r.line != null && !(typeof r.line === 'number' && Number.isFinite(r.line))) return false
  return true
}

function validateRecord(action: string, record: unknown): string | null {
  if (action === 'finalize') return null // no record body
  if (record == null || typeof record !== 'object' || Array.isArray(record)) return 'record object required'
  const rec = record as Record<string, any>
  if (action === 'pre') {
    if (!Array.isArray(rec.rows)) return 'pre record.rows must be an array'
    if (rec.rows.length > MAX_RECORD_ROWS) return `pre record.rows exceeds ${MAX_RECORD_ROWS} entries`
    if (!rec.rows.every(isValidPreRow)) return 'each row needs string player/stat (≤100 chars) and a numeric projection'
    return null
  }
  if (action === 'lines') {
    if (!Array.isArray(rec.lines)) return 'lines record.lines must be an array'
    if (rec.lines.length > MAX_RECORD_ROWS) return `lines record.lines exceeds ${MAX_RECORD_ROWS} entries`
    if (!rec.lines.every(isValidLineRow)) return 'each line needs string player/stat (≤100 chars) and a numeric line'
    return null
  }
  return isValidLivePoint(rec)
}

export async function POST(request: Request) {
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Unreadable request body' }, { status: 400 })
  }
  if (Buffer.byteLength(raw, 'utf-8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'BODY_TOO_LARGE', message: `Request body exceeds ${MAX_BODY_BYTES} bytes` },
      { status: 413 },
    )
  }
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const action = body?.action
  if (action !== 'pre' && action !== 'live' && action !== 'lines' && action !== 'finalize') {
    return NextResponse.json({ error: "action must be 'pre', 'live', 'lines' or 'finalize'" }, { status: 400 })
  }
  const key = keyOf(body?.team, body?.opponent, body?.eventDate)
  if (!key) {
    return NextResponse.json({ error: 'team, opponent (1-4 letters) and eventDate (YYYYMMDD) required' }, { status: 400 })
  }
  const recordError = validateRecord(action, body?.record)
  if (recordError) {
    return NextResponse.json({ error: 'INVALID_RECORD', message: recordError }, { status: 400 })
  }

  // Pre snapshots are write-once per game key: the panel runs the model once
  // per game, and a second writer (stale tab, replayed request) must not
  // overwrite the frozen pre-game projection the live comparison relies on.
  if (action === 'pre') {
    const existing = await readLedger()
    if (existing.games[key]?.pre) {
      return NextResponse.json(
        { error: 'SNAPSHOT_EXISTS', message: 'A pre-game snapshot already exists for this game' },
        { status: 409 },
      )
    }
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
    const [date, team, opponent] = key.split('|')
    const cliArgs = [
      'prop-model-ledger.py', action,
      '--team', team,
      '--opponent', opponent,
      '--event-date', date,
    ]
    // finalize takes no record body; everything else ships its record via file.
    if (action !== 'finalize') {
      await fs.writeFile(dataPath, JSON.stringify(body.record ?? {}))
      cliArgs.push('--data', dataPath)
    }
    const { stdout } = await runModelCli(cliArgs)
    const result = JSON.parse(stdout)
    if (action === 'finalize') {
      // { ok: true, finalLines } — no recordedAt on a freeze.
      if (!result?.ok) throw new Error('ledger CLI rejected the finalize')
      return NextResponse.json(result)
    }
    if (!result?.ok) throw new Error('ledger CLI rejected the record')
    return NextResponse.json(result)
  } catch (err: any) {
    const detail = (err?.stderr || err?.message || String(err)).toString()
    console.error('[prop-ledger] record failed:', detail.slice(-1500))
    return NextResponse.json(
      { error: 'LEDGER_WRITE_FAILED', message: 'Ledger record failed' },
      { status: 500 },
    )
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
