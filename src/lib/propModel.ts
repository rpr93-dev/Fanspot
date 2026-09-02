import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

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

/** The panel's event date ("YYYYMMDD" or ISO) → the CLI's --as-of form. */
export function eventDateToAsOf(eventDate?: string | null): string | null {
  if (!eventDate) return null
  if (/^\d{8}$/.test(eventDate)) {
    return `${eventDate.slice(0, 4)}-${eventDate.slice(4, 6)}-${eventDate.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(eventDate)) return eventDate.slice(0, 10)
  return null
}

let warmupStarted = false

/**
 * Kick off a one-shot background cache warm-up (downloads the nflverse weekly
 * files into prop-model/cache so the first real request doesn't time out).
 * Safe to call repeatedly; never throws.
 */
export function warmPropModel(): void {
  if (warmupStarted) return
  warmupStarted = true
  void (async () => {
    try {
      await fs.access(PYTHON)
      if (await cachePopulated()) return
      const child = spawn(
        PYTHON,
        ['-m', 'propmodel.cli', '--warm-cache', '--cache-dir', CACHE_DIR],
        { cwd: MODEL_DIR, stdio: 'ignore' },
      )
      child.on('error', (e) => console.error('[prop-model] warm-up failed:', e.message))
      child.unref()
      console.log('[prop-model] background cache warm-up started')
    } catch {
      // venv not set up — the API route reports that with setup instructions.
    }
  })()
}

async function cachePopulated(): Promise<boolean> {
  try {
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
export async function isColdStartFailure(err: any): Promise<boolean> {
  const stderr = String(err?.stderr ?? '')
  // A broken environment (missing dependency) repeats forever — it must not
  // masquerade as a transient warm-up.
  if (/Install deps|ModuleNotFoundError|No module named/i.test(stderr)) return false
  if (err?.killed === true) return true // exec timeout
  if (/timed out|Connection|Download/i.test(stderr)) return true
  return !(await cachePopulated())
}
