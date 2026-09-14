import { NextResponse } from 'next/server'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'
import { invalidParam, isKnownEspnSport, isValidEventId } from '@/lib/api-validation'
import { findFanspotTeam, normalizeSportKey, SPORT_SLUGS } from '@/lib/models'
import { espnSportMap } from '@/lib/providers/espn'
import { leadersSeasonYear } from '@/lib/leaders'

async function fetchJson(url: string): Promise<any | null> {
  for (const delay of [0, 600]) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (res.ok) return await res.json()
      if (res.status === 404) return null
    } catch {
      /* retry once */
    }
  }
  return null
}

function flattenStats(categories: any[]): { name: string; label: string; stats: { key: string; label: string; value: string }[] }[] {
  const out: { name: string; label: string; stats: { key: string; label: string; value: string }[] }[] = []
  for (const cat of Array.isArray(categories) ? categories : []) {
    const stats = (Array.isArray(cat?.stats) ? cat.stats : [])
      .filter((s: any) => s?.name != null && (s?.displayValue ?? s?.value) != null)
      .map((s: any) => ({
        key: String(s.name),
        label: String(s.shortDisplayName ?? s.displayName ?? s.abbreviation ?? s.name),
        value: String(s.displayValue ?? s.value),
      }))
    // Drop all-zero categories: a WR's "Passing" table of zeros (or a
    // lineman's receiving line) is noise, never signal.
    if (stats.length > 0 && stats.some((s: { value: string }) => !isZeroValue(s.value))) {
      out.push({
        name: String(cat?.name ?? 'stats'),
        label: String(cat?.displayName ?? cat?.shortDisplayName ?? cat?.name ?? 'Stats'),
        stats,
      })
    }
  }
  return out
}

/** True for "0", "0.0", "0.00", "0%" — unparseable strings count as signal. */
function isZeroValue(v: string): boolean {
  const t = v.trim().replace(/,/g, '').replace(/%$/, '')
  if (t === '') return true
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return false
  return parseFloat(t) === 0
}

/** Primary stat category per position (NFL); other sports use API order. */
const PRIMARY_CATEGORY: Record<string, string[]> = {
  QB: ['passing'],
  RB: ['rushing', 'receiving'],
  FB: ['rushing', 'receiving'],
  WR: ['receiving', 'rushing'],
  TE: ['receiving'],
  K: ['scoring', 'kicking'],
  P: ['punting', 'kicking'],
  LS: ['general'],
  DE: ['defense', 'defensiveinterceptions'],
  DT: ['defense', 'defensiveinterceptions'],
  LB: ['defense', 'defensiveinterceptions'],
  CB: ['defensiveinterceptions', 'defense'],
  S: ['defensiveinterceptions', 'defense'],
}

/**
 * Headline stat keys for tables when season categories exist they come from
 * the primary category; otherwise they are synthesized from past-season
 * summaries so early-season players still get well-chosen columns.
 */
function headlineFor(
  position: string | null,
  seasonCats: { name: string; label: string; stats: { key: string; label: string; value: string }[] }[],
  pastSeasons: { season: number | null; summary: Record<string, string> }[],
): { category: string | null; keys: { key: string; label: string }[] } {
  const pos = (position ?? '').toUpperCase()
  const wanted = PRIMARY_CATEGORY[pos] ?? []
  const byName = (n: string) =>
    seasonCats.find((c) => c.name.toLowerCase().replace(/\s/g, '') === n)
  for (const w of wanted) {
    const cat = byName(w)
    if (cat) return { category: cat.name, keys: cat.stats.slice(0, 6).map((s) => ({ key: s.key, label: s.label })) }
  }
  const nonGeneral = seasonCats.find((c) => c.name.toLowerCase() !== 'general')
  if (nonGeneral) {
    return { category: nonGeneral.name, keys: nonGeneral.stats.slice(0, 6).map((s) => ({ key: s.key, label: s.label })) }
  }
  if (seasonCats[0]) {
    return { category: seasonCats[0].name, keys: seasonCats[0].stats.slice(0, 6).map((s) => ({ key: s.key, label: s.label })) }
  }
  // No season data at all: synthesize from past-season keys matching position.
  const allKeys = new Map<string, string>()
  for (const p of pastSeasons) {
    for (const k of Object.keys(p.summary)) {
      if (!allKeys.has(k)) allKeys.set(k, k)
    }
  }
  const keys = [...allKeys.keys()]
  const matched =
    wanted.length > 0
      ? keys.filter((k) => wanted.some((w) => k.toLowerCase().includes(w)))
      : []
  const picked = (matched.length > 0 ? matched : keys).slice(0, 6)
  return { category: wanted[0] ?? null, keys: picked.map((k) => ({ key: k, label: k })) }
}
const NON_SUMMABLE_RE = /avg|pct|rating|long|pergame|pressor|share/i

