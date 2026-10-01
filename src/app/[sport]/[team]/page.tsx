import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { teams, sportConfig } from '@/data/teams'
import { TeamDashboard } from './TeamDashboard'
import { F1TeamPanel } from '@/components/f1/F1TeamPanel'

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
  // F1 constructors have no ESPN roster/schedule feed — dedicated panel
  // (the static /f1/[teamId] page wins for lowercase; this covers /F1/*).
  const resolved = resolveTeam(sport, team)!
  if (resolved.team.sport === 'F1') {
    const config = sportConfig.F1
    return (
      <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
        <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10 max-w-5xl">
          <F1TeamPanel team={resolved.team} teamColor={config.color} />
        </div>
      </div>
    )
  }
  return <TeamDashboard key={`${sport}/${team}`} sport={sport} teamId={team} />
}
