import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { teams, sportConfig } from '@/data/teams'
import TeamCard from './TeamCard'
import WeeklySchedule from './WeeklySchedule'
import { GlobalScoreboard } from '@/components/GlobalScoreboard'
import { StandingsTable } from '@/components/StandingsTable'
import { StatLeaders } from '@/components/StatLeaders'
import { NewsFeed } from '@/components/NewsFeed'
import { SectionHeader } from '@/components/feedback'
import { fetchCurrentNflWeek } from '@/lib/scheduleWeek'
import { normalizeSportKey } from '@/lib/models'

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }): Promise<Metadata> {
  const { sport } = await params
  const sportKey = sport.toUpperCase()
  const config = sportConfig[sportKey]
  if (!config) return { title: 'League Not Found - Fanspot' }
  return {
    title: `${config.name} - Fanspot`,
    description: `Scores, schedule, standings, stat leaders, news, and teams for the ${config.name}.`,
  }
}

export default async function SportPage({
  params,
  searchParams
}: {
  params: Promise<{ sport: string }>
  searchParams: Promise<{ week?: string; view?: string }>
}) {
  const [{ sport }, { week, view }] = await Promise.all([params, searchParams])
  const sportKey = normalizeSportKey(sport)
  if (!sportKey) return notFound()
  const config = sportConfig[sportKey]

  const weekNum = week ? parseInt(week, 10) : undefined
  const currentWeek = sportKey === 'NFL' ? await fetchCurrentNflWeek() : 1
  const leagueSlug = sportKey.toLowerCase() as 'nfl' | 'nba' | 'nhl' | 'mlb'
  const leagueTeams = teams.filter((t) => t.sport === sportKey).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-8 transition-colors">&larr; All Leagues</Link>

        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-10">
          <div>
            <p className="fs-eyebrow mb-2" style={{ '--tint': config.color } as React.CSSProperties}>League Hub</p>
            <h1 className="fs-title text-5xl sm:text-6xl mb-3">{config.name}</h1>
          </div>
          <p className="fs-meta shrink-0">{leagueTeams.length} teams</p>
        </div>

        <div className="space-y-12">
          {sportKey === 'NFL' && (
            <section aria-label="Weekly schedule">
              <WeeklySchedule week={weekNum} view={view ?? 'all'} currentWeek={currentWeek} />
            </section>
          )}

          <section aria-label="Scores and schedule">
            <SectionHeader
              eyebrow={sportKey === 'NFL' ? 'Around the league' : 'Scores & schedule'}
              title={sportKey === 'NFL' ? 'Scoreboard' : 'Schedule'}
              tint={config.color}
            />
            <GlobalScoreboard sports={[sportKey]} />
          </section>

          <section aria-label="Standings">
            <SectionHeader eyebrow="League table" title="Standings" tint={config.color} />
            <StandingsTable sport={sportKey} />
          </section>

          <section aria-label="Stat leaders">
            <SectionHeader eyebrow="Top performers" title="Stat Leaders" tint={config.color} />
            <StatLeaders sport={sportKey} />
          </section>

          <section aria-label="League news">
            <SectionHeader eyebrow="Latest" title={`${sportKey} News`} tint={config.color} />
            <NewsFeed ranking="balanced" limit={12} leagues={[leagueSlug]} initialFilter="all" />
          </section>

          <section aria-label="Teams">
            <SectionHeader eyebrow="All teams" title="Teams" tint={config.color} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {leagueTeams.map((team) => (
                <TeamCard key={team.id} team={team} sport={sport} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
