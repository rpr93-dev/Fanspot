import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
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

export function generateMetadata({ params }: { params: TeamPageParams }): Metadata {
  const resolved = resolveTeam(params.sport, params.team)
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
export default function TeamPage({ params }: { params: TeamPageParams }) {
  if (!resolveTeam(params.sport, params.team)) notFound()
  return <TeamDashboard key={`${params.sport}/${params.team}`} sport={params.sport} teamId={params.team} />
}
