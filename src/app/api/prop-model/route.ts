import { NextResponse } from 'next/server'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  CACHE_DIR,
  PYTHON,
  eventDateToAsOf,
  isColdStartFailure,
  preferredDataSource,
  propModelSport,
  runModelCli,
  tunedWeightsPath,
  warmPropModel,
} from '@/lib/propModel'

/**
 * Runs the Python prop-projection model (prop-model/propmodel) on demand.
 *
 * POST /api/prop-model
 *   { targets: [{ player, stat, team, opponent }, ...],
 *     sport?: 'nfl' | 'nba',   // NBA runs the minutes-x-rate model (points/rebounds/assists/threes)
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
  // Additional DK passing markets now modeled by propmodel/stats.py.
  passing_tds: { label: 'Passing Touchdowns', unit: 'td' },
  passing_attempts: { label: 'Pass Attempts', unit: 'att' },
  completions: { label: 'Completions', unit: 'cmp' },
  interceptions: { label: 'Interceptions', unit: 'int' },
  // NBA (propmodel/nba — minutes x rate model over ESPN box scores).
  points: { label: 'Points', unit: 'pts' },
  rebounds: { label: 'Rebounds', unit: 'reb' },
  assists: { label: 'Assists', unit: 'ast' },
  threes: { label: '3-Pointers Made', unit: '3pm' },
}

const WARMING_MESSAGES: Record<string, string> = {
  nfl: 'The prop model is warming up — its first run downloads NFL data. Try again in a minute.',
  nba: 'The prop model is warming up — its first run downloads NBA box scores. Try again in a minute.',
}

/**
 * In-memory result cache: every game-hub view (both teams' panels, re-renders,
 * live polls re-running the same batch) posts the same targets, so share one
 * Python run per distinct batch instead of spawning a process per view.
 * Successes only — errors/warm-ups are never cached. Per server process.
 */
const RESULT_TTL_MS = 10 * 60 * 1000
const MAX_RESULT_ENTRIES = 100
interface ModelResultEntry {
  at: number
  projections: unknown[]
}
const resultCache = new Map<string, ModelResultEntry>()
/** Single-flight: concurrent identical POSTs share one in-progress CLI run. */
const resultInFlight = new Map<string, Promise<{ projections: unknown[] }>>()

/** Test hook — the route test suite clears this between cases. */
export function __clearPropModelCacheForTests(): void {
  resultCache.clear()
  resultInFlight.clear()
}

function resultCacheKey(parts: unknown): string {
  return JSON.stringify(parts)
}

function getFreshResult(key: string): ModelResultEntry | null {
  const hit = resultCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at >= RESULT_TTL_MS) {
    resultCache.delete(key)
    return null
  }
  // LRU bump so a hot game isn't evicted by one-off batches.
  resultCache.delete(key)
  resultCache.set(key, hit)
  return hit
}

function setResult(key: string, projections: unknown[]): void {
  resultCache.delete(key)
  resultCache.set(key, { at: Date.now(), projections })
  while (resultCache.size > MAX_RESULT_ENTRIES) {
    const oldest = resultCache.keys().next()
    if (oldest.done) break
    resultCache.delete(oldest.value)
  }
}

/** Normalize the effective CLI inputs so equivalent batches share a cache entry. */
function normalizeTargets(targets: any[]): { player: string; stat: string; team: string; opponent: string; prior?: number }[] {
  return targets
    .map((t) => ({
      player: String(t?.player ?? ''),
      stat: String(t?.stat ?? ''),
      team: String(t?.team ?? '').toUpperCase(),
      opponent: String(t?.opponent ?? '').toUpperCase(),
      ...(t?.prior != null && Number.isFinite(Number(t.prior)) ? { prior: Number(t.prior) } : {}),
    }))
    .sort((a, b) => `${a.player}|${a.stat}|${a.team}`.localeCompare(`${b.player}|${b.stat}|${b.team}`))
}

