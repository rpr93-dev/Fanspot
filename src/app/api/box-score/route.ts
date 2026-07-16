import { NextResponse } from 'next/server'

const espnSportMap: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

function extractLinescores(teamData: any): number[] {
  const raw = teamData?.linescores
  if (!raw || !Array.isArray(raw)) return []
  return raw.map((ls: any) => {
    if (typeof ls === 'number') return ls
    if (typeof ls === 'string') return parseInt(ls, 10) || 0
    if (typeof ls === 'object' && ls !== null) {
      const v = ls.value ?? ls.displayValue
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseInt(v, 10) || 0
    }
    return 0
  })
}

function extractHeaderLinescores(competitor: any): number[] {
  const raw = competitor?.linescores
  if (!raw || !Array.isArray(raw)) return []
  return raw.map((ls: any) => {
    if (typeof ls === 'number') return ls
    if (typeof ls === 'object' && ls !== null) {
      const v = ls.value ?? ls.displayValue
      if (typeof v === 'number') return v
      if (typeof v === 'string') return parseInt(v, 10) || 0
    }
    return 0
  })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const eventId = searchParams.get('eventId')

  if (!sport || !eventId) {
    return NextResponse.json({ error: 'Missing sport or eventId' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${eventId}`,
      { next: { revalidate: 300 } }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
    }
    const data = await res.json()

    const boxscore = data?.boxscore
    if (!boxscore) {
      return NextResponse.json({ boxScore: null })
    }

    let teams: any[] = []
    let playerStats: any[] = []

    try {
      const headerCompetitors = data?.header?.competitions?.[0]?.competitors ?? []
      teams = (boxscore.teams ?? []).map((t: any) => {
        const abbr = t.team?.abbreviation ?? ''
        const headerComp = headerCompetitors.find(
          (c: any) => (c.team?.abbreviation ?? '').toUpperCase() === abbr.toUpperCase()
        )
        let linescores = extractLinescores(t)
        if (linescores.length === 0 && headerComp) {
          linescores = extractHeaderLinescores(headerComp)
        }
        return {
          abbreviation: abbr,
          displayName: t.team?.displayName ?? '',
          logo: t.team?.logo ?? '',
          linescores,
          statistics: (t.statistics ?? []).map((s: any) => ({
            name: s.name,
            displayValue: s.displayValue,
            abbreviation: s.abbreviation,
          })),
        }
      })

      playerStats = (boxscore.players ?? []).map((p: any) => {
        const teamAbbr = p.team?.abbreviation ?? teams.find((tt: any) => tt.abbreviation.toUpperCase() === (p.team?.abbreviation ?? '').toUpperCase())?.abbreviation ?? ''
        const athletesMap = new Map<string, any>()
        const allStatNames = new Set<string>()

        for (const cat of (p.statistics ?? [])) {
          for (const a of (cat.athletes ?? [])) {
            const id = a.athlete?.id
            if (!id) continue
            if (!athletesMap.has(id)) {
              athletesMap.set(id, {
                id,
                displayName: a.athlete?.displayName ?? '',
                jersey: a.athlete?.jersey ?? '',
                position: a.athlete?.position?.abbreviation ?? '',
                stats: {} as Record<string, string>,
              })
            }
            const entry = athletesMap.get(id)
            for (const s of (a.stats ?? [])) {
              if (s.name) {
                allStatNames.add(s.name)
                entry.stats[s.name] = s.displayValue ?? ''
              }
            }
          }
        }

        return {
          teamAbbr,
          statNames: Array.from(allStatNames),
          athletes: Array.from(athletesMap.values()),
        }
      })
    } catch (e) {
      // Partial data still usable
    }

    const status = data?.header?.competitions?.[0]?.status?.type

    return NextResponse.json({
      boxScore: {
        teams,
        playerStats,
        status: status
          ? {
              state: status.state,
              completed: status.completed,
              description: status.description,
              detail: status.detail,
              shortDetail: status.shortDetail,
            }
          : null,
      },
    }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
