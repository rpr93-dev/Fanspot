import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'

const reservedKeys = new Set(['athlete', 'stats', 'statistics', 'displayValue', 'value', 'team', 'id', 'uid', 'guid', 'type', 'slug', 'sequence'])

const statIdKeys = ['name', 'label', 'abbreviation', 'displayName', 'key', 'id']
const statValKeys = ['displayValue', 'value', 'stat', 'number']

function extractStats(a: any, categoryName?: string): Record<string, string> {
  const stats: Record<string, string> = {}

  const addEntry = (key: string, val: any) => {
    const v = val?.displayValue ?? val?.value ?? val
    if (key && v !== undefined && v !== null && v !== '') {
      stats[String(key)] = String(v)
    }
  }

  // Sources to check (a.values handled by category-level pairing, not here)
  const sources = [a?.stats, a?.statistics]

  for (const source of sources) {
    if (source == null) continue

    // Array source: [{ name, displayValue }, ...]
    if (Array.isArray(source)) {
      for (let i = 0; i < source.length; i++) {
        const entry = source[i]
        if (entry && typeof entry === 'object') {
          const key = statIdKeys.reduce((found, k) => found || (entry as any)?.[k], '')
          if (key) {
            const val = statValKeys.reduce((found, k) => found ?? (entry as any)?.[k], undefined)
            addEntry(key, val)
          } else {
            addEntry(categoryName ?? `__c${i}`, entry)
          }
        }
      }
      if (Object.keys(stats).length > 0) return stats
    }

    // Object source: { statName: { displayValue, value } }
    if (typeof source === 'object' && !Array.isArray(source)) {
      for (const key of Object.keys(source)) {
        addEntry(key, (source as any)[key])
      }
      if (Object.keys(stats).length > 0) return stats
    }
  }

  // Category-level stat: a.displayValue / a.value
  const dv = a?.displayValue ?? a?.value
  if (dv !== undefined && dv !== null && categoryName) {
    stats[categoryName] = String(dv)
    return stats
  }

  // Direct properties on a (catches flattened stats like a.completions = "21")
  for (const key of Object.keys(a ?? {})) {
    if (reservedKeys.has(key)) continue
    const val = a[key]
    if (val != null && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')) {
      stats[key] = String(val)
    }
  }

  return stats
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
            const stats = extractStats(a, raw)
            // Positional pairing: cat.labels / cat.displayNames + a.values
            if (Object.keys(stats).length === 0) {
              const labels = cat.labels ?? cat.displayNames?.map((d: any) => d.displayName ?? d.name ?? '') ?? []
              const values = a.values ?? []
              if (labels.length > 0 && values.length > 0) {
                for (let i = 0; i < Math.min(labels.length, values.length); i++) {
                  if (labels[i]) stats[labels[i]] = String(values[i])
                }
              }
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

    // Debug: raw athlete structure for first category of first team
    let debug: any = null
    try {
      const firstPlayer = boxscore.players?.[0]
      const firstCat = firstPlayer?.statistics?.[0]
      const firstAth = firstCat?.athletes?.[0]
      if (firstAth) {
        debug = {
          categoryName: firstCat?.name,
          athleteKeys: Object.keys(firstAth),
          rawAthlete: JSON.parse(JSON.stringify(firstAth)),
          rawAthleteStats: firstAth?.stats,
          extractedStats: extractStats(firstAth, firstCat?.name ?? ''),
        }
      }
    } catch { /* non-fatal */ }

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
        _debug: debug,
      },
    }, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
