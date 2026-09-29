import { NextResponse } from 'next/server'
import { getTeamDashboard } from '@/lib/services/teamService'
import { teams } from '@/data/teams'
import { isValidEventId, invalidParam } from '@/lib/api-validation'

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

  const teamExists = teams.some((t) => t.id === id && t.sport === sport.toUpperCase())
  if (!teamExists) {
    return NextResponse.json({ error: `Team not found: ${sport}/${id}` }, { status: 404 })
  }

  const eventId = searchParams.get('eventId') || undefined
  if (eventId && !isValidEventId(eventId)) {
    return invalidParam('eventId must be numeric')
  }
  const includeRoster = searchParams.get('roster') !== 'false'
  const includeNews = searchParams.get('news') !== 'false'
  // Origin for same-process sub-fetches. request.url's host comes from the
  // Host header, so only http(s) origins without credentials are accepted —
  // a poisoned Host must not turn these fetches into arbitrary-URL reads.
  const origin = new URL(request.url).origin
  if (!/^https?:\/\/[^@/\\]+$/.test(origin)) {
    return NextResponse.json({ error: 'DASHBOARD_UNAVAILABLE' }, { status: 500 })
  }

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
    return NextResponse.json({ error: 'DASHBOARD_UNAVAILABLE', message: 'Unable to load team dashboard' }, { status: 500 })
  }
}
