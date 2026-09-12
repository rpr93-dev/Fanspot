import { NextResponse } from 'next/server'
import { DATE_RE, TEAM_RE, invalidParam, isAllowedSport } from '@/lib/api-validation'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/scraper/scrape
 *   Trigger the Docker scraper for a game and wait for results.
 *
 *   Body: { team: "NE", opponent: "SEA", gameDate: "20260913" }
 *
 *   Returns the scraped player prop lines from all sportsbooks.
 */

const SCRAPER_URL = process.env.SCRAPER_URL || 'http://localhost:8770'

export async function POST(request: Request) {
  const limited = checkRateLimit(request, 'scraper')
  if (limited) return limited

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { team, opponent, gameDate, sport } = body
  if (!team || !opponent || !gameDate) {
    return NextResponse.json(
      { error: 'Missing required fields: team, opponent, gameDate' },
      { status: 400 },
    )
  }
  if (typeof team !== 'string' || !TEAM_RE.test(team.toUpperCase())) {
    return invalidParam('team must be a 2-4 character abbreviation')
  }
  if (typeof opponent !== 'string' || !TEAM_RE.test(opponent.toUpperCase())) {
    return invalidParam('opponent must be a 2-4 character abbreviation')
  }
  if (typeof gameDate !== 'string' || !DATE_RE.test(gameDate)) {
    return invalidParam('gameDate must be YYYYMMDD')
  }
  if (sport != null && !isAllowedSport(sport)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }

  try {
    // Trigger the scraper
    const scrapeRes = await fetch(`${SCRAPER_URL}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team,
        opponent,
        game_date: gameDate,
        sport: sport || 'NFL',
      }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for scraping
    })

    if (!scrapeRes.ok) {
      const errorText = await scrapeRes.text().catch(() => '')
      console.error(`[scraper] upstream scrape failed: ${scrapeRes.status} ${errorText.slice(0, 500)}`)
      return NextResponse.json(
        { error: 'SCRAPER_FAILED', message: 'Scraper failed' },
        { status: scrapeRes.status },
      )
    }

    const results = await scrapeRes.json()

    // Also fetch health to confirm scraper is running
    const healthRes = await fetch(`${SCRAPER_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null)

    return NextResponse.json({
      success: true,
      scraper: {
        health: healthRes ? await healthRes.json() : null,
        lastScrape: results.scrapeTime,
      },
      game: {
        team,
        opponent,
        gameDate,
        sport,
      },
      results,
    })
  } catch (err: any) {
    console.error('[scraper] scrape request failed:', err?.message ?? err)
    return NextResponse.json(
      { error: 'SCRAPER_UNAVAILABLE', message: 'Scraper request failed' },
      { status: 502 },
    )
  }
}

/**
 * GET /api/scraper/results
 *   Get latest scraped results.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (date && !DATE_RE.test(date)) {
    return invalidParam('date must be YYYYMMDD')
  }

  try {
    const url = `${SCRAPER_URL}/results${date ? `?date=${encodeURIComponent(date)}` : ''}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Scraper results unavailable' },
        { status: res.status },
      )
    }

    return NextResponse.json(await res.json())
  } catch (err: any) {
    console.error('[scraper] results request failed:', err?.message ?? err)
    return NextResponse.json(
      { error: 'SCRAPER_UNAVAILABLE', message: 'Scraper unavailable' },
      { status: 502 },
    )
  }
}
