import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'

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

function extractStats(a: any): Record<string, string> {
  const stats: Record<string, string> = {}

  // Format 1: a.stats = [{ name, displayValue }, ...]
  if (Array.isArray(a.stats)) {
    for (const s of a.stats) {
      if (s?.name) stats[s.name] = s.displayValue ?? String(s.value ?? '')
    }
  }

  // Format 2: a.stats = { statName: { displayValue, value }, ... }
  if (a.stats && typeof a.stats === 'object' && !Array.isArray(a.stats)) {
    for (const key of Object.keys(a.stats)) {
      const val = a.stats[key]
      if (val && typeof val === 'object') {
        stats[key] = val.displayValue ?? String(val.value ?? '')
      }
    }
  }

  // Format 3: a.statistics = [{ name, displayValue }, ...]
  if (Array.isArray(a.statistics)) {
    for (const s of a.statistics) {
      if (s?.name) stats[s.name] = s.displayValue ?? String(s.value ?? '')
    }
  }

  // Format 4: Direct string/number properties on a
  for (const key of Object.keys(a)) {
    if (['athlete', 'stats', 'statistics', 'displayValue', 'value'].includes(key)) continue
    const val = a[key]
    if (val && (typeof val === 'string' || typeof val === 'number')) {
      stats[key] = String(val)
    }
  }

  return stats
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
      { signal: AbortSignal.timeout(15000), next: { revalidate: 300 } }
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
        const categories: any[] = []

        for (const cat of (p.statistics ?? [])) {
          const raw = cat.name ?? cat.label ?? ''
          if (!raw) continue
          const statNames = new Set<string>()
          const athletes: any[] = []

          for (const a of (cat.athletes ?? [])) {
            const id = a.athlete?.id
            if (!id) continue
            const stats = extractStats(a)
            if (Object.keys(stats).length === 0) {
              const dv = a.displayValue ?? a.value
              if (dv !== undefined && dv !== null) stats[raw] = String(dv)
            }
            for (const key of Object.keys(stats)) statNames.add(key)
            athletes.push({
              id,
              displayName: a.athlete?.displayName ?? '',
              jersey: a.athlete?.jersey ?? '',
              position: a.athlete?.position?.abbreviation ?? '',
              stats,
            })
          }

          if (athletes.length > 0) {
            let label = raw.charAt(0).toUpperCase() + raw.slice(1)
            if (raw === 'defensive') label = 'Defense'
            categories.push({ label, statNames: Array.from(statNames), athletes })
          }
        }

        return { teamAbbr, categories }
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
