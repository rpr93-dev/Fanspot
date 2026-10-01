import { NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidSeason } from '@/lib/api-validation'
import { fetchJolpica } from '@/lib/f1-server'

/**
 * GET /api/f1/schedule?season=2026
 *   Jolpica calendar normalized: rounds with circuit, locality, date/time
 *   plus the next upcoming round. Cached 1h (calendars barely move).
 */

const TTL_MS = 60 * 60_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season')
  const season = seasonParam ?? String(new Date().getFullYear())
  if (!isValidSeason(season)) {
    return NextResponse.json({ error: 'INVALID_PARAM', message: 'season must be a 4-digit year' }, { status: 400 })
  }

  const key = `f1:schedule:${season}`
  const cached = getCached<any>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) return NextResponse.json(cached.data)

  try {
    const json = await fetchJolpica(`/${encodeURIComponent(season)}.json`)
    const races = json?.MRData?.RaceTable?.Races ?? []
    const now = Date.now()
    const rounds = races.map((r: any) => {
      const startIso = r.time ? `${r.date}T${r.time}` : `${r.date}T00:00:00Z`
      return {
        season: r.season,
        round: Number(r.round),
        name: r.raceName,
        circuit: r.Circuit?.circuitName ?? null,
        locality: r.Circuit?.Location?.locality ?? null,
        country: r.Circuit?.Location?.country ?? null,
        date: r.date,
        time: r.time ?? null,
        startIso,
        url: r.url ?? null,
      }
    })
    const upcoming = rounds.filter((r: any) => Date.parse(r.startIso) >= now - 3 * 3_600_000)
    const data = { season, rounds, next: upcoming[0] ?? null, count: rounds.length }
    setCached(key, data)
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[f1/schedule] upstream failed:', err?.message ?? err)
    return NextResponse.json({ error: 'F1_UNAVAILABLE', message: 'Schedule unavailable' }, { status: 502 })
  }
}
