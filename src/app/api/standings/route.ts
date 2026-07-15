import { NextResponse } from 'next/server'
import { teams } from '@/data/teams'
import { getEspnAbbr } from '@/lib/providers/espn'

const espnSportMap: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

interface StandingRow {
  abbr: string
  name: string
  logo: string
  record: string
  conference: string
  division: string
}

interface ConferenceGroup {
  name: string
  divisions: { name: string; teams: StandingRow[] }[]
}

function parsePct(record: string): number {
  const parts = record.split('-')
  if (parts.length >= 2) {
    const w = parseInt(parts[0], 10)
    const l = parseInt(parts[1], 10)
    if (w + l > 0) return w / (w + l)
  }
  return 0
}

function groupStandings(standings: StandingRow[]): ConferenceGroup[] {
  const sorted = standings.sort((a, b) => {
    const pctA = parsePct(a.record)
    const pctB = parsePct(b.record)
    return pctB - pctA
  })

  const conferences = [...new Set(sorted.map((s) => s.conference).filter(Boolean))].sort()
  return conferences.map((conf) => {
    const confTeams = sorted.filter((s) => s.conference === conf)
    const divisions = [...new Set(confTeams.map((s) => s.division).filter(Boolean))].sort()
    return {
      name: conf,
      divisions: divisions.map((div) => ({
        name: div,
        teams: confTeams.filter((s) => s.division === div),
      })),
    }
  })
}

const rawRevalidate = parseInt(process.env.STANDINGS_REVALIDATE ?? '300', 10)
const REVALIDATE_SECONDS = Number.isFinite(rawRevalidate) && rawRevalidate > 0 ? rawRevalidate : 300

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const teamId = searchParams.get('team')

  if (!sport || !teamId) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  const sportTeams = teams.filter((t) => t.sport === sport.toUpperCase())
  const teamMap = new Map(sportTeams.map((t) => [getEspnAbbr(t.id, t.abbreviation), t]))

  let teamConference = ''
  let teamDivision = ''

  if (teamMap.has(teamId.toUpperCase())) {
    const t = teamMap.get(teamId.toUpperCase())!
    teamConference = t.conference
    teamDivision = t.division
  }

  const standings: StandingRow[] = []

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const isInSeason = (s: string): boolean => {
    switch (s) {
      case 'NFL': return month >= 8 && month <= 12
      case 'NBA': return month >= 10 || month <= 6
      case 'NHL': return month >= 10 || month <= 6
      case 'MLB': return month >= 3 && month <= 10
      default: return false
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(
      `https://site.web.api.espn.com/apis/v2/sports/${espnPath}/standings`,
      { signal: controller.signal, next: { revalidate: REVALIDATE_SECONDS } }
    )
    clearTimeout(timeout)

    if (!res.ok) {
      console.error(`[standings] ESPN v2 standings returned ${res.status} for ${sport}`)
      throw new Error(`ESPN standings returned ${res.status}`)
    }

    const data = await res.json()
    const children: any[] = data?.children ?? []

    for (const child of children) {
      const entries: any[] = child?.standings?.entries ?? []
      for (const entry of entries) {
        const team = entry?.team
        if (!team?.abbreviation) continue

        const abbr = team.abbreviation.toUpperCase()
        const overallStat = (entry.stats ?? []).find((s: any) => s.type === 'total')
        const record = overallStat?.displayValue ?? ''

        const logo = team.logos?.[0]?.href ?? ''

        const match = teamMap.get(abbr)
        standings.push({
          abbr,
          name: team.displayName ?? abbr,
          logo,
          record,
          conference: match?.conference ?? '',
          division: match?.division ?? '',
        })
      }
    }
  } catch (err) {
    console.error(`[standings] v2 API failed for ${sport}:`, err)

    // Fallback: extract records from scoreboard
    try {
      if (!isInSeason(sport.toUpperCase())) {
        const seasonYear = sport.toUpperCase() === 'NFL' ? year - 1 : year
        const endMonth = sport.toUpperCase() === 'NFL' ? '02' : '06'
        const startMonth = sport.toUpperCase() === 'NFL' ? '08' : '10'

        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${seasonYear}${startMonth}01-${year}${endMonth}28&limit=300`
        )
        if (res.ok) {
          const data = await res.json()
          const events = data?.events ?? []
          const seen = new Set<string>()

          for (const event of events) {
            const comps = event.competitions?.[0]?.competitors ?? []
            for (const comp of comps) {
              const abbr = comp.team?.abbreviation
              if (!abbr || seen.has(abbr)) continue
              seen.add(abbr)
              const recs = comp.records ?? []
              const overall = Array.isArray(recs) ? recs.find((r: any) => r.name === 'overall') : null
              const match = teamMap.get(abbr.toUpperCase())
              standings.push({
                abbr,
                name: comp.team.displayName ?? abbr,
                logo: `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${abbr.toLowerCase()}.png`,
                record: overall?.summary ?? '',
                conference: match?.conference ?? '',
                division: match?.division ?? '',
              })
            }
          }
        }
      } else {
        const startMonth = sport.toUpperCase() === 'NFL' ? '08' : '03'
        const endDate = sport.toUpperCase() === 'NFL' ? '01-15' : '10-01'
        const nextYear = sport.toUpperCase() === 'NFL' ? year + 1 : year

        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${year}${startMonth}01-${nextYear}${endDate}&limit=300`
        )
        if (res.ok) {
          const data = await res.json()
          const events = data?.events ?? []
          const seen = new Set<string>()

          for (const event of events) {
            const comps = event.competitions?.[0]?.competitors ?? []
            for (const comp of comps) {
              const abbr = comp.team?.abbreviation
              if (!abbr || seen.has(abbr)) continue
              seen.add(abbr)
              const recs = comp.records ?? []
              const overall = Array.isArray(recs) ? recs.find((r: any) => r.name === 'overall') : null
              const match = teamMap.get(abbr.toUpperCase())
              standings.push({
                abbr,
                name: comp.team.displayName ?? abbr,
                logo: `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${abbr.toLowerCase()}.png`,
                record: overall?.summary ?? '',
                conference: match?.conference ?? '',
                division: match?.division ?? '',
              })
            }
          }
        }
      }
    } catch (fallbackErr) {
      console.error(`[standings] Scoreboard fallback also failed for ${sport}:`, fallbackErr)
    }
  }

  const grouped = groupStandings(standings)
  return NextResponse.json({ standings: grouped, teamStanding: `${teamConference} ${teamDivision}`.trim() })
}
