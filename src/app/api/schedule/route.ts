import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')
  const season = searchParams.get('season')
  const source = searchParams.get('source')
  const dates = searchParams.get('dates')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  let url: string
  if (source === 'scoreboard') {
    url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard`
    const params = new URLSearchParams()
    if (dates) params.set('dates', dates)
    const qs = params.toString()
    if (qs) url += `?${qs}`
  } else {
    url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team.toUpperCase()}/schedule`
    if (season) url += `?season=${season}`
  }

  try {
    const res = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
