/**
 * Server-only F1 upstream fetchers (OpenF1 live timing + Jolpica calendar).
 * Pure merge/format math lives in `@/lib/f1` (client-safe); everything here
 * hits the network and must only be imported by API routes.
 */

const OPENF1 = 'https://api.openf1.org/v1'
const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const UA = { 'User-Agent': 'Fanspot-f1/1.0' }

async function getJson(url: string, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url.split('?')[0]}`)
  return res.json()
}

const of1 = (path: string, timeoutMs = 15_000) => getJson(`${OPENF1}${path}`, timeoutMs);

/** Latest session (any type) or a specific session by key. */
export function fetchSession(sessionKey?: string) {
  const key = sessionKey ?? 'latest'
  return of1(`/sessions?session_key=${encodeURIComponent(key)}`, 10_000)
}

/** All meetings (Grands Prix + tests) for a year. */
export function fetchMeetings(year: string | number) {
  return of1(`/meetings?year=${encodeURIComponent(String(year))}`, 15_000)
}

/** Every session in a meeting (Practice 1-3, Qualifying, Sprint, Race…). */
export function fetchSessionsByMeeting(meetingKey: number | string) {
  return of1(`/sessions?meeting_key=${encodeURIComponent(String(meetingKey))}`, 15_000)
}

/** Drivers (numbers, acronyms, team colours) for a session. */
export function fetchDrivers(sessionKey: number | string) {
  return of1(`/drivers?session_key=${encodeURIComponent(String(sessionKey))}`, 10_000)
}

/** Final classification for a completed session ([] while running). */
export function fetchSessionResult(sessionKey: number | string) {
  return of1(`/session_result?session_key=${encodeURIComponent(String(sessionKey))}`, 10_000)
    .catch(() => [])
}

/**
 * Live timing window: latest position/interval/location rows since `sinceIso`
 * (callers pass ~10s ago), plus full laps + latest track status / weather /
 * race-control messages. Partial failures resolve to [] (never throw).
 */
export async function fetchLiveWindow(sessionKey: number | string, sinceIso: string) {
  const sk = encodeURIComponent(String(sessionKey))
  const enc = encodeURIComponent(sinceIso)
  const settled = await Promise.allSettled([
    of1(`/position?session_key=${sk}&date>${enc}`, 12_000),
    of1(`/intervals?session_key=${sk}&date>${enc}`, 12_000),
    of1(`/laps?session_key=${sk}`, 15_000),
    of1(`/track_status?session_key=${sk}&date>${enc}`, 10_000),
    of1(`/weather?session_key=${sk}&date>${enc}`, 10_000),
    of1(`/race_control?session_key=${sk}&date>${enc}`, 10_000),
    of1(`/pit?session_key=${sk}&date>${enc}`, 10_000),
  ])
  const val = (i: number) => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<any>).value : [])
  const list = (v: any) => (Array.isArray(v) ? v : [])
  return {
    positions: list(val(0)),
    intervals: list(val(1)),
    laps: list(val(2)),
    trackStatus: list(val(3)),
    weather: list(val(4)),
    raceControl: list(val(5)),
    pit: list(val(6)),
  }
}

/** Latest location for EVERY driver in one query (no driver_number filter). */
export function fetchAllLocations(sessionKey: number | string, sinceIso: string, untilIso?: string) {
  const sk = encodeURIComponent(String(sessionKey))
  let q = `/location?session_key=${sk}&date>${encodeURIComponent(sinceIso)}`
  if (untilIso) q += `&date<${encodeURIComponent(untilIso)}`
  return of1(q, 15_000)
}

/** Latest location per driver: one tight-window query each, in parallel. */
export async function fetchLatestLocations(
  sessionKey: number | string,
  driverNumbers: number[],
  sinceIso: string,
): Promise<any[]> {
  const sk = encodeURIComponent(String(sessionKey))
  const enc = encodeURIComponent(sinceIso)
  const settled = await Promise.allSettled(
    driverNumbers.map((n) => of1(`/location?session_key=${sk}&driver_number=${n}&date>${enc}`, 12_000)),
  )
  const out: any[] = []
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !Array.isArray(s.value)) continue
    // Samples arrive ~4Hz; the tail is the car right now.
    const last = s.value[s.value.length - 1]
    if (last) out.push(last)
  }
  return out
}

/** Full lap history for a session (counts + last-lap times). */
export function fetchLaps(sessionKey: number | string, driverNumber?: number) {
  const sk = encodeURIComponent(String(sessionKey))
  const dn = driverNumber != null ? `&driver_number=${encodeURIComponent(String(driverNumber))}` : ''
  return of1(`/laps?session_key=${sk}${dn}`, 20_000)
}

/** Full-session trace for one driver (circuit outline source). */
export function fetchDriverTrace(sessionKey: number | string, driverNumber: number) {
  const sk = encodeURIComponent(String(sessionKey))
  return of1(`/location?session_key=${sk}&driver_number=${driverNumber}`, 30_000)
}

/** Small location window for one driver (light: ~4Hz × seconds rows). */
export function fetchDriverWindow(
  sessionKey: number | string,
  driverNumber: number,
  sinceIso: string,
  untilIso?: string,
) {
  const sk = encodeURIComponent(String(sessionKey))
  let q = `/location?session_key=${sk}&driver_number=${driverNumber}&date>${encodeURIComponent(sinceIso)}`
  if (untilIso) q += `&date<${encodeURIComponent(untilIso)}`
  return of1(q, 20_000)
}

export function fetchJolpica(path: string) {
  return getJson(`${JOLPICA}${path}`, 15_000)
}
