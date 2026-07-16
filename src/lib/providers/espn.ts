import type { EspnEvent, EspnArticle } from '@/lib/sports-api'
import { deduplicateById } from '@/lib/schedule-types'

export const espnSportMap: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

const espnTeamAbbr: Record<string, string> = {
  was: 'WSH', la_: 'LA', phi_76: 'PHI', dal_nba: 'DAL', lac_nba: 'LAC',
  no_nba: 'NO', sas: 'SA', uth: 'UTAH', tor_nhl: 'TOR', tb_nhl: 'TB',
  tb_mlb: 'TB', wsh_nhl: 'WSH', wsh_mlb: 'WSH', sf_mlb: 'SF', stl_mlb: 'STL',
  tor_mlb: 'TOR', chi_nba: 'CHI', chi_nhl: 'CHI', cle_nba: 'CLE', cle_mlb: 'CLE',
  det_nba: 'DET', det_nhl: 'DET', det_mlb: 'DET', ind_nba: 'IND', mil_mlb: 'MIL',
  min_nba: 'MIN', min_nhl: 'MIN', min_mlb: 'MIN', mia_nba: 'MIA', mia_mlb: 'MIA',
  atl_nba: 'ATL', atl_mlb: 'ATL', bos_nhl: 'BOS', bos_mlb: 'BOS', buf_nhl: 'BUF',
  car_nhl: 'CAR', pit_nhl: 'PIT', phi_nhl: 'PHI', sea_nhl: 'SEA', sea_mlb: 'SEA',
   ari_nhl: 'UTA', ari_mlb: 'ARI', hou_nba: 'HOU', hou_mlb: 'HOU', kc_mlb: 'KC',
   laa: 'LAA', nyy: 'NYY', nym: 'NYM', chc: 'CHC', cws: 'CHW', sd: 'SD', oak: 'ATH',
  nyk: 'NY', gsw: 'GS', lak: 'LA', njd: 'NJ',
}

const scoreboardConfig: Record<string, {
  preseasonMonths: number[]
  postseasonRange: string
  extraCurrentMonths: number[]
}> = {
  NFL: { preseasonMonths: [8], postseasonRange: '0101-0228', extraCurrentMonths: [8] },
  NBA: { preseasonMonths: [10], postseasonRange: '0415-0630', extraCurrentMonths: [7, 10] },
  NHL: { preseasonMonths: [9, 10], postseasonRange: '0415-0630', extraCurrentMonths: [9, 10] },
  MLB: { preseasonMonths: [2, 3], postseasonRange: '1001-1105', extraCurrentMonths: [2, 3] },
}

export function getEspnAbbr(teamId: string, teamAbbreviation: string): string {
  return espnTeamAbbr[teamId] ?? teamAbbreviation.toUpperCase()
}

function getSeasonYears(sport: string, year: number, month: number): number[] {
  switch (sport) {
    case 'NFL':  return [year - 1, year - 2]
    case 'NBA': case 'NHL': return [year, year - 1, year - 2]
    case 'MLB':  return [year]
    default:     return [year - 1, year]
  }
}

export async function fetchTeamSchedule(
  sport: string,
  teamId: string,
  teamAbbreviation: string,
): Promise<{ events: EspnEvent[]; problems: string[] }> {
  const problems: string[] = []
  const abbr = getEspnAbbr(teamId, teamAbbreviation)
  const cfg = scoreboardConfig[sport]

  try {
    const now = new Date()
    const currentYear = now.getFullYear()
    const month = now.getMonth() + 1

    const seasonYears = getSeasonYears(sport, currentYear, month)
    let allEvents: EspnEvent[] = []

    for (const year of seasonYears) {
      try {
        const res = await fetch(`/api/schedule?sport=${sport}&team=${abbr}&season=${year}`)
        if (!res.ok) {
          problems.push(`ESPN season=${year} returned status ${res.status}`)
          continue
        }
        const data = await res.json()
        if (data?.events) {
          allEvents = [...allEvents, ...data.events]
          if (data.events.length === 0) problems.push(`ESPN season=${year} returned 0 events`)
        }
      } catch {
        problems.push(`ESPN season=${year} fetch failed`)
      }
    }

    try {
      const res = await fetch(`/api/schedule?sport=${sport}&team=${abbr}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.events) {
          const existingIds = new Set(allEvents.map((e) => e.id))
          for (const e of data.events) {
            if (!existingIds.has(e.id)) {
              allEvents.push(e)
              existingIds.add(e.id)
            }
          }
        }
      }
    } catch { /* non-fatal */ }

    function normalizeScore(e: any): any {
      if (e && typeof e === 'string') {
        const v = parseInt(e, 10)
        return { value: isNaN(v) ? 0 : v, displayValue: e }
      }
      return e
    }

    async function fetchScoreboard(dates: string, existingIds: Set<string>) {
      try {
        const res = await fetch(`/api/schedule?sport=${sport}&team=${abbr}&source=scoreboard&dates=${dates}`)
        if (res.ok) {
          const data = await res.json()
          if (data?.events) {
            for (const e of data.events) {
              const comps = e.competitions?.[0]?.competitors ?? []
              if (!comps.some((c: any) => c.team?.abbreviation === abbr)) continue
              if (e.competitions?.[0]?.competitors) {
                for (const c of e.competitions[0].competitors) {
                  c.score = normalizeScore(c.score)
                }
              }
              const sbOdds = e.competitions?.[0]?.odds
              if (!existingIds.has(e.id)) {
                allEvents.push(e)
                existingIds.add(e.id)
              } else if (sbOdds) {
                const existing = allEvents.find((x: any) => x.id === e.id)
                if (existing && !existing.competitions?.[0]?.odds) {
                  existing.competitions[0].odds = sbOdds
                }
              }
            }
          }
        }
      } catch { /* non-fatal */ }
    }

    if (cfg) {
      const existingIds = new Set(allEvents.map((e) => e.id))

      for (const year of seasonYears) {
        for (const mon of cfg.preseasonMonths) {
          await fetchScoreboard(`${year}${String(mon).padStart(2, '0')}`, existingIds)
        }
        const nextYear = year + 1
        const [startMM, endMM] = cfg.postseasonRange.split('-')
        await fetchScoreboard(`${nextYear}${startMM}-${nextYear}${endMM}`, existingIds)
      }

      for (const mon of cfg.extraCurrentMonths) {
        await fetchScoreboard(`${currentYear}${String(mon).padStart(2, '0')}`, existingIds)
      }

      const upcoming = allEvents
        .filter((e: any) => {
          const c = e.competitions?.[0]
          if (c?.status?.type?.completed || c?.status?.type?.state === 'post') return false
          return new Date(e.date) > now
        })
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
      if (upcoming[0]) {
        const gameDate = upcoming[0].date.slice(0, 10).replace(/-/g, '')
        await fetchScoreboard(gameDate, existingIds)
      }
    }

    const unique = deduplicateById(allEvents)

    return { events: unique, problems }
  } catch (err) {
    return { events: [], problems: [`ESPN provider error: ${err}`] }
  }
}

export async function fetchTeamNews(
  sport: string,
  teamId: string,
  teamName: string,
  teamAbbreviation: string,
): Promise<EspnArticle[]> {
  try {
    const res = await fetch(`/api/news-search?team=${encodeURIComponent(teamName)}&sport=${encodeURIComponent(sport)}`)
    if (!res.ok) return []
    const data = await res.json()
    return data?.articles ?? []
  } catch {
    return []
  }
}
