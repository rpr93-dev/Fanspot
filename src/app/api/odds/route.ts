import { NextResponse } from 'next/server'

const espnSportMap: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

const log = (msg: string) => console.log(`[odds] ${msg}`)

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

function extractMoneylines(oddsObj: any): { homeML: number | null; awayML: number | null } {
  let homeML: number | null = null
  let awayML: number | null = null

  // Format 1: new nested moneyline structure (current ESPN format)
  const ml = oddsObj?.moneyline
  if (ml?.home?.close?.odds) {
    homeML = parseMoneyline(ml.home.close.odds)
    log(`  Format1(home): parsed "${ml.home.close.odds}" → ${homeML}`)
  }
  if (ml?.away?.close?.odds) {
    awayML = parseMoneyline(ml.away.close.odds)
    log(`  Format1(away): parsed "${ml.away.close.odds}" → ${awayML}`)
  }

  // Format 2: old homeTeamOdds/awayTeamOdds structure
  if (homeML === null && oddsObj?.homeTeamOdds?.moneyLine !== undefined) {
    homeML = parseMoneyline(oddsObj.homeTeamOdds.moneyLine)
    log(`  Format2(home): parsed ${oddsObj.homeTeamOdds.moneyLine} → ${homeML}`)
  }
  if (awayML === null && oddsObj?.awayTeamOdds?.moneyLine !== undefined) {
    awayML = parseMoneyline(oddsObj.awayTeamOdds.moneyLine)
    log(`  Format2(away): parsed ${oddsObj.awayTeamOdds.moneyLine} → ${awayML}`)
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
    log(`Missing params: sport=${sport} team=${team}`)
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    log(`Invalid sport: ${sport}`)
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  log(`Looking up odds for ${sport}/${team}`)

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
      log(`Using provided eventId=${eventId}, date=${gameDate}`)
    } else {
      // Fallback: fetch schedule to find upcoming game
      const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/schedule`
      log(`Fetching schedule: ${schedUrl}`)

      const schedRes = await fetch(schedUrl, { next: { revalidate: 60 } })
      if (!schedRes.ok) {
        log(`Schedule fetch failed: ${schedRes.status} ${schedRes.statusText}`)
        return NextResponse.json({ odds: null, source: 'espn' })
      }

      const schedData = await schedRes.json()
      const events: any[] = schedData?.events ?? []
      log(`Schedule returned ${events.length} events`)

      const now = new Date()
      const upcoming = events.find((e: any) => {
        const c = e.competitions?.[0]
        if (c?.status?.type?.completed || c?.status?.type?.state === 'post') return false
        return new Date(e.date) > now
      })

      if (!upcoming) {
        log('No upcoming game found in schedule')
        return NextResponse.json({ odds: null, source: 'espn' })
      }

      eventIdStr = String(upcoming.id)
      gameDate = upcoming.date.slice(0, 10).replace(/-/g, '')
      const schedCompetitors = upcoming.competitions?.[0]?.competitors ?? []
      const schedHome = schedCompetitors.find((c: any) => c.homeAway?.toLowerCase() === 'home')
      const schedAway = schedCompetitors.find((c: any) => c.homeAway?.toLowerCase() === 'away')
      homeAbbr = schedHome?.team?.abbreviation?.toUpperCase()
      awayAbbr = schedAway?.team?.abbreviation?.toUpperCase()

      log(`Upcoming game: ${awayAbbr} @ ${homeAbbr} on ${gameDate} (event ID: ${eventIdStr})`)
    }

    // Step 3: Fetch scoreboard for the game date
    const sbUrl = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${gameDate}&limit=100`
    log(`Fetching scoreboard: ${sbUrl}`)

    const sbRes = await fetch(sbUrl, { cache: 'no-store' })
    if (!sbRes.ok) {
      log(`Scoreboard fetch failed: ${sbRes.status} ${sbRes.statusText}`)
      return NextResponse.json({ odds: null, source: 'espn' })
    }

    const sbData = await sbRes.json()
    const sbEvents: any[] = sbData?.events ?? []
    log(`Scoreboard returned ${sbEvents.length} events for ${gameDate}`)

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
        log(`ID-matched event doesn't include ${teamUpper}, trying abbreviation match`)
        sbEvent = null
      }
    }

    // Fallback: try matching by home/away abbreviation
    if (!sbEvent && homeAbbr && awayAbbr) {
      log(`Trying abbreviation match: ${awayAbbr} @ ${homeAbbr}`)
      sbEvent = sbEvents.find((e: any) => {
        const comps = e.competitions?.[0]?.competitors ?? []
        const { home, away } = findHomeAway(comps)
        return getTeamAbbr(home) === homeAbbr && getTeamAbbr(away) === awayAbbr
      })
    }

    if (!sbEvent) {
      log(`Game not found in scoreboard for ${gameDate} (team=${teamUpper}, id=${eventIdStr})`)
      return NextResponse.json({ odds: null, source: 'espn' })
    }

    log(`Game matched for ${sport}/${gameDate}`)

    const sbCompetitors = sbEvent.competitions?.[0]?.competitors ?? []
    const { home: sbHome, away: sbAway } = findHomeAway(sbCompetitors)

    if (!sbHome || !sbAway) {
      log('Could not determine home/away teams in scoreboard event')
      return NextResponse.json({ odds: null, source: 'espn' })
    }

    const sbHomeAbbr = getTeamAbbr(sbHome)
    const sbAwayAbbr = getTeamAbbr(sbAway)

    // Step 7: Extract odds
    const oddsArr = sbEvent.competitions?.[0]?.odds
    if (!oddsArr || oddsArr.length === 0) {
      log('No odds array in competition data — odds not yet posted by sportsbooks')
      return NextResponse.json({ odds: null, source: 'espn' })
    }

    log(`Found ${oddsArr.length} odds entries`)
    const oddsObj = oddsArr[0]
    const provider = getProviderName(oddsObj)
    log(`Provider: ${provider}`)

    const { homeML, awayML } = extractMoneylines(oddsObj)

    if (homeML === null || awayML === null) {
      log(`Incomplete moneylines: home=${homeML}, away=${awayML}`)
      return NextResponse.json({ odds: null, source: 'espn' })
    }

    log(`Raw moneylines: home=${homeML} (${sbHome?.team?.displayName}), away=${awayML} (${sbAway?.team?.displayName})`)

    // Step 8: Determine which team is ours and compute probabilities
    const isHome = sbHomeAbbr === team.toUpperCase()
    const ourComp = isHome ? sbHome : sbAway
    const oppComp = isHome ? sbAway : sbHome
    const ourML = isHome ? homeML : awayML
    const oppML = isHome ? awayML : homeML

    const normalized = normalizeVig(homeML, awayML)
    const ourProb = isHome ? normalized.home : normalized.away
    const oppProb = isHome ? normalized.away : normalized.home
    const ourRawProb = isHome ? normalized.homeRaw : normalized.awayRaw

    log(`Result: ${ourComp.team.abbreviation} ${ourML > 0 ? '+' : ''}${ourML} → ${ourProb}% (vig-free), provider=${provider}`)
    log(`Opponent: ${oppComp.team.abbreviation} ${oppML > 0 ? '+' : ''}${oppML} → ${oppProb}%`)

    return NextResponse.json({
      odds: {
        our: {
          name: ourComp.team.displayName,
          abbr: ourComp.team.abbreviation,
          moneyline: ourML,
          rawProb: ourRawProb,
          prob: ourProb,
          isFavorite: ourML < 0,
        },
        opponent: {
          name: oppComp.team.displayName,
          abbr: oppComp.team.abbreviation,
          moneyline: oppML,
          prob: oppProb,
          isFavorite: oppML < 0,
        },
        sportsbook: provider,
        lastUpdated: sbEvent.date,
        commenceTime: sbEvent.date,
        isHome,
      },
      source: 'espn',
    })
  } catch (err) {
    log(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ odds: null, source: 'espn' })
  }
}
