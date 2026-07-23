import { NextResponse } from 'next/server'
import { getTeamDashboard } from '@/lib/services/teamService'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')

  if (!sport) {
    return NextResponse.json({ error: 'Missing sport parameter' }, { status: 400 })
  }

  const eventId = searchParams.get('eventId') || undefined
  const includeRoster = searchParams.get('roster') !== 'false'
  const includeNews = searchParams.get('news') !== 'false'
  const origin = new URL(request.url).origin

  try {
    const dashboard = await getTeamDashboard(
      sport.toUpperCase(),
      id,
      { eventId, includeRoster, includeNews, origin },
    )

    return NextResponse.json(dashboard, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    })
  } catch (err) {
    console.error(`[dashboard-api] Error for ${sport}/${id}:`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
