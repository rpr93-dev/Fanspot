/**
 * Server-only client for the self-hosted **f1-live-api** bridge — a SignalR
 * connection to F1's own live timing feed (livetiming.formula1.com). Used for
 * LIVE sessions, where OpenF1's free tier returns 401 ("live session in
 * progress ... restricted to authenticated users"). Every call returns null
 * on failure, so the /api/f1 routes can fall back to OpenF1/Jolpica.
 *
 * Configure the bridge with F1_LIVE_API_URL (default the local pm2 service).
 */
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { bridgeSnapshot, bridgeDrivers, type F1Driver, type F1LiveSnapshot } from '@/lib/f1'

const BASE = (process.env.F1_LIVE_API_URL ?? 'http://127.0.0.1:8791').replace(/\/$/, '')
const TIMEOUT_MS = Number(process.env.F1_LIVE_API_TIMEOUT_MS ?? 8000)

async function getJson<T = any>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function cached<T>(key: string, path: string, ttlMs: number): Promise<T | null> {
  const hit = getCached<T>(key)
  if (hit && isFresh(hit.ts, ttlMs)) return hit.data
  const data = await getJson<T>(path)
  if (data != null) setCached(key, data)
  return data
}

export const f1BridgeStatus = () => cached<any>('f1bridge:status', '/status', 4_000)
export const f1BridgeTiming = () => cached<any>('f1bridge:timing', '/timing', 4_000)
export const f1BridgeDrivers = () => cached<any[]>('f1bridge:drivers', '/drivers', 20_000)
export const f1BridgeWeather = () => cached<any>('f1bridge:weather', '/weather', 20_000)
export const f1BridgeRaceControl = () => cached<any[]>('f1bridge:rc', '/race-control', 8_000)
export const f1BridgeCalendarCurrent = () =>
  cached<any>('f1bridge:current', '/calendar/current', 5 * 60_000)
export const f1BridgeCalendarRound = (round: number | string) =>
  cached<any>(`f1bridge:round:${round}`, `/calendar/${round}`, 10 * 60_000)

/** Merge the bridge's live endpoints into one snapshot (null on failure). */
export async function f1BridgeSnapshot(): Promise<F1LiveSnapshot | null> {
  const [status, timing, weather, rc] = await Promise.all([
    f1BridgeStatus(),
    f1BridgeTiming(),
    f1BridgeWeather(),
    f1BridgeRaceControl(),
  ])
  if (!status && !timing) return null
  return bridgeSnapshot({ status, timing, weather, raceControl: rc ?? [] })
}

/** Driver directory from the bridge (empty when unreachable). */
export async function f1BridgeDriverList(): Promise<F1Driver[]> {
  const rows = await f1BridgeDrivers()
  return bridgeDrivers(rows ?? [])
}
