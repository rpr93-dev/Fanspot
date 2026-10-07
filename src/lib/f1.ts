/**
 * Formula 1 data layer (OpenF1 live timing + Jolpica calendar/standings).
 *
 * Pure helpers only — no fetching, no Node APIs — so the merge/format math
 * is unit-testable and safe to import anywhere. Upstream fetching lives in
 * the /api/f1/* routes (which add cacheService TTLs around these shapes).
 *
 * Conventions:
 * - OpenF1 team names are authoritative for colours
 *   (driver.team_colour), but local constructor records (teams.ts) key off
 *   F1_TEAM_ABBR for hub/team-page links.
 * - Track coordinates are raw OpenF1 units (roughly decimeters — a 6 km lap
 *   measures ~60,000 units). The track view plots (x, -y) so north is up.
 */

export interface F1Driver {
  number: number
  acronym: string
  firstName: string
  lastName: string
  team: string
  teamAbbr: string | null
  colour: string
}

export interface F1CarState {
  number: number
  position: number | null
  gapToLeader: number | string | null
  intervalToAhead: number | string | null
  x: number | null
  y: number | null
  laps: number
  lastLapSecs: number | null
  bestLapSecs: number | null
  /** Normalized tyre compound: SOFT | MEDIUM | HARD | INTERMEDIATE | WET. */
  tyre: string | null
  /** Whether the current set is new (vs scrubbed). */
  tyreNew: boolean | null
  /** Laps on the current set, when the feed reports it. */
  tyreLaps: number | null
  /** Stint number for the current set. */
  stint: number | null
  inPit: boolean
  dnf: boolean
  updatedAt: string | null
}

/**
 * Normalize a raw tyre compound ("SOFT", "S", "supersoft") into one of the
 * five the UI keys colours off, else null. Unknowns are passed through upper.
 */
export function tyreCompound(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim().toUpperCase()
  if (!s) return null
  if (s.startsWith('SOFT') || s === 'S' || s.includes('SUPERSOFT') || s.includes('ULTRASOFT')) return 'SOFT'
  if (s.startsWith('MED') || s === 'M') return 'MEDIUM'
  if (s.startsWith('HARD') || s === 'H') return 'HARD'
  if (s.startsWith('INTER') || s === 'I') return 'INTERMEDIATE'
  if (s.startsWith('WET') || s === 'W' || s === 'FULL WET') return 'WET'
  return s
}

export interface F1LiveSnapshot {
  sessionKey: number
  sessionName: string
  location: string
  state: 'upcoming' | 'live' | 'final'
  cars: F1CarState[]
  trackStatus: string | null
  lap: number
  totalLaps: number | null
  messages: { date: string; category: string; message: string }[]
  airTemp: number | null
  trackTemp: number | null
  fetchedAt: string
}

/** OpenF1/Jolpica team_name -> local constructor abbreviation (teams.ts). */
export const F1_TEAM_ABBR: Record<string, string> = {
  McLaren: 'MCL',
  Ferrari: 'FER',
  'Red Bull Racing': 'RBR',
  'Red Bull': 'RBR',
  Mercedes: 'MER',
  'Aston Martin': 'AMR',
  Alpine: 'ALP',
  'Alpine F1 Team': 'ALP',
  'Haas F1 Team': 'HAA',
  Haas: 'HAA',
  'Racing Bulls': 'RBU',
  /** Jolpica's name for the Racing Bulls outfit (Lawson, Tsunoda…). */
  'RB F1 Team': 'RBU',
  RB: 'RBU',
  Williams: 'WIL',
  Audi: 'AUD',
  Cadillac: 'CAD',
  'Cadillac F1 Team': 'CAD',
}

/** "+1.234" / "+1 LAP" / "—" for tower gaps. OpenF1 gaps are seconds or lap strings. */
export function formatGap(gap: number | string | null | undefined): string {
  if (gap == null) return '—'
  if (typeof gap === 'string') {
    const t = gap.trim().toUpperCase()
    if (t === '' || t === 'NONE') return '—'
    // OpenF1 interval strings look like "+1 LAP" / "+2 LAPS".
    const laps = /\+?(\d+)\s*LAPS?/.exec(t)
    if (laps) return `+${laps[1]} LAP${laps[1] === '1' ? '' : 'S'}`
    const n = Number(t.replace('+', ''))
    if (!Number.isFinite(n)) return gap
    gap = n
  }
  if (gap === 0) return 'LEADER'
  return `+${gap.toFixed(3)}`
}

/** "107.2" -> "1:47.200" for lap times. */
export function formatLapTime(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return '—'
  const m = Math.floor(secs / 60)
  const s = (secs - m * 60).toFixed(3).padStart(6, '0')
  return `${m}:${s}`
}

function latestBy<T>(rows: T[], key: (r: T) => number | null | undefined): Map<number, T> {
  const out = new Map<number, T>()
  for (const r of rows) {
    const n = (r as any)?.driver_number
    if (typeof n !== 'number') continue
    out.set(n, r)
  }
  return out
}

