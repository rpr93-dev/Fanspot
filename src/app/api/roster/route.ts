import { NextResponse } from 'next/server'
import { invalidParam, isKnownEspnSport, isValidTeam } from '@/lib/api-validation'
import { fetchTeamRoster, RosterFetchError } from '@/lib/teamRoster'
import type { SportKey } from '@/lib/models'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')
  const team = searchParams.get('team')

  if (!sport || !team) {
    return NextResponse.json({ error: 'Missing sport or team' }, { status: 400 })
  }
  if (!isKnownEspnSport(sport)) {
    return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
  }
  if (!isValidTeam(team)) {
    return invalidParam('team must be a 2-4 character team abbreviation')
  }

  try {
    const data = await fetchTeamRoster(sport.toUpperCase() as SportKey, team)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } })
  } catch (err) {
    if (err instanceof RosterFetchError) {
      return NextResponse.json({ error: 'ESPN_ERROR', message: `ESPN API error ${err.status}` }, { status: err.status })
    }
    console.error('[roster] request failed:', err)
    return NextResponse.json({ error: 'ROSTER_UNAVAILABLE', message: 'Unable to load roster' }, { status: 500 })
  }
}
