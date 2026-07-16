import { NextResponse } from 'next/server'

const espnSportMap: Record<string, string> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/roster`,
      { next: { revalidate: 300 } }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
    }
    const data = await res.json()

    // NBA returns a flat athletes array; other sports (NFL, NHL, MLB) return
    // position-grouped objects each with an "items" array. Normalise to flat.
    if (Array.isArray(data.athletes) && data.athletes[0]?.items) {
      const flat: any[] = []
      for (const group of data.athletes) {
        if (Array.isArray(group.items)) flat.push(...group.items)
      }
      data.athletes = flat
    }

    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
