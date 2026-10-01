import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidSeason, isValidTeam } from '@/lib/api-validation'
import { fetchJolpica } from '@/lib/f1-server'
import { F1_TEAM_ABBR } from '@/lib/f1'
import { teams } from '@/data/teams'

/**
 * GET /api/f1/constructor?team=MCL&season=2026 (or ?id=f1-mcl)
 *   Constructor profile: championship row + per-round results (both cars,
 *   points) for the team detail page. Cached 15m.
 */

const TTL_MS = 15 * 60_000

function abbrToConstructorId(abbr: string): string | null {
  const t = teams.find((x) => x.sport === 'F1' && x.abbreviation === abbr.toUpperCase())
  return t ? t.abbreviation : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season') ?? String(new Date().getFullYear())
  const teamParam = (searchParams.get('team') ?? searchParams.get('id') ?? '').toUpperCase()
  // ?id=f1-mcl style local ids also accepted.
  const abbr = teamParam.startsWith('F1-') ? teamParam.slice(3) : teamParam
  if (!isValidTeam(abbr) || !abbrToConstructorId(abbr)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'team must be a constructor abbr (MCL, FER, …)' }, { status: 400 })
  }
  if (!isValidSeason(seasonParam)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'season must be a 4-digit year' }, { status: 400 })
  }

  const key = `f1:constructor:${seasonParam}:${abbr}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    // Resolve the Jolpica constructor id (e.g. "mclaren") via the standings feed.
    const [standingsJson, resultsJson] = await Promise.all([
      fetchJolpica(`/${encodeURIComponent(seasonParam)}/constructorStandings.json`),
      (async () => {
        const c = await fetchJolpica(`/${encodeURIComponent(seasonParam)}/constructorStandings.json`).catch(() => null)
        const rows = c?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
        const match = rows.find((r: any) => {
          const name = r?.Constructor?.name ?? ''
          return (F1_TEAM_ABBR as Record<string, string>)[name] === abbr
        })
        const cid = match?.Constructor?.constructorId
        if (!cid) return null
        return fetchJolpica(`/${encodeURIComponent(seasonParam)}/constructors/${encodeURIComponent(cid)}/results.json`)
      })(),
    ])
    const cRows = standingsJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
    const row = cRows.find((r: any) => (F1_TEAM_ABBR as Record<string, string>)[r?.Constructor?.name ?? ''] === abbr) ?? null
    const races = resultsJson?.MRData?.RaceTable?.Races ?? []

    const rounds = races.map((rc: any) => {
      const cars = (rc?.Results ?? []).map((res: any) => ({
        code: res?.Driver?.code ?? null,
        name: `${res?.Driver?.givenName ?? ''} ${res?.Driver?.familyName ?? ''}`.trim(),
        position: res.position ?? null,
        positionText: res.positionText ?? res.position ?? null,
        points: res.points != null ? Number(res.points) : 0,
        grid: res.grid ?? null,
        status: res.status ?? null,
      }))
      return {
        round: Number(rc.round),
        name: rc.raceName,
        locality: rc?.Circuit?.Location?.locality ?? null,
        date: rc.date,
        cars,
        points: cars.reduce((s: number, c: any) => s + (c.points || 0), 0),
      }
    })

    const data = {
      season: seasonParam,
      teamAbbr: abbr,
      constructor: row
        ? {
            position: Number(row.position),
            points: Number(row.points),
            wins: Number(row.wins),
            name: row.Constructor?.name ?? null,
          }
        : null,
      rounds,
    }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/constructor] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Constructor unavailable' }, { status: 502 })
  }
}
