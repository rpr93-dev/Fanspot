import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

export { eventDateToAsOf } from './propLedger'

/**
 * Shared plumbing for the Python prop model (prop-model/propmodel):
 * venv paths, cache warm-up, and event-date normalization.
 */

const execFileAsync = promisify(execFile)

export const MODEL_DIR = path.join(process.cwd(), 'prop-model')
export const PYTHON = process.platform === 'win32'
  ? path.join(MODEL_DIR, '.venv', 'Scripts', 'python.exe')
  : path.join(MODEL_DIR, '.venv', 'bin', 'python')
export const CACHE_DIR = path.join(MODEL_DIR, 'cache')
export const TUNED_ESPN = path.join(CACHE_DIR, 'tuned_weights_avg.json')
export const TUNED_NFLVERSE = path.join(CACHE_DIR, 'tuned_weights_avg.json')
export const TUNED_ESPN_RAW = path.join(CACHE_DIR, 'tuned_weights_espn.json')
export const TUNED_NFLVERSE_RAW = path.join(CACHE_DIR, 'tuned_weights_nflverse.json')

/** Run the CLI with the shared timeout/buffer contract. */
export function runModelCli(args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(PYTHON, args, {
    cwd: MODEL_DIR,
    timeout: 170000,
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Pick tuned weights file if present — ESPN-trained preferred. */
export async function tunedWeightsPath(): Promise<string | null> {
  for (const p of [TUNED_ESPN, TUNED_NFLVERSE]) {
    try { await fs.access(p); return p } catch {}
  }
  return null
}

/** Resolve CLI --data-source from cache state: ESPN if its parquet exists. */
export async function preferredDataSource(): Promise<'espn' | 'nflverse'> {
  try {
    const files = await fs.readdir(CACHE_DIR)
    if (files.some(f => f.startsWith('espn_weekly_') && f.endsWith('.parquet'))) return 'espn'
  } catch {}
  return 'nflverse'
}

export type PropModelSport = 'nfl' | 'nba'

/** NBA caches live under cache/nba/ so NFL cache globs (cache/*.pkl) never see them. */
export const NBA_CACHE_DIR = path.join(CACHE_DIR, 'nba')

/** Normalize a client-supplied sport; anything unrecognized is NFL. */
export function propModelSport(raw: unknown): PropModelSport {
  return raw === 'nba' ? 'nba' : 'nfl'
}

const warmupStarted: Record<PropModelSport, boolean> = { nfl: false, nba: false }

/**
 * Kick off a one-shot (per sport) background cache warm-up so the first real
 * request doesn't time out: NFL downloads the nflverse weekly files into
 * prop-model/cache; NBA scans ESPN box scores into prop-model/cache/nba.
 * Safe to call repeatedly; never throws.
 */
export function warmPropModel(sport: PropModelSport = 'nfl'): void {
  if (warmupStarted[sport]) return
  warmupStarted[sport] = true
  void (async () => {
    try {
      await fs.access(PYTHON)
      if (await cachePopulated(sport)) return
      const args = ['-m', 'propmodel.cli']
      if (sport === 'nba') args.push('--sport', 'nba')
      args.push('--warm-cache', '--cache-dir', CACHE_DIR)
      const child = spawn(PYTHON, args, { cwd: MODEL_DIR, stdio: 'ignore' })
      child.on('error', (e) => console.error(`[prop-model] ${sport} warm-up failed:`, e.message))
      child.unref()
      console.log(`[prop-model] background ${sport} cache warm-up started`)
    } catch {
      // venv not set up — the API route reports that with setup instructions.
    }
  })()
}

async function cachePopulated(sport: PropModelSport = 'nfl'): Promise<boolean> {
  try {
    if (sport === 'nba') {
      // A parsed season frame, or at least some cached ESPN event summaries.
      const files = await fs.readdir(NBA_CACHE_DIR)
      if (files.some((f) => f.startsWith('frame_') && f.endsWith('.pkl'))) return true
      if (!files.includes('espn_events')) return false
      return (await fs.readdir(path.join(NBA_CACHE_DIR, 'espn_events'))).length > 0
    }
    const files = await fs.readdir(CACHE_DIR)
    return files.some((f) => f.endsWith('.pkl'))
  } catch {
    return false
  }
}

/**
 * Classify a failed CLI run. A cold start (empty cache → multi-MB download) or
 * an expired/slow data pull should read as "warming up, retry", not a wall of
 * Python traceback.
 */
export async function isColdStartFailure(err: any, sport: PropModelSport = 'nfl'): Promise<boolean> {
  const stderr = String(err?.stderr ?? '')
  // A broken environment (missing dependency) repeats forever — it must not
  // masquerade as a transient warm-up.
  if (/Install deps|ModuleNotFoundError|No module named/i.test(stderr)) return false
  if (err?.killed === true) return true // exec timeout
  if (/timed out|Connection|Download/i.test(stderr)) return true
  return !(await cachePopulated(sport))
}
