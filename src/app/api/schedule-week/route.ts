import { NextResponse } from 'next/server'
import { fetchNflWeekEvents, fetchCurrentNflWeek, nflSeasonYear } from '@/lib/scheduleWeek'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const weekParam = searchParams.get('week')
  const seasonParam = searchParams.get('season')

  if (!sport) {
    return NextResponse.json({ error: 'Missing sport' }, { status: 400 })
  }
  if (sport.toUpperCase() !== 'NFL') {
    return NextResponse.json({ error: 'Weekly schedule only supported for NFL' }, { status: 400 })
  }

  const season = seasonParam ? parseInt(seasonParam, 10) : nflSeasonYear()
  let weekNum: number
  if (weekParam) {
    weekNum = parseInt(weekParam, 10)
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 18) {
      return NextResponse.json({ error: 'Invalid week for NFL' }, { status: 400 })
    }
  } else {
    weekNum = await fetchCurrentNflWeek()
  }

  try {
    const events = await fetchNflWeekEvents(weekNum, season)
    return NextResponse.json({ week: weekNum, season, sport: 'NFL', events })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