/** Honest career totals: sum plain-numeric season totals from pastSeasons. */
function sumCareer(
  pastSeasons: { season: number | null; summary: Record<string, string> }[],
): { range: [number, number] | null; sums: Record<string, string> } {
  const seasons = pastSeasons.map((p) => p.season).filter((s): s is number => s != null)
  const range: [number, number] | null =
    seasons.length > 0 ? [Math.min(...seasons), Math.max(...seasons)] : null
  const sums: Record<string, string> = {}
  const keys = new Set<string>()
  for (const p of pastSeasons) for (const k of Object.keys(p.summary)) keys.add(k)
  for (const key of keys) {
    if (NON_SUMMABLE_RE.test(key)) continue
    let total = 0
    let ok = false
    for (const p of pastSeasons) {
      const v = p.summary[key]
      if (v == null) continue
      const t = v.trim().replace(/,/g, '')
      if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
        ok = false
        break
      }
      total += parseFloat(t)
      ok = true
    }
    if (ok) sums[key] = total % 1 === 0 ? String(total) : total.toFixed(1)
  }
  return { range, sums }
}

/**
 * Player profile: bio + current-season stats + past-season totals, all from
 * the ESPN core API via the athlete's own self-describing $refs. Sections
 * that fail to resolve come back null — the page renders what exists.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sportParam = searchParams.get('sport')
  const id = searchParams.get('id')

  if (!sportParam || !id) {
    return NextResponse.json({ error: 'MISSING_PARAM', message: 'Missing sport or id' }, { status: 400 })
  }
  if (!isKnownEspnSport(sportParam)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  if (!isValidEventId(id)) {
    return invalidParam('id must be numeric')
  }
  const sport = normalizeSportKey(sportParam)!
  const [sportName, leagueName] = espnSportMap[sport].split('/')

  try {
    const athlete = await fetchOrCache(
      `player:athlete:${sport}:${id}`,
      TTL.ROSTER,
      () =>
        fetchJson(`https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/athletes/${encodeURIComponent(id)}?lang=en&region=us`),
    )
    if (!athlete) {
      return NextResponse.json({ error: 'PLAYER_NOT_FOUND', message: 'Player not found' }, { status: 404 })
    }

    const teamRef: string | null = typeof athlete.team?.['$ref'] === 'string' ? athlete.team['$ref'] : null
    const teamJson = teamRef
      ? await fetchOrCache(`player:team:${sport}:${teamRef}`, TTL.ROSTER, () => fetchJson(teamRef))
      : null
    const teamAbbr: string | null =
      typeof teamJson?.abbreviation === 'string' ? teamJson.abbreviation.toUpperCase() : null
    const fanspotTeam = teamAbbr ? findFanspotTeam(sport, teamAbbr) : null

    const logRef: string | null =
      typeof athlete.statisticslog?.['$ref'] === 'string' ? athlete.statisticslog['$ref'] : null

    const [seasonJson, logJson] = await Promise.all([
      fetchOrCache(`player:season:${sport}:${id}`, TTL.STANDINGS, () =>
        fetchJson(
          `https://sports.core.api.espn.com/v2/sports/${sportName}/leagues/${leagueName}/seasons/${leadersSeasonYear(sport)}/types/2/athletes/${encodeURIComponent(id)}/statistics?lang=en&region=us`,
        ),
      ),
      logRef
        ? fetchOrCache(`player:log:${sport}:${id}`, TTL.ROSTER, () => fetchJson(logRef))
        : Promise.resolve(null),
    ])

    // Past-season totals: resolve each season's `total` statistics ref.
    const entries: any[] = Array.isArray(logJson?.entries) ? logJson.entries.slice(0, 5) : []
    const career = await Promise.all(
      entries.map(async (entry) => {
        const seasonRef: string = entry?.season?.['$ref'] ?? ''
        const seasonMatch = /\/seasons\/(\d+)/.exec(seasonRef)
        const season = seasonMatch ? parseInt(seasonMatch[1], 10) : null
        const totalRef: string | null =
          (Array.isArray(entry?.statistics) ? entry.statistics : []).find((s: any) => s?.type === 'total')
            ?.statistics?.['$ref'] ?? null
        let summary: Record<string, string> = {}
        if (totalRef) {
          const total = await fetchJson(totalRef).catch(() => null)
          const flat: Record<string, string> = {}
          for (const cat of flattenStats(total?.splits?.categories)) {
            for (const s of cat.stats) {
              if (!(s.key in flat)) flat[s.key] = s.value
            }
          }
          summary = flat
        }
        return { season, summary }
      }),
    )

    const birth = athlete.birthPlace ?? {}
    const allSeasonCats = seasonJson ? flattenStats(seasonJson?.splits?.categories) : []
    const pastSeasonList = career.filter((c) => c.season != null)
    const position: string | null =
      typeof athlete.position?.abbreviation === 'string' ? athlete.position.abbreviation : null
    const pos = (position ?? '').toUpperCase()
    const allowed = PRIMARY_CATEGORY[pos]
    const seasonCats = allowed
      ? allSeasonCats.filter(
          (c) => allowed.some((a) => c.name.toLowerCase().replace(/\s/g, '') === a),
        )
      : allSeasonCats
    const payload = {
      sport,
      player: {
        id,
        name: String(athlete.displayName ?? athlete.fullName ?? 'Unknown Player'),
        shortName: typeof athlete.shortName === 'string' ? athlete.shortName : null,
        teamAbbr,
        teamName: typeof teamJson?.displayName === 'string' ? teamJson.displayName : null,
        teamHref: fanspotTeam ? `/${SPORT_SLUGS[sport]}/${fanspotTeam.id}` : null,
        position: typeof athlete.position?.abbreviation === 'string' ? athlete.position.abbreviation : null,
        jersey: typeof athlete.jersey === 'string' ? athlete.jersey : null,
        headshot: typeof athlete.headshot?.href === 'string' ? athlete.headshot.href : null,
        age: athlete.age != null ? String(athlete.age) : null,
        height: typeof athlete.displayHeight === 'string' ? athlete.displayHeight : null,
        weight: typeof athlete.displayWeight === 'string' ? athlete.displayWeight : null,
        birthplace: birth.city ? `${birth.city}${birth.state ? `, ${birth.state}` : ''}` : null,
        draft: typeof athlete.draft?.displayText === 'string' ? athlete.draft.displayText : null,
        experience: typeof athlete.experience?.years === 'number' ? athlete.experience.years : null,
        status: typeof athlete.status?.name === 'string' ? athlete.status.name : null,
      },
      season: seasonJson ? { year: leadersSeasonYear(sport), categories: seasonCats } : null,
      headline: headlineFor(position, seasonCats, pastSeasonList),
      careerSums: sumCareer(pastSeasonList),
      pastSeasons: pastSeasonList,
      updatedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    })
  } catch (err) {
    console.error('[player] request failed:', err)
    return NextResponse.json({ error: 'PLAYER_UNAVAILABLE', message: 'Unable to load player' }, { status: 500 })
  }
}