/**
 * Merge raw OpenF1 payloads into per-car states. Every input is "latest wins":
 * callers pass already-trimmed windows (positions/intervals/location since
 * T-minus-seconds, full laps list). Missing pieces stay null — never throw.
 */
export function mergeLiveState(input: {
  drivers: any[]
  positions: any[]
  intervals: any[]
  locations: any[]
  laps: any[]
  pitNow?: Set<number> | number[]
  dnf?: Set<number> | number[]
  stints?: any[]
  at?: string
}): F1CarState[] {
  const posMap = latestBy(input.positions, () => 0)
  const intMap = latestBy(input.intervals, () => 0)
  const locMap = latestBy(input.locations, () => 0)
  const pit = input.pitNow instanceof Set ? input.pitNow : new Set(input.pitNow ?? [])
  const dnf = input.dnf instanceof Set ? input.dnf : new Set(input.dnf ?? [])

  const lapsByDriver = new Map<number, { count: number; last: number | null; best: number | null }>()
  for (const l of input.laps ?? []) {
    const n = l?.driver_number
    if (typeof n !== 'number') continue
    const e = lapsByDriver.get(n) ?? { count: 0, last: null, best: null }
    e.count += 1
    const dur = typeof l?.lap_duration === 'number' ? l.lap_duration : null
    if (dur != null) {
      e.last = dur
      if (e.best == null || dur < e.best) e.best = dur
    }
    lapsByDriver.set(n, e)
  }

  // Latest stint per driver (OpenF1: one row per stint with its compound).
  const stintsByDriver = new Map<number, any>()
  for (const s of input.stints ?? []) {
    const n = s?.driver_number
    if (typeof n !== 'number') continue
    const prev = stintsByDriver.get(n)
    const rank = (x: any) => Number(x?.stint_number ?? x?.lap_start ?? 0)
    if (!prev || rank(s) >= rank(prev)) stintsByDriver.set(n, s)
  }

  const cars: F1CarState[] = []
  for (const d of input.drivers ?? []) {
    const n = d?.driver_number
    if (typeof n !== 'number') continue
    const pos = posMap.get(n) as any
    const iv = intMap.get(n) as any
    const loc = locMap.get(n) as any
    const laps = lapsByDriver.get(n)
    cars.push({
      number: n,
      position: typeof pos?.position === 'number' ? pos.position : null,
      gapToLeader: iv?.gap_to_leader ?? null,
      intervalToAhead: iv?.interval ?? null,
      x: typeof loc?.x === 'number' ? loc.x : null,
      y: typeof loc?.y === 'number' ? loc.y : null,
      laps: laps?.count ?? 0,
      lastLapSecs: laps?.last ?? null,
      bestLapSecs: laps?.best ?? null,
      tyre: tyreCompound(stintsByDriver.get(n)?.compound),
      tyreNew: null,
      tyreLaps: null,
      stint: stintsByDriver.get(n)?.stint_number != null ? Number(stintsByDriver.get(n)!.stint_number) : null,
      inPit: pit.has(n),
      dnf: dnf.has(n),
      updatedAt: loc?.date ?? pos?.date ?? iv?.date ?? input.at ?? null,
    })
  }
  // Tower order: classified by position, unclassified sink to the bottom.
  cars.sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
  return cars
}

/**
 * Decimate a location trace into a circuit outline (ordered [x, y] in raw
 * OpenF1 units — roughly decimeters, so a 6 km lap measures ~60,000 units
 * and 350 km/h moves ~250 units per 4 Hz sample). Timing-loop traces
 * contain teleport glitches (dropped samples reappear far away): the trace
 * is split on jumps over `maxJump` and only the longest clean run is kept —
 * that's the lap. Stride sampling then caps the size; callers cache the
 * result for hours. NOTE: live car dots use the same raw units, so the map
 * stays consistent — do not rescale one without the other.
 */
export function decimateTrack(
  points: { x: number; y: number }[],
  maxPoints = 1500,
  maxJump = 1000,
): [number, number][] {
  const clean = (points ?? []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
  if (!clean.length) return []
  const runs: { x: number; y: number }[][] = [[]]
  for (const p of clean) {
    const run = runs[runs.length - 1]
    if (run.length) {
      const prev = run[run.length - 1]
      const jump = Math.hypot(p.x - prev.x, p.y - prev.y)
      if (jump > maxJump) runs.push([])
    }
    runs[runs.length - 1].push(p)
  }
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a), runs[0])
  if (longest.length <= maxPoints) return longest.map((p) => [p.x, p.y])
  const stride = Math.ceil(longest.length / maxPoints)
  const out: [number, number][] = []
  for (let i = 0; i < longest.length; i += stride) out.push([longest[i].x, longest[i].y])
  return out
}

/** Bounding box of an outline, with 8% padding, for canvas fit. */
export function trackBounds(outline: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!outline.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of outline) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const padX = Math.max((maxX - minX) * 0.08, 1)
  const padY = Math.max((maxY - minY) * 0.08, 1)
  return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY }
}

