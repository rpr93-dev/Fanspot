import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidSeason } from '@/lib/api-validation'
import { fetchJolpica } from '@/lib/f1-server'
import { F1_TEAM_ABBR } from '@/lib/f1'

/**
 * GET /api/f1/standings?season=2026
 *   Driver + constructor championships normalized with local team abbrs.
 *   Cached 30m (standings only move on race weekends).
 */

const TTL_MS = 30 * 60_000

function teamAbbrFor(name: string): string | null {
  if (!name) return null
  if (F1_TEAM_ABBR[name]) return F1_TEAM_ABBR[name]
  const lower = name.toLowerCase()
  for (const [full, abbr] of Object.entries(F1_TEAM_ABBR)) {
    const first = full.split(' ')[0].toLowerCase()
    if (lower.includes(first) || first.includes(lower.split(' ')[0])) return abbr
  }
  return null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season')
  const season = seasonParam ?? String(new Date().getFullYear())
  if (!isValidSeason(season)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'season must be a 4-digit year' }, { status: 400 })
  }

  const key = `f1:standings:${season}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const [driversJson, constructorsJson] = await Promise.all([
      fetchJolpica(`/${encodeURIComponent(season)}/driverStandings.json`),
      fetchJolpica(`/${encodeURIComponent(season)}/constructorStandings.json`),
    ])
    const dLists = driversJson?.MRData?.StandingsTable?.StandingsLists ?? []
    const cLists = constructorsJson?.MRData?.StandingsTable?.StandingsLists ?? []
    const dRows = dLists[0]?.DriverStandings ?? []
    const cRows = cLists[0]?.ConstructorStandings ?? []
    const data = {
      season,
      round: dLists[0]?.round ? Number(dLists[0].round) : null,
      drivers: dRows.map((r: any) => ({
        position: Number(r.position),
        points: Number(r.points),
        wins: Number(r.wins),
        code: r.Driver?.code ?? null,
        name: `${r.Driver?.givenName ?? ''} ${r.Driver?.familyName ?? ''}`.trim(),
        team: r.Constructors?.[0]?.name ?? null,
        teamAbbr: teamAbbrFor(r.Constructors?.[0]?.name ?? ''),
      })),
      constructors: cRows.map((r: any) => ({
        position: Number(r.position),
        points: Number(r.points),
        wins: Number(r.wins),
        name: r.Constructor?.name ?? null,
        teamAbbr: teamAbbrFor(r.Constructor?.name ?? ''),
      })),
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/standings] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Standings unavailable' }, { status: 502 })
  }
}
