import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidEventId } from '@/lib/api-validation'
import {
  fetchSession, fetchDrivers, fetchLiveWindow, fetchAllLocations, fetchSessionResult, fetchLaps,
} from '@/lib/f1-server'
import { mergeLiveState, sessionState } from '@/lib/f1'

/**
 * GET /api/f1/live?session_key=11377 (default: latest session overall)
 *   One merged live snapshot: per-car position/gap/location/laps, track
 *   status, latest race-control messages, weather. The client polls every
 *   few seconds while the session is live; the server fans out a handful of
 *   upstream calls in parallel (location covers ALL drivers in one query)
 *   and caches the merged result for 5s so concurrent tabs share one burst.
 *   Completed sessions take the cheap path (drivers + classification + lap
 *   counts — no timing windows to poll).
 */

const TTL_MS = 5_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('session_key')
  if (sessionKey && !isValidEventId(sessionKey)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'session_key must be numeric' }, { status: 400 })
  }

  const key = `f1:live:${sessionKey ?? 'latest'}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const sessions = await fetchSession(sessionKey ?? undefined)
    const session = Array.isArray(sessions) ? sessions[sessions.length - 1] : null
    if (!session?.session_key) {
      return NextResponse.json({ error: 'F1_NOT_FOUND', message: 'No such session' }, { status: 404 })
    }
    const sk = session.session_key
    const clockState = sessionState(session.date_start ?? null, session.date_end ?? null)
    const drivers = await fetchDrivers(sk)

    let cars
    let trackStatus: string | null = null
    let messages: { date: string; category: string; message: string }[] = []
    let airTemp: number | null = null
    let trackTemp: number | null = null

    if (clockState === 'final') {
      // Cheap path: classification + lap history, no timing windows.
      const [result, laps] = await Promise.all([fetchSessionResult(sk), fetchLaps(sk).catch(() => [])])
      const posByDriver = new Map<number, any>()
      for (const r of Array.isArray(result) ? result : []) {
        if (typeof r?.driver_number === 'number') posByDriver.set(r.driver_number, r)
      }
      cars = mergeLiveState({
        drivers,
        positions: [...posByDriver.values()].map((r: any) => ({ driver_number: r.driver_number, position: r.position, date: null })),
        intervals: [...posByDriver.values()].map((r: any) => ({ driver_number: r.driver_number, gap_to_leader: r.gap_to_leader ?? null, date: null })),
        locations: [],
        laps: Array.isArray(laps) ? laps : [],
        dnf: [...posByDriver.values()].filter((r: any) => r.dnf === true).map((r: any) => r.driver_number),
        at: new Date().toISOString(),
      })
    } else {
      // Timing windows lag the wall clock (data lands seconds after the car
      // passes); look back far enough to always catch the latest sample.
      const sinceIso = new Date(Date.now() - 30_000).toISOString()
      const window = await fetchLiveWindow(sk, sinceIso)
      const locations = await fetchAllLocations(sk, sinceIso).catch(() => [])

      const pitNow = new Set<number>()
      for (const p of window.pit) {
        // A pit entry without a matching out-lap means the car is in the lane.
        if (typeof p?.driver_number === 'number' && p?.pit_duration == null) pitNow.add(p.driver_number)
      }
      cars = mergeLiveState({
        drivers,
        positions: window.positions,
        intervals: window.intervals,
        locations,
        laps: window.laps,
        pitNow,
        at: new Date().toISOString(),
      })

      const lastTrack = window.trackStatus[window.trackStatus.length - 1] as any
      const lastWeather = window.weather[window.weather.length - 1] as any
      trackStatus = lastTrack?.message ?? lastTrack?.status ?? null
      messages = window.raceControl.slice(-8).map((m: any) => ({
        date: m?.date ?? null,
        category: m?.category ?? '',
        message: m?.message ?? '',
      }))
      airTemp = typeof lastWeather?.air_temperature === 'number' ? lastWeather.air_temperature : null
      trackTemp = typeof lastWeather?.track_temperature === 'number' ? lastWeather.track_temperature : null
    }

    const lap = cars.reduce((m, c) => Math.max(m, c.laps), 0)
    // Fresh data overrides the wall clock (sessions often run long).
    const freshest = cars.reduce((m, c) => {
      const t = c.updatedAt ? Date.parse(c.updatedAt) : NaN
      return Number.isFinite(t) ? Math.max(m, t) : m
    }, NaN)
    const state = Number.isFinite(freshest) && Date.now() - freshest < 90_000
      ? 'live'
      : clockState === 'live' && cars.some((c) => c.position != null)
        ? 'live'
        : clockState

    const data = {
      sessionKey: sk,
      sessionName: session.session_name,
      location: session.location,
      state,
      cars,
      trackStatus,
      lap,
      totalLaps: null,
      messages,
      airTemp,
      trackTemp,
      fetchedAt: new Date().toISOString(),
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/live] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Live timing unavailable' }, { status: 502 })
  }
}
