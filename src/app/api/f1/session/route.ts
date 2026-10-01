import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidEventId } from '@/lib/api-validation'
import { fetchSession, fetchDrivers, fetchSessionResult } from '@/lib/f1-server'
import { F1_TEAM_ABBR, sessionState } from '@/lib/f1'

/**
 * GET /api/f1/session?session_key=11377 (default: latest session overall)
 *   Session metadata + driver list (numbers, acronyms, team colours) +
 *   final classification when the session is over. Cached 30s.
 */

const TTL_MS = 30_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('session_key')
  if (sessionKey && !isValidEventId(sessionKey)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'session_key must be numeric' }, { status: 400 })
  }

  const key = `f1:session:${sessionKey ?? 'latest'}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const sessions = await fetchSession(sessionKey ?? undefined)
    const session = Array.isArray(sessions) ? sessions[sessions.length - 1] : null
    if (!session?.session_key) {
      return NextResponse.json({ error: 'F1_NOT_FOUND', message: 'No such session' }, { status: 404 })
    }
    const sk = session.session_key
    const [drivers, result] = await Promise.all([fetchDrivers(sk), fetchSessionResult(sk)])
    const state = sessionState(session.date_start ?? null, session.date_end ?? null)
    const data = {
      session: {
        key: sk,
        name: session.session_name,
        type: session.session_type,
        location: session.location,
        country: session.country_name ?? null,
        circuit: session.circuit_short_name ?? null,
        dateStart: session.date_start,
        dateEnd: session.date_end,
        state,
      },
      drivers: (Array.isArray(drivers) ? drivers : []).map((d: any) => ({
        number: d.driver_number,
        acronym: d.name_acronym,
        firstName: d.first_name,
        lastName: d.last_name,
        team: d.team_name,
        teamAbbr: F1_TEAM_ABBR[d.team_name] ?? null,
        colour: d.team_colour ? `#${d.team_colour}` : '#999999',
      })),
      result: (Array.isArray(result) ? result : []).map((r: any) => ({
        position: r.position,
        driverNumber: r.driver_number,
        laps: r.number_of_laps ?? null,
        points: r.points ?? null,
        gapToLeader: r.gap_to_leader ?? null,
        dnf: r.dnf === true,
        dns: r.dns === true,
        dsq: r.dsq === true,
      })),
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/session] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Session unavailable' }, { status: 502 })
  }
}
