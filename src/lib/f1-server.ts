/**
 * Server-only F1 upstream fetchers (OpenF1 live timing + Jolpica calendar).
 * Pure merge/format math lives in `@/lib/f1` (client-safe); everything here
 * hits the network and must only be imported by API routes.
 */

const OPENF1 = 'https://api.openf1.org/v1'
const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const UA = { 'User-Agent': 'Fanspot-f1/1.0' }

/* ------------------------------------------------------------------ */
/* OpenF1 politeness: the free tier allows ~3 req/s and 30 req/min     */
/* (no auth). A live poll fans out ~10 requests at once and the track  */
/* outline tries several drivers in a row, so every upstream call goes */
/* through a process-wide token bucket (burst 2, ~2.5/s sustained),    */
/* identical in-flight URLs share one promise (multi-tab stampedes and */
/* outline retries collapse), and 429/502/503s back off and retry —    */
/* honoring Retry-After — instead of 502ing straight into the UI.      */
/* Static per-session data (session meta, driver list) is memoized in  */
/* module (it never changes mid-session); slow feeds (laps, weather,   */
/* track status) carry short TTLs so a live poll costs ~4 fresh calls  */
/* instead of ~10.                                                     */
/* ------------------------------------------------------------------ */

const BUCKET_CAP = 2
const REFILL_MS = 400
let tokens = BUCKET_CAP
let lastRefill = Date.now()

function refillBucket() {
  const now = Date.now()
  tokens = Math.min(BUCKET_CAP, tokens + (now - lastRefill) / REFILL_MS)
  lastRefill = now
}

/** Wait until the bucket holds a token (re-checks on wake: contention-safe). */
function takeToken(): Promise<void> {
  refillBucket()
  if (tokens >= 1) {
    tokens -= 1
    return Promise.resolve()
  }
  const wait = Math.max(1, Math.ceil((1 - tokens) * REFILL_MS))
  return new Promise<void>((res) => setTimeout(() => takeToken().then(res), wait))
}

const inflight = new Map<string, Promise<any>>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function getJson(url: string, timeoutMs: number, retries = 2): Promise<any> {
  const ongoing = inflight.get(url)
  if (ongoing) return ongoing
  const task = (async () => {
    let attempt = 0
    for (;;) {
      await takeToken()
      let res: Response
      try {
        res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) })
      } catch (e: any) {
        // Timeout / network blip: transient — retry while budget lasts.
        if (attempt < retries && (e?.name === 'TimeoutError' || e?.name === 'AbortError')) {
          attempt++
          await sleep(500 * attempt)
          continue
        }
        throw e
      }
      if (res.ok) return res.json()
      const retryable = res.status === 429 || res.status === 502 || res.status === 503
      if (retryable && attempt < retries) {
        attempt++
        const ra = Number(res.headers.get('retry-after'))
        const wait =
          Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 600 * Math.pow(2, attempt - 1)
        await res.arrayBuffer().catch(() => {})
        await sleep(wait)
        continue
      }
      throw new Error(`upstream ${res.status} for ${url.split('?')[0]}`)
    }
  })()
  inflight.set(url, task)
  try {
    return await task
  } finally {
    if (inflight.get(url) === task) inflight.delete(url)
  }
}

/** Small bounded memo (session-keyed data is immutable; TTL caches live beside it). */
function capMap(m: Map<string, any>, cap = 48) {
  while (m.size > cap) {
    const oldest = m.keys().next()
    if (oldest.done) break
    m.delete(oldest.value)
  }
}

/** Session metadata never changes mid-session — memoize per explicit key. */
const sessionMemo = new Map<string, any>()
/** Driver lists never change mid-session — memoize per explicit key. */
const driversMemo = new Map<string, any>()
/** Lap history only grows — 30s TTL keeps tower counts fresh without refetching megabytes. */
const lapsMemo = new Map<string, { ts: number; data: any }>()
const LAPS_TTL_MS = 30_000
const stintsMemo = new Map<string, { ts: number; data: any }>()
const STINTS_TTL_MS = 60_000
/** Weather / track status crawl — 60s TTL, fetched over a bounded recent window. */
const slowMemo = new Map<string, { ts: number; data: any[] }>()
const SLOW_TTL_MS = 60_000

