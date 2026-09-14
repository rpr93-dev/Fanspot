import { NextResponse } from 'next/server'
import { teams } from '@/data/teams'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'
import { invalidParam } from '@/lib/api-validation'
import { normalizeSportKey, SPORT_SLUGS, type SportKey } from '@/lib/models'

export interface TeamResult {
  kind: 'team'
  sport: SportKey
  teamId: string
  abbr: string
  name: string
  conference: string
  division: string
  href: string
}

export interface PlayerResult {
  kind: 'player'
  sport: SportKey
  playerId: string
  name: string
  team: string | null
  teamAbbr: string | null
  headshot: string | null
  href: string
}

const SLUG_TO_SPORT: Record<string, SportKey> = {
  nfl: 'NFL',
  nba: 'NBA',
  nhl: 'NHL',
  mlb: 'MLB',
}

function matchTeams(q: string, limit: number): TeamResult[] {
  const query = q.toLowerCase().trim()
  if (!query) return []
  const tokens = query.split(/\s+/).filter(Boolean)
  const scored = teams.map((t) => {
    const name = t.name.toLowerCase()
    let score = 0
    if (name === query || t.abbreviation.toLowerCase() === query) score = 100
    else if (name.startsWith(query)) score = 80
    else if (t.abbreviation.toLowerCase().startsWith(query)) score = 70
    else if (name.includes(query)) score = 50
    else {
      // Every token must match somewhere (city or nickname).
      const all = tokens.every((tok) => name.includes(tok) || t.abbreviation.toLowerCase().includes(tok))
      if (all) score = 30
    }
    return { t, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
    .slice(0, limit)
    .map(({ t }) => ({
      kind: 'team' as const,
      sport: t.sport,
      teamId: t.id,
      abbr: t.abbreviation,
      name: t.name,
      conference: t.conference,
      division: t.division,
      href: `/${SPORT_SLUGS[t.sport]}/${t.id}`,
    }))
}

/** ESPN site search, players only. Returns normalized player hits. */
async function searchPlayers(q: string, limit: number): Promise<PlayerResult[]> {
  return fetchOrCache(
    `search:players:${q.toLowerCase()}`,
    TTL.NEWS,
    async () => {
      const res = await fetch(
        `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(10000) },
      )
      if (!res.ok) return []
      const data = await res.json()
      const groups: any[] = Array.isArray(data?.results) ? data.results : []
      const playersGroup = groups.find((g) => g?.type === 'player')
      const contents: any[] = Array.isArray(playersGroup?.contents) ? playersGroup.contents : []
      const out: PlayerResult[] = []
      for (const c of contents) {
        const sport = SLUG_TO_SPORT[String(c?.defaultLeagueSlug ?? '').toLowerCase()]
        if (!sport && normalizeSportKey(c?.description) == null) continue
        const resolved: SportKey | undefined =
          sport ?? (normalizeSportKey(c?.description) as SportKey | null) ?? undefined
        if (!resolved) continue
        const uid = String(c?.uid ?? '')
        const m = /~a:(\d+)/.exec(uid)
        if (!m) continue
        const playerId = m[1]
        const teamName = typeof c?.subtitle === 'string' ? c.subtitle : null
        const teamMatch = teamName
          ? teams.find((t) => t.sport === resolved && t.name.toLowerCase() === teamName.toLowerCase())
          : undefined
        out.push({
          kind: 'player',
          sport: resolved,
          playerId,
          name: String(c?.displayName ?? ''),
          team: teamName,
          teamAbbr: teamMatch?.abbreviation ?? null,
          headshot: typeof c?.image?.default === 'string' ? c.image.default : null,
          href: `/${SPORT_SLUGS[resolved]}/player/${playerId}`,
        })
        if (out.length >= limit) break
      }
      return out
    },
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (q.length < 2) {
    return NextResponse.json({ teams: [], players: [] })
  }
  if (q.length > 50) {
    return invalidParam('q must be 2-50 characters')
  }

  try {
    const [teamResults, playerResults] = await Promise.all([
      Promise.resolve(matchTeams(q, 8)),
      searchPlayers(q, 8).catch(() => [] as PlayerResult[]),
    ])
    // Player search failing must not take down team results.
    return NextResponse.json(
      { teams: teamResults, players: playerResults },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
    )
  } catch (err) {
    console.error('[search] request failed:', err)
    return NextResponse.json({ error: 'SEARCH_UNAVAILABLE', message: 'Unable to search' }, { status: 500 })
  }
}
