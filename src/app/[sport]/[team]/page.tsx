import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { teams, sportConfig } from '@/data/teams'
import { TeamDashboard } from './TeamDashboard'

interface TeamPageParams {
  sport: string
  team: string
}

function resolveTeam(sport: string, teamId: string) {
  const config = sportConfig[sport.toUpperCase()]
  const team = teams.find((t) => t.id === teamId && t.sport === sport.toUpperCase())
  return team && config ? { team, config } : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<TeamPageParams>
}): Promise<Metadata> {
  const { sport, team } = await params
  const resolved = resolveTeam(sport, team)
  if (!resolved) return { title: 'Team not found - Fanspot' }
  return {
    title: `${resolved.team.name} - Fanspot`,
    description: `Scores, schedule, standings, news, and fantasy outlook for the ${resolved.team.name}.`,
  }
}

/**
 * Server wrapper: unknown team slugs 404 at the HTTP layer (a client-only
 * notFound() never changes the already-served 200 status).
 */
export default async function TeamPage({ params }: { params: Promise<TeamPageParams> }) {
  const { sport, team } = await params
  if (!resolveTeam(sport, team)) {
    // Case-insensitive match (e.g. /nfl/PIT, /nfl/NE): redirect to the
    // canonical lowercase URL instead of 404ing.
    const canonical = teams.find(
      (t) => t.id === team.toLowerCase() && t.sport === sport.toUpperCase(),
    )
    if (canonical && sportConfig[sport.toUpperCase()]) {
      redirect(`/${sport.toLowerCase()}/${canonical.id}`)
    }
    notFound()
  }
  return <TeamDashboard key={`${sport}/${team}`} sport={sport} teamId={team} />
}
