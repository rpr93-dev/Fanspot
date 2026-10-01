import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidSeason, isValidEventId } from '@/lib/api-validation'
import { fetchJolpica, fetchMeetings, fetchSessionsByMeeting, fetchSessionResult, fetchDrivers } from '@/lib/f1-server'
import { F1_TEAM_ABBR, sessionState } from '@/lib/f1'

/**
 * GET /api/f1/weekend?season=2026&round=5 (or ?meeting_key=1234)
 *   Whole Grand Prix weekend: Jolpica round info + matched OpenF1 meeting +
 *   every session (Practice/Qualifying/Sprint/Race) with state and final
 *   classification. Past weekends return full tables; the current weekend
 *   returns live/ upcoming states so the client can link into Race Center.
 *   Cached 60s (sessions flip live on race day, results are otherwise static).
 */

const TTL_MS = 60_000

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season') ?? String(new Date().getFullYear())
  const roundParam = searchParams.get('round')
  const meetingParam = searchParams.get('meeting_key')
  if (!isValidSeason(seasonParam)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'season must be a 4-digit year' }, { status: 400 })
  }
  if (roundParam && !isValidEventId(roundParam)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'round must be numeric' }, { status: 400 })
  }
  if (meetingParam && !isValidEventId(meetingParam)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'meeting_key must be numeric' }, { status: 400 })
  }
  if (!roundParam && !meetingParam) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'round or meeting_key required' }, { status: 400 })
  }

  const key = `f1:weekend:${seasonParam}:${roundParam ?? `m${meetingParam}`}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    // Jolpica round info (circuit, locality, date) — skipped for meeting_key lookups.
    let race: any = null
    if (roundParam) {
      const sched = await fetchJolpica(`/${encodeURIComponent(seasonParam)}.json`)
      const races = sched?.MRData?.RaceTable?.Races ?? []
      race = races.find((r: any) => String(r.round) === String(Number(roundParam))) ?? null
      if (!race) {
        return NextResponse.json({ error: 'F1_NOT_FOUND', message: 'No such round' }, { status: 404 })
      }
    }

    const meetingsRaw = await fetchMeetings(seasonParam).catch(() => [])
    const meetings = Array.isArray(meetingsRaw) ? meetingsRaw : []

    let meeting: any = null
    if (meetingParam) {
      meeting = meetings.find((m: any) => String(m.meeting_key) === String(Number(meetingParam))) ?? null
    } else if (race) {
      const raceName = norm(race.raceName)
      const locality = norm(race?.Circuit?.Location?.locality)
      const country = norm(race?.Circuit?.Location?.country)
      const raceDate = Date.parse(race.time ? `${race.date}T${race.time}` : `${race.date}T00:00:00Z`)
      let best = -1
      for (const m of meetings) {
        const mName = norm(m.meeting_name)
        const mLoc = norm(m.location)
        const mCountry = norm(m.country_name ?? m.country)
        let score = 0
        if (locality && (mLoc.includes(locality) || locality.includes(mLoc))) score += 4
        if (country && (mCountry.includes(country) || country.includes(mCountry))) score += 2
        // Token overlap on GP name ("bahrain grand prix" vs "bahrain grand prix").
        const tokens = raceName.split(' ').filter((t) => t.length > 2 && t !== 'grand' && t !== 'prix')
        for (const t of tokens) if (mName.includes(t)) score += 2
        if (Number.isFinite(raceDate) && m.date_start) {
          const d = Math.abs(Date.parse(m.date_start) - raceDate) / 86_400_000
          if (d < 8) score += 3 - d / 4
        }
        if (score > best) {
          best = score
          meeting = m
        }
      }
      if (best < 2) meeting = null
    }

    if (!meeting) {
      // No OpenF1 meeting (future race far out, or archive gap): still return
      // the Jolpica round so the page renders with schedule info.
      const data = { season: seasonParam, round: roundParam ? Number(roundParam) : null, race, meeting: null, sessions: [], drivers: [] }
      setCached(key, data)
      return NextResponse.json(data)
    }

    const sessionsRaw = await fetchSessionsByMeeting(meeting.meeting_key).catch(() => [])
    const sessionsList = (Array.isArray(sessionsRaw) ? sessionsRaw : []).sort(
      (a: any, b: any) => Date.parse(a.date_start) - Date.parse(b.date_start),
    )

    // Classification per session (empty while upcoming/running).
    const results = await Promise.all(
      sessionsList.map((s: any) => fetchSessionResult(s.session_key).catch(() => [])),
    )
    const sessions = sessionsList.map((s: any, i: number) => {
      const r = Array.isArray(results[i]) ? results[i] : []
      return {
        key: s.session_key,
        name: s.session_name,
        type: s.session_type,
        location: s.location,
        dateStart: s.date_start,
        dateEnd: s.date_end,
        state: sessionState(s.date_start ?? null, s.date_end ?? null),
        result: r.map((row: any) => ({
          position: row.position,
          driverNumber: row.driver_number,
          laps: row.number_of_laps ?? null,
          points: row.points ?? null,
          gapToLeader: row.gap_to_leader ?? null,
          dnf: row.dnf === true,
          dns: row.dns === true,
          dsq: row.dsq === true,
        })),
      }
    })

    // Driver directory from the headline session (Race preferred, else latest).
    const headline = sessionsList.find((s: any) => s.session_name === 'Race') ?? sessionsList[sessionsList.length - 1]
    let drivers: any[] = []
    if (headline) {
      const d = await fetchDrivers(headline.session_key).catch(() => [])
      drivers = (Array.isArray(d) ? d : []).map((x: any) => ({
        number: x.driver_number,
        acronym: x.name_acronym,
        firstName: x.first_name,
        lastName: x.last_name,
        team: x.team_name,
        teamAbbr: (F1_TEAM_ABBR as Record<string, string>)[x.team_name] ?? null,
        colour: x.team_colour ? `#${x.team_colour}` : '#999999',
      }))
    }

    const data = {
      season: seasonParam,
      round: roundParam ? Number(roundParam) : null,
      race: race
        ? {
            round: Number(race.round),
            name: race.raceName,
            circuit: race.Circuit?.circuitName ?? null,
            locality: race.Circuit?.Location?.locality ?? null,
            country: race.Circuit?.Location?.country ?? null,
            date: race.date,
            time: race.time ?? null,
            url: race.url ?? null,
          }
        : null,
      meeting: {
        key: meeting.meeting_key,
        name: meeting.meeting_name,
        location: meeting.location,
        country: meeting.country_name ?? meeting.country ?? null,
        circuit: meeting.circuit_short_name ?? null,
        dateStart: meeting.date_start,
      },
      sessions,
      drivers,
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/weekend] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Weekend unavailable' }, { status: 502 })
  }
}
