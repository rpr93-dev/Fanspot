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
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const key = statIdKeys.reduce((found, k) => found || (entry as any)?.[k], '')
          if (key) {
            const val = statValKeys.reduce((found, k) => found ?? (entry as any)?.[k], undefined)
            addEntry(key, val)
          } else {
            addEntry(categoryName ?? `__c${i}`, entry)
          }
        }
      }
      // Return for any array source — don't fall through to metadata fallbacks
      return stats
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

const mlbKeyStatNames = new Set([
  'atBats', 'runs', 'hits', 'runsBattedIn', 'homeRuns', 'walks', 'strikeouts',
  'stolenBases', 'caughtStealing', 'battingAvg', 'onBasePct', 'sluggingPct', 'ops',
  'inningsPitched', 'hits', 'earnedRuns', 'strikeouts', 'walks', 'homeRuns',
  'era', 'whip', 'wins', 'losses', 'saves', 'blownSaves',
  'errors', 'fieldingPct',
])

function flattenTeamStats(stats: any[]): { name: string; displayValue: string; abbreviation: string }[] {
  const result: { name: string; displayValue: string; abbreviation: string }[] = []
  for (const s of stats) {
    if (s.stats && Array.isArray(s.stats) && s.stats.length > 0 && typeof s.stats[0] === 'object' && s.stats[0] !== null && 'name' in s.stats[0]) {
      for (const inner of s.stats) {
        result.push({
          name: inner.name ?? '',
          displayValue: inner.displayValue ?? '',
          abbreviation: inner.abbreviation ?? '',
        })
      }
    } else if (s.name && s.displayValue) {
      result.push({
        name: s.name ?? '',
        displayValue: s.displayValue ?? '',
        abbreviation: s.abbreviation ?? '',
      })
    }
  }
  return result
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
    let res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${eventId}`,
      { signal: AbortSignal.timeout(15000), next: { revalidate: 300 } }
    )
    if (!res.ok && sport.toUpperCase() === 'NBA') {
      // Fallback: Summer League games live under nba-summer path
      const slPath = 'basketball/nba-summer'
      res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${slPath}/summary?event=${eventId}`,
        { signal: AbortSignal.timeout(15000), next: { revalidate: 300 } }
      )
    }
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
          homeAway: headerComp?.homeAway ?? '',
          score: headerComp?.score
            ? { displayValue: headerComp.score.displayValue ?? '' }
            : undefined,
          linescores,
          statistics: flattenTeamStats(t.statistics ?? []).filter(s =>
            sport.toUpperCase() !== 'MLB' || mlbKeyStatNames.has(s.name)
          ),
        }
      })

      playerStats = (boxscore.players ?? []).map((p: any) => {
        const teamAbbr = p.team?.abbreviation ?? teams.find((tt: any) => tt.abbreviation.toUpperCase() === (p.team?.abbreviation ?? '').toUpperCase())?.abbreviation ?? ''
        const categories: any[] = []

          for (const cat of (p.statistics ?? [])) {
            let raw = cat.name ?? cat.label ?? ''
            if (!raw) {
              if (cat.names?.length) {
                const first = cat.names[0]
                if (first === 'IP') raw = 'Pitching'
                else if (first.startsWith('H-AB') || first === 'AB') raw = 'Batting'
                else if (first === 'TC' || first === 'PO') raw = 'Fielding'
                else raw = 'Stats'
              } else {
                continue
              }
            }
          const statNames = new Set<string>()
          const athletes: any[] = []

          // Group athletes by ID — handles both per-athlete and multi-entry formats
          const groups = new Map<string, { entry: any; values: string[] }>()
          for (const a of (cat.athletes ?? [])) {
            const id = a.athlete?.id
            if (!id) continue
            if (!groups.has(id)) groups.set(id, { entry: a, values: [] })
            const dv = a.displayValue ?? a.value
            if (dv !== undefined && dv !== null) groups.get(id)!.values.push(String(dv))
          }

          const labels = cat.displayNames?.map((d: any) => d.displayName ?? d.name ?? '') ?? cat.labels ?? []
          const hasMultiValue = Array.from(groups.values()).some(g => g.values.length > 1)

          if (hasMultiValue && labels.length > 0) {
            // Multi-entry grouping format: pair values with displayNames positionally
            for (const [id, group] of groups) {
              const stats: Record<string, string> = {}
              for (let i = 0; i < Math.min(labels.length, group.values.length); i++) {
                if (labels[i] && group.values[i]) stats[labels[i]] = group.values[i]
              }
              for (const l of labels) if (l) statNames.add(l)
              const a = group.entry
              athletes.push({
                id,
                displayName: a.athlete?.displayName ?? '',
                jersey: a.athlete?.jersey ?? '',
                position: (typeof a.athlete?.position === 'string' ? a.athlete.position : a.athlete?.position?.abbreviation) ?? '',
                stats,
              })
            }
          } else {
            // Per-athlete format: each entry has its own stats
            for (const a of (cat.athletes ?? [])) {
              const id = a.athlete?.id
              if (!id) continue
              const stats = extractStats(a, raw)
              // Positional pairing: cat.labels / cat.keys / cat.displayNames + a.stats (string array) or a.values
              if (Object.keys(stats).length === 0) {
                const plabels = cat.labels ?? cat.keys ?? cat.displayNames?.map((d: any) => d.displayName ?? d.name ?? '') ?? []
                const values = a.stats ?? a.values ?? []
                if (plabels.length > 0 && values.length > 0) {
                  for (let i = 0; i < Math.min(plabels.length, values.length); i++) {
                    if (plabels[i]) stats[plabels[i]] = String(values[i])
                  }
                }
              }
              for (const key of Object.keys(stats)) statNames.add(key)
              athletes.push({
                id,
                displayName: a.athlete?.displayName ?? '',
                jersey: a.athlete?.jersey ?? '',
                position: (typeof a.athlete?.position === 'string' ? a.athlete.position : a.athlete?.position?.abbreviation) ?? '',
                stats,
              })
            }
          }

          if (athletes.length > 0) {
            // Fallback: use labels/displayNames as column headers when no stat names extracted
            if (statNames.size === 0 && labels.length > 0) {
              for (const l of labels) if (l) statNames.add(l)
            }
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

    // Debug: dump raw ESPN structure to server console and response
    let debug: any = null
    try {
      const firstPlayer = boxscore.players?.[0]
      if (firstPlayer) {
        // Dump full raw first player stats to server console
        console.log('[BoxScore RAW] firstPlayer statistics:',
          JSON.stringify(firstPlayer.statistics, null, 2).slice(0, 20000))

        const firstCat = firstPlayer?.statistics?.[0]
        const firstAth = firstCat?.athletes?.[0]
        if (firstAth) {
          const debugGroups = new Map<string, { values: string[] }>()
          for (const a of (firstCat?.athletes ?? [])) {
            const id = a.athlete?.id
            if (!id) continue
            if (!debugGroups.has(id)) debugGroups.set(id, { values: [] })
            const dv = a.displayValue ?? a.value
            if (dv !== undefined && dv !== null) debugGroups.get(id)!.values.push(String(dv))
          }

          // Dump all unique keys from every athlete entry in first category
          const allAthleteKeys = new Set<string>()
          for (const a of (firstCat?.athletes ?? [])) {
            for (const k of Object.keys(a)) allAthleteKeys.add(k)
          }

          // Sample the raw athlete entries as-is (first 3)
          const rawSamples = (firstCat?.athletes ?? []).slice(0, 3).map((a: any) => ({
            keys: Object.keys(a),
            hasAthlete: !!a.athlete,
            hasDisplayValue: 'displayValue' in a,
            hasValue: 'value' in a,
            hasStats: 'stats' in a,
            hasStatistics: 'statistics' in a,
            hasValues: 'values' in a,
            displayValue: a.displayValue,
            value: a.value,
            statsType: a.stats ? (Array.isArray(a.stats) ? 'array' : typeof a.stats) : 'undefined',
            statsSample: a.stats ? JSON.stringify(Array.isArray(a.stats) ? a.stats.slice(0, 2) : a.stats).slice(0, 200) : null,
            athleteKeys: a.athlete ? Object.keys(a.athlete) : [],
          }))

          // Simulate the extraction to see what the fix produces
          const simStats: Record<string, string> = {}
          const simLabels = firstCat?.labels ?? firstCat?.keys ?? []
          const simValues = firstAth?.stats ?? []
          if (simLabels.length > 0 && simValues.length > 0) {
            for (let i = 0; i < Math.min(simLabels.length, simValues.length); i++) {
              if (simLabels[i]) simStats[simLabels[i]] = String(simValues[i])
            }
          }
          debug = {
            categoryName: firstCat?.name,
            categoryLabel: firstCat?.label,
            extractionMethod: simLabels.length > 0 && simValues.length > 0 ? 'positional (labels + a.stats)' : 'extractStats',
            allAthleteKeysInCategory: Array.from(allAthleteKeys),
            rawSamples,
            athleteKeys: Object.keys(firstAth),
            rawAthlete: JSON.parse(JSON.stringify(firstAth)),
            rawAthleteStatsType: Array.isArray(firstAth?.stats) ? 'string[]' : typeof firstAth?.stats,
            rawAthleteStatsSample: Array.isArray(firstAth?.stats) ? firstAth.stats.slice(0, 3) : firstAth?.stats,
            rawAthleteDisplayValue: firstAth?.displayValue ?? firstAth?.value,
            extractedStats: extractStats(firstAth, firstCat?.name ?? ''),
            displayNames: firstCat?.displayNames?.map((d: any) => d.displayName ?? d.name ?? '') ?? [],
            labels: firstCat?.labels,
            keys: firstCat?.keys,
            hasMultiValue: Array.from(debugGroups.values()).some(g => g.values.length > 1),
            groupCount: debugGroups.size,
            simulatedPositionalStats: simStats,
          }
        } else {
          // No athletes - dump the full cat structure
          debug = {
            catKeys: firstCat ? Object.keys(firstCat) : [],
            firstCatName: firstCat?.name,
            firstCatRaw: firstCat ? JSON.stringify(firstCat).slice(0, 3000) : 'no categories',
          }
        }
      } else {
        // No players - dump what boxscore looks like
        const boxscoreKeys = boxscore ? Object.keys(boxscore) : []
        debug = {
          boxscoreKeys,
          hasPlayers: !!boxscore?.players,
          playersType: boxscore?.players ? (Array.isArray(boxscore.players) ? 'array' : typeof boxscore.players) : 'undefined',
          playersLength: boxscore?.players?.length,
        }
      }
    } catch (e: any) {
      debug = { error: String(e).slice(0, 500) }
    }

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