function normalizeLines(lines: unknown): Record<string, unknown> | null {
  if (!lines || typeof lines !== 'object' || Array.isArray(lines)) return null
  const entries = Object.entries(lines as Record<string, unknown>)
  if (!entries.length) return null
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, 'prop-model')
  if (limited) return limited

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Anything unrecognized is NFL — the dashboard only ever sends nfl/nba.
  const sport = propModelSport(body?.sport)
  warmPropModel(sport)

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

  // Resolve every effective CLI input up front: the cache key must capture
  // exactly what changes the output (and nothing the server ignores).
  const dataSource = body?.dataSource === 'espn' || body?.dataSource === 'nflverse'
    ? body.dataSource as string
    : await preferredDataSource()
  if (body?.weightsJson !== undefined) {
    // Security: never let a client path the model's --weights-json flag —
    // the CLI reads whatever file it points at. Always use server-owned
    // tuned weights; a supplied value is ignored (logged once, audit trail).
    console.warn('[prop-model] ignoring client-supplied weightsJson; using server tuned weights')
  }
  const weightsPath = await tunedWeightsPath()
  const normLines = normalizeLines(body?.lines)
  const preseason = !!body?.preseason
  const cacheKey = resultCacheKey({
    targets: normalizeTargets(targets),
    sport, asOf, dataSource, weightsPath, lines: normLines, preseason,
  })

  const cached = getFreshResult(cacheKey)
  if (cached) {
    return NextResponse.json({ projections: cached.projections, source: 'prop-model', cached: true })
  }
  const inflight = resultInFlight.get(cacheKey)
  if (inflight) {
    try {
      const { projections } = await inflight
      return NextResponse.json({ projections, source: 'prop-model', cached: true })
    } catch {
      // The owner maps the failure to a response below; fall through and join
      // a fresh attempt rather than duplicating the error mapping here.
    }
  }

  const runOnce = async (): Promise<{ projections: any[] }> => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'propmodel-'))
    const batchPath = path.join(tmp, 'batch.json')
    const outPath = path.join(tmp, 'out.json')
    try {
      await fs.writeFile(batchPath, JSON.stringify(targets))
      const args = [
        '-m', 'propmodel.cli',
        '--input', batchPath,
        '--output', outPath,
        '--cache-dir', CACHE_DIR,
      ]
      if (sport === 'nba') {
        // The NBA runner reads ESPN box scores under cache/nba and ignores NFL
        // flags (--data-source, --weights-json take NFL ModelWeights).
        args.push('--sport', 'nba')
      } else {
        args.push('--data-source', dataSource)
        if (weightsPath) args.push('--weights-json', weightsPath)
      }
      if (asOf) args.push('--as-of', asOf)
      if (preseason) args.push('--preseason')
      if (normLines) {
        const linesPath = path.join(tmp, 'lines.json')
        await fs.writeFile(linesPath, JSON.stringify(normLines))
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
      p10: r.p10 ?? null,
      p25: r.p25 ?? null,
      p50: r.p50 ?? null,
      p75: r.p75 ?? null,
      p90: r.p90 ?? null,
      confidence: r.confidence,
      confidence_score: r.confidence_score ?? null,
      n_games: r.n_games,
      effective_sample_size: r.effective_sample_size ?? null,
      opponent_factor: r.opponent_factor,
      script_factor: r.script_factor,
      role_factor: r.role_factor ?? null,
      recent_form_factor: r.recent_form_factor ?? null,
      refused_reason: r.refused_reason,
      note: r.note ?? null,
      // The CLI historically emitted warnings as a JSON-encoded string;
      // normalize to an array (or null) so the panel can .join() safely.
      warnings: Array.isArray(r.warnings)
        ? r.warnings
        : typeof r.warnings === 'string' && r.warnings
          ? (() => { try { const p = JSON.parse(r.warnings); return Array.isArray(p) ? p : [r.warnings] } catch { return [r.warnings] } })()
          : null,
      last_updated: r.last_updated ?? null,
      reliability: r.reliability ?? 0,
      pred_sd: r.pred_sd ?? null,
    }))
    return { projections }
    } finally {
      fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  const owned = runOnce()
  resultInFlight.set(cacheKey, owned)
  try {
    const { projections } = await owned
    setResult(cacheKey, projections)
    return NextResponse.json({ projections, source: 'prop-model' })
  } catch (err: any) {
    const detail = (err?.stderr || err?.message || String(err)).toString()
    console.error('[prop-model] run failed:', detail.slice(-2000))
    if (await isColdStartFailure(err, sport)) {
      // Cold start (empty cache → multi-MB download) or a stale data pull:
      // a friendly retry beats a Python traceback tail. The warm-up fetch has
      // been kicked off in the background; the next click usually succeeds.
      warmPropModel(sport)
      return NextResponse.json({ error: WARMING_MESSAGES[sport], warmingUp: true }, { status: 503 })
    }
    // Generic user-safe message; full detail already logged server-side.
    return NextResponse.json(
      { error: 'MODEL_RUN_FAILED', message: 'Prop model run failed' },
      { status: 500 },
    )
  } finally {
    resultInFlight.delete(cacheKey)
  }
}