const of1 = (path: string, timeoutMs = 15_000) => getJson(`${OPENF1}${path}`, timeoutMs);

/** Latest session (any type) or a specific session by key. */
export async function fetchSession(sessionKey?: string) {
  if (sessionKey) {
    const hit = sessionMemo.get(sessionKey)
    if (hit) return hit
    const data = await of1(`/sessions?session_key=${encodeURIComponent(sessionKey)}`, 10_000)
    sessionMemo.set(sessionKey, data)
    capMap(sessionMemo)
    return data
  }
  return of1('/sessions?session_key=latest', 10_000)
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
export async function fetchDrivers(sessionKey: number | string) {
  const sk = String(sessionKey)
  const hit = driversMemo.get(sk)
  if (hit) return hit
  const data = await of1(`/drivers?session_key=${encodeURIComponent(sk)}`, 10_000)
  driversMemo.set(sk, data)
  capMap(driversMemo)
  return data
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
 *
 * Volume control: positions/intervals/race-control/pit go out fresh every
 * poll; laps ride a 30s memo and weather/track-status a 60s memo (the route
 * only ever reads the last element of those two).
 */
export async function fetchLiveWindow(sessionKey: number | string, sinceIso: string) {
  const sk = encodeURIComponent(String(sessionKey))
  const enc = encodeURIComponent(sinceIso)
  const settled = await Promise.allSettled([
    of1(`/position?session_key=${sk}&date>${enc}`, 12_000),
    of1(`/intervals?session_key=${sk}&date>${enc}`, 12_000),
    fetchLaps(sessionKey),
    cachedSlow('track_status', String(sessionKey)),
    cachedSlow('weather', String(sessionKey)),
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

/** Bounded recent slice of a slow-moving feed (weather, track status). */
async function cachedSlow(kind: 'weather' | 'track_status', sk: string): Promise<any[]> {
  const ck = `${kind}:${sk}`
  const hit = slowMemo.get(ck)
  if (hit && Date.now() - hit.ts < SLOW_TTL_MS) return hit.data
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const data = await of1(
    `/${kind}?session_key=${encodeURIComponent(sk)}&date>${encodeURIComponent(since)}`,
    10_000,
  ).catch(() => [])
  const list = Array.isArray(data) ? data : []
  slowMemo.set(ck, { ts: Date.now(), data: list })
  capMap(slowMemo)
  return list
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

/** Full lap history for a session (counts + last-lap times). Memoized 30s. */
export async function fetchLaps(sessionKey: number | string, driverNumber?: number) {
  const sk = String(sessionKey)
  const ck = `${sk}:${driverNumber ?? 'all'}`
  const hit = lapsMemo.get(ck)
  if (hit && Date.now() - hit.ts < LAPS_TTL_MS) return hit.data
  const dn = driverNumber != null ? `&driver_number=${encodeURIComponent(String(driverNumber))}` : ''
  const data = await of1(`/laps?session_key=${encodeURIComponent(sk)}${dn}`, 20_000)
  lapsMemo.set(ck, { ts: Date.now(), data })
  capMap(lapsMemo)
  return data
}

/**
 * Stint history for a session (one row per stint with its tyre compound).
 * Memoized 60s — stints only change on a pit stop, so a 5s poll shouldn't
 * re-fetch it. Empty on failure (never throws).
 */
export async function fetchStints(sessionKey: number | string) {
  const sk = String(sessionKey)
  const hit = stintsMemo.get(sk)
  if (hit && Date.now() - hit.ts < STINTS_TTL_MS) return hit.data
  const data = await of1(`/stints?session_key=${encodeURIComponent(sk)}`, 15_000).catch(() => [])
  stintsMemo.set(sk, { ts: Date.now(), data })
  capMap(stintsMemo)
  return data
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
