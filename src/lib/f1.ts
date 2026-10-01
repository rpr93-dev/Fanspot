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
  inPit: boolean
  dnf: boolean
  updatedAt: string | null
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

/** OpenF1 team_name -> local constructor abbreviation (teams.ts). */
export const F1_TEAM_ABBR: Record<string, string> = {
  McLaren: 'MCL',
  Ferrari: 'FER',
  'Red Bull Racing': 'RBR',
  Mercedes: 'MER',
  'Aston Martin': 'AMR',
  Alpine: 'ALP',
  'Haas F1 Team': 'HAA',
  'Racing Bulls': 'RBU',
  Williams: 'WIL',
  Audi: 'AUD',
  Cadillac: 'CAD',
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
  at?: string
}): F1CarState[] {
  const posMap = latestBy(input.positions, () => 0)
  const intMap = latestBy(input.intervals, () => 0)
  const locMap = latestBy(input.locations, () => 0)
  const pit = input.pitNow instanceof Set ? input.pitNow : new Set(input.pitNow ?? [])
  const dnf = input.dnf instanceof Set ? input.dnf : new Set(input.dnf ?? [])

  const lapsByDriver = new Map<number, { count: number; last: number | null }>()
  for (const l of input.laps ?? []) {
    const n = l?.driver_number
    if (typeof n !== 'number') continue
    const e = lapsByDriver.get(n) ?? { count: 0, last: null }
    e.count += 1
    const dur = typeof l?.lap_duration === 'number' ? l.lap_duration : null
    if (dur != null) e.last = dur
    lapsByDriver.set(n, e)
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
