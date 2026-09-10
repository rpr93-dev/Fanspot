import { NextResponse } from 'next/server'

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
      return NextResponse.json(
        { error: 'Scraper failed', details: errorText },
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
    return NextResponse.json(
      { error: 'Scraper request failed', details: err?.message },
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

  try {
    const url = `${SCRAPER_URL}/results${date ? `?date=${date}` : ''}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Scraper results unavailable' },
        { status: res.status },
      )
    }

    return NextResponse.json(await res.json())
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Scraper unavailable', details: err?.message },
      { status: 502 },
    )
  }
}
