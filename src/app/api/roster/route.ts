import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { fetchOrCache } from '@/lib/cache/cacheService'

function getSeasonYear(sport: string): number {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  switch (sport) {
    case 'NFL': return month >= 8 ? year : year - 1
    case 'NBA': case 'NHL': return month >= 10 ? year : year - 1
    case 'MLB': return year
    default: return year - 1
  }
}

const sportPrimaryStat: Record<string, string> = {
  NBA: 'points',
  NHL: 'points',
  NFL: 'fantasyPoints',
}

function extractPrimaryValue(sport: string, stats: Record<string, string>, positionAbbr: string): { value: number; label: string } {
  let val = 0
  let label = ''

  const pv = (n: string) => parseFloat((stats[n] ?? '').replace(/,/g, '')) || 0

  switch (sport) {
    case 'NBA':
      val = pv('points')
      label = 'PTS'
      break
    case 'NHL':
      val = pv('points')
      label = 'PTS'
      break
    case 'NFL':
      val = pv('fantasyPoints') || pv('totalYards')
      label = val === pv('fantasyPoints') && pv('fantasyPoints') > 0 ? 'FPTS' : 'YDS'
      break
    case 'MLB':
      if (['P', 'SP', 'RP'].includes(positionAbbr)) {
        const era = pv('era')
        val = era > 0 ? Math.round((10 - Math.min(era, 10)) / 10 * 1000) : 0
        label = 'ERA'
      } else {
        val = pv('ops') * 1000 || pv('onBasePlusSlugging') * 1000 || pv('battingAvg') * 1000
        label = 'OPS'
      }
      break
  }

  return { value: val, label }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const sportKey = sport.toUpperCase() as 'NFL' | 'NBA' | 'NHL' | 'MLB'
  const espnPath = espnSportMap[sportKey]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  try {
    // In-process memo (same pattern as the dashboard route): one build fans out to
    // ~2×roster-size upstream calls, so repeat hits within the TTL must not re-storm
    // ESPN — bursty first loads are exactly when per-call timeouts start tripping.
    const data = await fetchOrCache(`roster:${sportKey}:${team.toUpperCase()}`, 300_000, buildRoster)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    const statusMatch = String((err as Error)?.message ?? '').match(/^espn-status: (\d+)$/)
    if (statusMatch) {
      return NextResponse.json({ error: `ESPN API error ${statusMatch[1]}` }, { status: parseInt(statusMatch[1], 10) })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  async function buildRoster(): Promise<any> {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team!.toUpperCase()}/roster`,
      { signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) {
      throw new Error(`espn-status: ${res.status}`)
    }
    const data = await res.json()

    // Normalise to flat athletes array
    if (Array.isArray(data.athletes) && data.athletes[0]?.items) {
      const flat: any[] = []
      for (const group of data.athletes) {
        if (Array.isArray(group.items)) flat.push(...group.items)
      }
      data.athletes = flat
    }

    // Fetch season stats for each athlete
    if (Array.isArray(data.athletes) && data.athletes.length > 0) {
      const [sportName, leagueName] = espnPath.split('/')
      const season = getSeasonYear(sportKey)

      // ESPN publishes type-2 (regular season) statistics per season. Before Week 1
      // the current season-year split 404s for every player, which used to leave the
      // whole panel reading "No stats yet" for a month — so fall back to the most
      // recent season that actually has data and label it in the response.
      async function fetchSeasonStats(athleteId: number | string, year: number): Promise<any> {
        const url = `https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/seasons/${year}/types/2/athletes/${athleteId}/statistics?lang=en&region=us`
        return fetch(url, { signal: AbortSignal.timeout(8000) })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      }

      function collectStats(payload: any): Record<string, string> | null {
        const out: Record<string, string> = {}
        if (payload?.splits?.categories) {
          for (const cat of payload.splits.categories) {
            if (Array.isArray(cat.stats)) {
              for (const s of cat.stats) {
                if (s.name && s.displayValue) {
                  const existing = out[s.name]
                  if (!existing) {
                    out[s.name] = s.displayValue
                  } else {
                    const existingNum = parseFloat(existing.replace(/,/g, '')) || 0
                    const newNum = parseFloat(String(s.displayValue).replace(/,/g, '')) || 0
                    if (newNum > existingNum) {
                      out[s.name] = s.displayValue
                    }
                  }
                }
              }
            }
          }
        }
        return Object.keys(out).length > 0 ? out : null
      }

      // Pass 1: the current season year for every athlete.
      let currentHits = 0
      const currentPayloads = await Promise.allSettled(
        data.athletes.map((a: any) => (a.id ? fetchSeasonStats(a.id, season) : Promise.resolve(null)))
      )
      const currentStats = data.athletes.map((_: any, i: number) => {
        const result = currentPayloads[i]
        const stats = result.status === 'fulfilled' ? collectStats(result.value) : null
        if (stats) currentHits++
        return stats
      })

      // Pass 2: only athletes the current season left empty fall back to the previous
      // season (in August the whole league lands here; in-season it is just a handful).
      let prevHits = 0
      const prevSeason = season - 1
      const misses = data.athletes
        .map((a: any, i: number) => ({ a, i }))
        .filter(({ i }: { i: number }) => !currentStats[i])
      const prevResults = await Promise.allSettled(
        misses.map(({ a }: { a: any }) => (a.id ? fetchSeasonStats(a.id, prevSeason) : Promise.resolve(null)))
      )
      const prevByIndex = new Map<number, Record<string, string> | null>()
      misses.forEach(({ i }: { i: number }, k: number) => {
        const result = prevResults[k]
        const stats = result.status === 'fulfilled' ? collectStats(result.value) : null
        if (stats) prevHits++
        prevByIndex.set(i, stats)
      })

      // The headline label: whichever season supplied most of the visible numbers.
      data.statsSeason = currentHits >= prevHits ? season : prevSeason

      for (let i = 0; i < data.athletes.length; i++) {
        const seasonStats = currentStats[i] ?? prevByIndex.get(i) ?? null
        data.athletes[i].seasonStatsYear = seasonStats === currentStats[i] ? season : prevSeason

        const pos = data.athletes[i]?.position?.abbreviation ?? ''
        const pv = extractPrimaryValue(sportKey, seasonStats ?? {}, pos)

        data.athletes[i].seasonStats = seasonStats
        data.athletes[i].primaryStat = pv.value
        data.athletes[i].primaryStatLabel = pv.label
      }

      // Sort by primaryStat descending, players without stats at end
      data.athletes.sort((a: any, b: any) => (b.primaryStat ?? -1) - (a.primaryStat ?? -1))
    }

    return data
  }
}
