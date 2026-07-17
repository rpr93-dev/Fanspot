import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'

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
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/roster`,
      { signal: AbortSignal.timeout(15000), next: { revalidate: 300 } }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
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

      const statsResults = await Promise.allSettled(
        data.athletes.map((a: any) => {
          if (!a.id) return Promise.resolve(null)
          const url = `https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/seasons/${season}/types/2/athletes/${a.id}/statistics?lang=en&region=us`
          return fetch(url, { signal: AbortSignal.timeout(5000) })
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        })
      )

      for (let i = 0; i < data.athletes.length; i++) {
        const result = statsResults[i]
        const seasonStats: Record<string, string> = {}
        let primaryStat = 0
        let primaryLabel = ''

        if (result.status === 'fulfilled' && result.value?.splits?.categories) {
          for (const cat of result.value.splits.categories) {
            if (Array.isArray(cat.stats)) {
              for (const s of cat.stats) {
                if (s.name && s.displayValue) {
                  const existing = seasonStats[s.name]
                  if (!existing) {
                    seasonStats[s.name] = s.displayValue
                  } else {
                    const existingNum = parseFloat(existing.replace(/,/g, '')) || 0
                    const newNum = parseFloat(String(s.displayValue).replace(/,/g, '')) || 0
                    if (newNum > existingNum) {
                      seasonStats[s.name] = s.displayValue
                    }
                  }
                }
              }
            }
          }
        }

        const pos = data.athletes[i]?.position?.abbreviation ?? ''
        const pv = extractPrimaryValue(sportKey, seasonStats, pos)
        primaryStat = pv.value
        primaryLabel = pv.label

        data.athletes[i].seasonStats = Object.keys(seasonStats).length > 0 ? seasonStats : null
        data.athletes[i].primaryStat = primaryStat
        data.athletes[i].primaryStatLabel = primaryLabel
      }

      // Sort by primaryStat descending, players without stats at end
      data.athletes.sort((a: any, b: any) => (b.primaryStat ?? -1) - (a.primaryStat ?? -1))
    }

    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