/** Session liveness from the clock: live from 10 min before start until end + 15 min. */
export function sessionState(dateStart: string | null, dateEnd: string | null, nowMs = Date.now()): 'upcoming' | 'live' | 'final' {
  const start = dateStart ? Date.parse(dateStart) : NaN
  const end = dateEnd ? Date.parse(dateEnd) : NaN
  if (!Number.isFinite(start)) return 'upcoming'
  if (nowMs < start - 10 * 60_000) return 'upcoming'
  if (Number.isFinite(end) && nowMs > end + 15 * 60_000) return 'final'
  return 'live'
}

/* ------------------------------------------------------------------ */
/* f1-live-api bridge (self-hosted SignalR -> F1 live timing feed)     */
/* Pure mappers, so the route layer just fetches and hands over JSON.  */
/* ------------------------------------------------------------------ */

/** Parse a bridge lap time ("2:37.849" / "37.849") into seconds, else null. */
export function parseLapTime(v: string | null | undefined): number | null {
  if (!v || typeof v !== 'string') return null
  const parts = v.split(':').map((p) => Number(p))
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

/** Map bridge /drivers (or /timing) rows into the local F1Driver shape. */
export function bridgeDrivers(rows: any[]): F1Driver[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((d) => d && /^\d+$/.test(String(d.driver_number ?? d.number ?? '')))
    .map((d) => {
      const num = Number(d.driver_number ?? d.number)
      const full = String(d.name ?? '').trim()
      const parts = full.split(/\s+/)
      const lastName = parts.length > 1 ? parts[parts.length - 1] : full
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : ''
      const raw = d.team_colour ? String(d.team_colour) : ''
      const colour = raw ? (raw.startsWith('#') ? raw : `#${raw}`) : '#999999'
      const team = d.team ?? ''
      return {
        number: num,
        acronym: d.acronym ?? '',
        firstName,
        lastName,
        team,
        teamAbbr: F1_TEAM_ABBR[team] ?? null,
        colour,
      }
    })
}

/**
 * Merge the bridge's /status + /timing + /weather + /race-control into a
 * F1LiveSnapshot. The bridge does not expose car coordinates, so `x`/`y` stay
 * null — the track map degrades on its own while live.
 */
export function bridgeSnapshot(input: {
  status: any
  timing: any
  weather: any
  raceControl: any[]
}): F1LiveSnapshot | null {
  const status = input.status
  const timing = input.timing
  if (!status && !timing) return null
  const s = status?.session ?? {}
  const rows: any[] = Array.isArray(timing?.drivers) ? timing.drivers : []
  const cars: F1CarState[] = rows
    .map((d) => ({
      number: Number(d.driver_number),
      position: d.position != null ? Number(d.position) : null,
      gapToLeader: d.gap_to_leader ?? null,
      intervalToAhead: d.interval ?? null,
      x: null,
      y: null,
      laps: typeof d.laps_completed === 'number' ? d.laps_completed : 0,
      lastLapSecs: parseLapTime(d.last_lap_time),
      bestLapSecs: parseLapTime(d.best_lap_time),
      tyre: tyreCompound(d.tyre_compound),
      tyreNew: d.tyre_new === true ? true : d.tyre_new === false ? false : d.tyre_new === 'true' ? true : d.tyre_new === 'false' ? false : null,
      tyreLaps: typeof d.tyre_laps === 'number' ? d.tyre_laps : null,
      stint: d.stint_number != null && Number.isFinite(Number(d.stint_number)) ? Number(d.stint_number) : null,
      inPit: d.in_pit === true,
      dnf: d.retired === true,
      updatedAt: timing?.timestamp ?? null,
    }))
    .filter((c) => Number.isFinite(c.number))
  cars.sort((a, b) => (a.position ?? 999) - (b.position ?? 999))

  const state: F1LiveSnapshot['state'] = status?.live ? 'live' : status?.stale ? 'final' : 'upcoming'
  const lap =
    cars.reduce((m, c) => Math.max(m, c.laps), 0) || Number(status?.lap_count?.CurrentLap) || 0
  const messages = (Array.isArray(input.raceControl) ? input.raceControl : [])
    .slice(0, 8)
    .reverse()
    .map((m: any) => ({ date: m?.Utc ?? '', category: m?.Category ?? '', message: m?.Message ?? '' }))
  const w = input.weather ?? {}
  const numOr = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    sessionKey: Number(s.Key) || 0,
    sessionName: s.Name ?? timing?.session ?? 'Session',
    location: s.Meeting?.Location ?? '',
    state,
    cars,
    trackStatus: status?.track_status?.Message ?? status?.track_status?.Status ?? null,
    lap,
    totalLaps: null,
    messages,
    airTemp: numOr(w.AirTemp),
    trackTemp: numOr(w.TrackTemp),
    fetchedAt: new Date().toISOString(),
  }
}
