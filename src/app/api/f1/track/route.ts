import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidEventId } from '@/lib/api-validation'
import { fetchSession, fetchDrivers, fetchDriverWindow, fetchLaps } from '@/lib/f1-server'
import { decimateTrack, trackBounds } from '@/lib/f1'

/**
 * GET /api/f1/track?session_key=11377[&refresh=1]
 *   Circuit outline as an ordered [x, y] polyline in raw OpenF1 units (shared
 *   with the live car dots, so the map stays consistent): one clean flying lap (median-duration non-pit lap) from a mid-field runner,
 *   decimated to <=1500 points. Cached 6h (circuits don't move); refresh=1
 *   bypasses the cache.
 */

const TTL_MS = 6 * 3_600_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('session_key')
  if (sessionKey && !isValidEventId(sessionKey)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'session_key must be numeric' }, { status: 400 })
  }

  const key = `f1:track:${sessionKey ?? 'latest'}`
  const refresh = searchParams.get('refresh') === '1'
  const cached = refresh ? null : getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const sessions = await fetchSession(sessionKey ?? undefined)
    const session = Array.isArray(sessions) ? sessions[sessions.length - 1] : null
    if (!session?.session_key) {
      return NextResponse.json({ error: 'F1_NOT_FOUND', message: 'No such session' }, { status: 404 })
    }
    const sk = session.session_key
    const drivers = await fetchDrivers(sk)
    const numbers = (Array.isArray(drivers) ? drivers : [])
      .map((d: any) => d?.driver_number)
      .filter((n: any) => typeof n === 'number')
    if (!numbers.length) {
      return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'No drivers for session' }, { status: 502 })
    }
    // Outline from small windowed fetches (a full-session trace is megabytes
    // and gets throttled): prefer one clean flying lap via the lap history,
    // else a ~150s slice ending at mid-session (never the parked tail).
    const endMs = Math.min(
      Date.now(),
      session.date_end ? Date.parse(session.date_end) : Date.now(),
    )
    const midMs = session.date_start
      ? Math.min(endMs, Date.parse(session.date_start) + (endMs - Date.parse(session.date_start)) / 2)
      : endMs - 75_000
    const sliceStart = new Date(midMs - 75_000).toISOString()
    const sliceEnd = new Date(midMs + 75_000).toISOString()

    const outlineFor = async (driverNumber: number): Promise<[number, number][] | null> => {
      let laps: any[] = []
      try {
        laps = await fetchLaps(sk, driverNumber)
      } catch (e: any) {
        console.warn(`[f1/track] laps fetch failed (driver ${driverNumber}): ${e?.message ?? e}`)
      }
      const clean = (Array.isArray(laps) ? laps : []).filter(
        (l: any) => typeof l?.lap_duration === 'number' && l.lap_duration > 0 && !l.is_pit_out_lap && l.date_start,
      )
      let since = sliceStart
      let until: string | undefined = sliceEnd
      if (clean.length) {
        const durs = clean.map((l: any) => l.lap_duration).sort((a: number, b: number) => a - b)
        const median = durs[Math.floor(durs.length / 2)]
        const lap = clean.reduce((best: any, l: any) =>
          Math.abs(l.lap_duration - median) < Math.abs(best.lap_duration - median) ? l : best, clean[0])
        const start = Date.parse(lap.date_start)
        since = new Date(start - 2_000).toISOString()
        until = new Date(start + lap.lap_duration * 1000 + 2_000).toISOString()
      }
      const trace = await fetchDriverWindow(sk, driverNumber, since, until)
      const outline = decimateTrack(
        (Array.isArray(trace) ? trace : []).map((p: any) => ({ x: p?.x, y: p?.y })),
      )
      // A parked car traces a dot, not a lap — reject tiny outlines.
      if (outline.length < 50) return null
      const xs = outline.map((p) => p[0])
      if (Math.max(...xs) - Math.min(...xs) < 5000) return null
      return outline
    }

    // Try a few runners until one traces a real lap.
    let outline: [number, number][] | null = null
    const order = [Math.floor(numbers.length / 2), 0, numbers.length - 1, 1, numbers.length - 2]
    for (const i of order) {
      const n = numbers[i]
      if (typeof n !== 'number') continue
      try {
        outline = await outlineFor(n)
      } catch (e: any) {
        console.warn(`[f1/track] trace failed (driver ${n}): ${e?.message ?? e}`)
        outline = null
      }
      if (outline) break
    }
    if (!outline || outline.length < 50) {
      return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Not enough trace data yet' }, { status: 502 })
    }
    const data = {
      sessionKey: sk,
      location: session.location,
      outline,
      bounds: trackBounds(outline),
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/track] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Track outline unavailable' }, { status: 502 })
  }
}
