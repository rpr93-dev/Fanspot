import { NextResponse } from 'next/server'
import { espnSportMap } from '@/lib/providers/espn'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const date = searchParams.get('date') // YYYYMMDD
  
  if (!sport || !date) {
    return NextResponse.json({ error: 'Missing sport or date parameter' }, { status: 400 })
  }

  const espnPath = espnSportMap[sport.toUpperCase()]
  if (!espnPath) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    
    if (!res.ok) {
      return NextResponse.json({ error: `ESPN API error ${res.status}` }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
