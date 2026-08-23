import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'
import { fetchOrCache } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'

/** Shift a YYYYMMDD date by ±days (returns YYYYMMDD). */
function shiftDate(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(4, 6), 10) - 1,
    parseInt(ymd.slice(6, 8), 10),
  ))
  dt.setUTCDate(dt.getUTCDate() + days)
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${dt.getUTCFullYear()}${mm}${dd}`
}

function parseMoneyline(val: unknown): number | null {
  if (val === undefined || val === null) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/,/g, '')
    const n = parseInt(cleaned, 10)
    if (!isNaN(n)) return n
  }
  return null
}

function parseFloatValue(val: unknown): number | null {
  if (val === undefined || val === null) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/,/g, '')
    const n = parseFloat(cleaned)
    if (!isNaN(n)) return n
  }
  return null
}

function extractMoneylines(oddsObj: any): { homeML: number | null; awayML: number | null } {
  let homeML: number | null = null
  let awayML: number | null = null

  // Format 1: new nested moneyline structure (current ESPN format)
  const ml = oddsObj?.moneyline
  if (ml?.home?.close?.odds) {
    homeML = parseMoneyline(ml.home.close.odds)
  }
  if (ml?.away?.close?.odds) {
    awayML = parseMoneyline(ml.away.close.odds)
  }

  // Format 2: old homeTeamOdds/awayTeamOdds structure
  if (homeML === null && oddsObj?.homeTeamOdds?.moneyLine !== undefined) {
    homeML = parseMoneyline(oddsObj.homeTeamOdds.moneyLine)
  }
  if (awayML === null && oddsObj?.awayTeamOdds?.moneyLine !== undefined) {
    awayML = parseMoneyline(oddsObj.awayTeamOdds.moneyLine)
  }

  return { homeML, awayML }
}

function mlToImplied(ml: number): number {
  if (ml > 0) return 100 / (ml + 100)
  return Math.abs(ml) / (Math.abs(ml) + 100)
}

function normalizeVig(homeML: number, awayML: number) {
  const h = mlToImplied(homeML)
  const a = mlToImplied(awayML)
  const total = h + a
  return {
    home: Math.round((h / total) * 10000) / 100,
    away: Math.round((a / total) * 10000) / 100,
    homeRaw: Math.round(h * 10000) / 100,
    awayRaw: Math.round(a * 10000) / 100,
  }
}

function getProviderName(oddsObj: any): string {
  return oddsObj?.provider?.displayName ?? oddsObj?.provider?.name ?? 'ESPN'
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')
  const eventId = searchParams.get('eventId')
  const providedDate = searchParams.get('date')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  // Route-level cache: during live windows every open tab polls this route
  // every 30s and each miss costs 1-2 live ESPN fetches (F6). TTL.ODDS keeps
  // repeat/poll traffic at in-memory cost while leaving live updates fresh.
  const payload = await fetchOrCache(
    `odds:${sport.toUpperCase()}:${team.toUpperCase()}:${eventId ?? ''}:${providedDate ?? ''}`,
    TTL.ODDS,
    async (): Promise<{ odds: any; source: string }> => {
      try {
        let gameDate: string
        let homeAbbr: string | undefined
        let awayAbbr: string | undefined
        let eventIdStr: string | undefined

        if (eventId && providedDate) {
          // Use caller-provided game info (avoids schedule fetch disagreement)
          gameDate = providedDate
          eventIdStr = eventId
          // Home/away not known yet — will determine from scoreboard
        } else {
          // Fallback: fetch schedule to find upcoming game
          const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/schedule`

          const schedRes = await fetch(schedUrl, { signal: AbortSignal.timeout(15000) })
          if (!schedRes.ok) {
            console.error(`[odds] schedule fetch failed: ${schedRes.status} ${schedRes.statusText}`)
            return { odds: null, source: 'espn' }
          }

          const schedData = await schedRes.json()
          const events: any[] = schedData?.events ?? []

          const now = new Date()
          const upcoming = events.find((e: any) => {
            const c = e.competitions?.[0]
            if (c?.status?.type?.completed || c?.status?.type?.state === 'post') return false
            if (c?.status?.type?.state === 'in') return true
            return new Date(e.date) > now
          })

          if (!upcoming) {
            return { odds: null, source: 'espn' }
          }

          eventIdStr = String(upcoming.id)
          gameDate = upcoming.date.slice(0, 10).replace(/-/g, '')
          const schedCompetitors = upcoming.competitions?.[0]?.competitors ?? []
          const schedHome = schedCompetitors.find((c: any) => c.homeAway?.toLowerCase() === 'home')
          const schedAway = schedCompetitors.find((c: any) => c.homeAway?.toLowerCase() === 'away')
          homeAbbr = schedHome?.team?.abbreviation?.toUpperCase()
          awayAbbr = schedAway?.team?.abbreviation?.toUpperCase()
        }

        // Step 3: Fetch scoreboard for the game date. ESPN groups games under their US
        // local date, but schedule event timestamps are UTC — a night game on the East
        // coast is "tomorrow" in UTC, so a single-date query misses it. Search a ±1 day
        // window instead; the exact event is matched by ID below.
        const dateWindow = `${shiftDate(gameDate, -1)}-${shiftDate(gameDate, 1)}`
        const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${dateWindow}&limit=100`

        const sbRes = await fetch(sbUrl, { signal: AbortSignal.timeout(15000) })
        if (!sbRes.ok) {
          console.error(`[odds] scoreboard fetch failed: ${sbRes.status} ${sbRes.statusText}`)
          return { odds: null, source: 'espn' }
        }

        const sbData = await sbRes.json()
        const sbEvents: any[] = sbData?.events ?? []

        // Step 4: Match the game
        const getTeamAbbr = (c: any) => c?.team?.abbreviation?.toUpperCase()
        const findHomeAway = (competitors: any[]) => {
          const home = competitors.find((c: any) => c.homeAway?.toLowerCase() === 'home')
          const away = competitors.find((c: any) => c.homeAway?.toLowerCase() === 'away')
          return { home, away }
        }

        const teamUpper = team.toUpperCase()

        // Primary: match by event ID
        let sbEvent = eventIdStr
          ? sbEvents.find((e: any) => String(e.id) === eventIdStr)
          : null

        // Verify: the matched event must involve our team
        if (sbEvent) {
          const comps = sbEvent.competitions?.[0]?.competitors ?? []
          const hasOurTeam = comps.some((c: any) => getTeamAbbr(c) === teamUpper)
          if (!hasOurTeam) {
            sbEvent = null
          }
        }

        // Fallback: try matching by home/away abbreviation
        if (!sbEvent && homeAbbr && awayAbbr) {
          sbEvent = sbEvents.find((e: any) => {
            const comps = e.competitions?.[0]?.competitors ?? []
            const { home, away } = findHomeAway(comps)
            return getTeamAbbr(home) === homeAbbr && getTeamAbbr(away) === awayAbbr
          })
        }

        if (!sbEvent) {
          return { odds: null, source: 'espn' }
        }

        const sbCompetitors = sbEvent.competitions?.[0]?.competitors ?? []
        const { home: sbHome, away: sbAway } = findHomeAway(sbCompetitors)

        if (!sbHome || !sbAway) {
          console.warn('[odds] could not determine home/away teams in scoreboard event')
          return { odds: null, source: 'espn' }
        }

        const sbHomeAbbr = getTeamAbbr(sbHome)
        const sbAwayAbbr = getTeamAbbr(sbAway)

        // Step 7: Extract odds — try scoreboard first, then summary endpoint for live games
        let oddsArr = sbEvent.competitions?.[0]?.odds

        if ((!oddsArr || oddsArr.length === 0) && eventIdStr) {
          // Fallback: fetch the summary endpoint for this event (may have odds during live games)
          const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/summary?event=${eventIdStr}`
          try {
            const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(10000) })
            if (summaryRes.ok) {
              const summaryData = await summaryRes.json()
              oddsArr = summaryData?.header?.competitions?.[0]?.odds
            } else {
              console.warn(`[odds] summary endpoint returned ${summaryRes.status}`)
            }
          } catch (e: any) {
            console.warn(`[odds] summary endpoint fetch error: ${e.message}`)
          }
        }

        if (!oddsArr || oddsArr.length === 0) {
          return { odds: null, source: 'espn' }
        }

        const oddsObj = oddsArr[0]
        const provider = getProviderName(oddsObj)

        const { homeML, awayML } = extractMoneylines(oddsObj)

        // Spread + total come straight off the odds object when present (they are for
        // NFL/NBA/NHL/MLB on the ESPN scoreboard).
        const spread = parseFloatValue(oddsObj?.spread)
        const overUnder = parseFloatValue(oddsObj?.overUnder)

        if (homeML === null || awayML === null) {
          return { odds: null, source: 'espn' }
        }

        // Step 8: Determine which team is ours and compute probabilities. ESPN's `spread`
        // is expressed from the home team's point of view (negative = home favorite), so
        // flip it when the away team is ours to keep the display "our team's spread".
        const isHome = sbHomeAbbr === team.toUpperCase()
        const ourComp = isHome ? sbHome : sbAway
        const oppComp = isHome ? sbAway : sbHome
        const ourML = isHome ? homeML : awayML
        const oppML = isHome ? awayML : homeML
        const ourSpread = spread != null ? (isHome ? spread : -spread) : null

        const normalized = normalizeVig(homeML, awayML)
        const ourProb = isHome ? normalized.home : normalized.away
        const oppProb = isHome ? normalized.away : normalized.home
        const ourRawProb = isHome ? normalized.homeRaw : normalized.awayRaw

        // Favorite/underdog must be decided by vig-free probability, not by the sign of
        // the moneyline. Two-sided books can show both sides negative (or both positive on
        // a pick'em), so "ML < 0 means favorite" only holds in a perfectly balanced market.
        // Vig-free prob > opponent's prob is the true definition; ~50/50 is a pick'em.
        const isEven = Math.abs(ourProb - oppProb) < 0.5

        return {
          odds: {
            our: {
              name: ourComp.team.displayName,
              abbr: ourComp.team.abbreviation,
              moneyline: ourML,
              rawProb: ourRawProb,
              prob: ourProb,
              isFavorite: !isEven && ourProb > oppProb,
            },
            opponent: {
              name: oppComp.team.displayName,
              abbr: oppComp.team.abbreviation,
              moneyline: oppML,
              prob: oppProb,
              isFavorite: !isEven && oppProb > ourProb,
            },
            spread: ourSpread,
            overUnder,
            sportsbook: provider,
            lastUpdated: sbEvent.date,
            commenceTime: sbEvent.date,
            isHome,
          },
          source: 'espn',
        }
      } catch (err) {
        console.error(`[odds] unexpected error: ${err instanceof Error ? err.message : String(err)}`)
        return { odds: null, source: 'espn' }
      }
    }
  )

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } })
}
