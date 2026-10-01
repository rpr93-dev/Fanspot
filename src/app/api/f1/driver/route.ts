import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidSeason } from '@/lib/api-validation'
import { fetchJolpica } from '@/lib/f1-server'
import { F1_TEAM_ABBR } from '@/lib/f1'

/**
 * GET /api/f1/driver?code=VER&season=2026
 *   Driver profile: championship row + per-round results (position, points,
 *   team, status) for the detail page. Cached 15m.
 */

const TTL_MS = 15 * 60_000
const CODE_RE = /^[A-Z]{3}$/

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rawCode = (searchParams.get('code') ?? '').toUpperCase()
  const seasonParam = searchParams.get('season') ?? String(new Date().getFullYear())
  if (!CODE_RE.test(rawCode)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'code must be a 3-letter driver code' }, { status: 400 })
  }
  if (!isValidSeason(seasonParam)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'season must be a 4-digit year' }, { status: 400 })
  }

  const key = `f1:driver:${seasonParam}:${rawCode}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const [standingsJson, resultsJson] = await Promise.all([
      fetchJolpica(`/${encodeURIComponent(seasonParam)}/driverStandings.json`),
      fetchJolpica(`/${encodeURIComponent(seasonParam)}/drivers/${encodeURIComponent(rawCode)}/results.json`),
    ])
    const dRows = standingsJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
    const row = dRows.find((r: any) => (r.Driver?.code ?? '').toUpperCase() === rawCode) ?? null
    const races = resultsJson?.MRData?.RaceTable?.Races ?? []

    const rounds = races.map((rc: any) => {
      const res = rc?.Results?.[0] ?? {}
      return {
        round: Number(rc.round),
        name: rc.raceName,
        locality: rc?.Circuit?.Location?.locality ?? null,
        country: rc?.Circuit?.Location?.country ?? null,
        date: rc.date,
        position: res.position ?? null,
        positionText: res.positionText ?? res.position ?? null,
        points: res.points != null ? Number(res.points) : 0,
        grid: res.grid ?? null,
        laps: res.laps ?? null,
        status: res.status ?? null,
        team: res.Constructor?.name ?? null,
        teamAbbr:
          (F1_TEAM_ABBR as Record<string, string>)[res.Constructor?.name ?? ''] ??
          (row?.Constructors?.[0]?.name ? (F1_TEAM_ABBR as Record<string, string>)[row.Constructors[0].name] ?? null : null),
      }
    })

    const data = {
      season: seasonParam,
      code: rawCode,
      driver: row
        ? {
            position: Number(row.position),
            points: Number(row.points),
            wins: Number(row.wins),
            name: `${row.Driver?.givenName ?? ''} ${row.Driver?.familyName ?? ''}`.trim(),
            number: row.Driver?.permanentNumber ?? null,
            nationality: row.Driver?.nationality ?? null,
            team: row.Constructors?.[0]?.name ?? rounds[rounds.length - 1]?.team ?? null,
            teamAbbr:
              (F1_TEAM_ABBR as Record<string, string>)[row.Constructors?.[0]?.name ?? ''] ??
              rounds[rounds.length - 1]?.teamAbbr ??
              null,
          }
        : rounds.length
          ? {
              position: null,
              points: rounds.reduce((s: number, r: any) => s + (r.points || 0), 0),
              wins: rounds.filter((r: any) => r.position === '1').length,
              name: null,
              number: null,
              nationality: null,
              team: rounds[rounds.length - 1]?.team ?? null,
              teamAbbr: rounds[rounds.length - 1]?.teamAbbr ?? null,
            }
          : null,
      rounds,
    }
    if (!data.driver && !rounds.length) {
      return NextResponse.json({ error: 'F1_NOT_FOUND', message: 'No such driver' }, { status: 404 })
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/driver] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Driver unavailable' }, { status: 502 })
  }
}
