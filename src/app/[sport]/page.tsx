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
import { SportHero } from '@/components/SportHero'
import { fetchCurrentNflWeek } from '@/lib/scheduleWeek'
import { normalizeSportKey } from '@/lib/models'
import { sportTheme } from '@/lib/sportTheme'
import { F1Hub } from '@/components/f1/F1Hub'

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

const SECTION_COPY: Record<string, { schedule: string; standings: string; leaders: string; news: string; teams: string }> = {
  NFL: {
    schedule: 'The full weekly slate by kickoff — tap a game to open its Game Center.',
    standings: 'AFC and NFC tables, split by division, with records and points.',
    leaders: 'Season leaders in passing, rushing, receiving, and defense.',
    news: 'Headlines from around the league, newest first.',
    teams: 'All 32 clubs — tap any team to open its hub.',
  },
  NBA: {
    schedule: 'Games on the board for the selected date — switch dates above.',
    standings: 'East and West tables, split by division, with records.',
    leaders: 'Season leaders in scoring, rebounds, assists, and more.',
    news: 'Headlines from around the association, newest first.',
    teams: 'All 30 clubs — tap any team to open its hub.',
  },
  NHL: {
    schedule: 'Games on the board for the selected date — switch dates above.',
    standings: 'East and West tables with points, wins, and goal differential.',
    leaders: 'Season leaders in goals, assists, and points.',
    news: 'Headlines from around the league, newest first.',
    teams: 'All 32 clubs — tap any team to open its hub.',
  },
  MLB: {
    schedule: 'Games on the board for the selected date — switch dates above.',
    standings: 'American and National League tables, split by division.',
    leaders: 'Season leaders in average, home runs, RBI, and ERA.',
    news: 'Headlines from around the league, newest first.',
    teams: 'All 30 clubs — tap any team to open its hub.',
  },
}

export default async function SportPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>
  searchParams: Promise<{ week?: string; view?: string }>
}) {
  const [{ sport }, { week, view }] = await Promise.all([params, searchParams])
  const sportKey = normalizeSportKey(sport)
  if (!sportKey) return notFound()
  const config = sportConfig[sportKey]
  const theme = sportTheme(sportKey)

  // F1 has no ESPN team-vs-team shapes (scoreboard/standings/leaders all
  // assume home/away) — the dedicated hub owns every /f1* URL instead
  // (the static /f1 page wins for lowercase; this covers /F1 and friends).
  if (sportKey === 'F1') {
    return (
      <div className="min-h-screen fs-page" style={{ '--glow': `${theme.glow}22` } as React.CSSProperties}>
        <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
          <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-6 transition-colors">&larr; All Leagues</Link>
          <SportHero
            sport="F1"
            jumps={[
              { id: 'calendar', label: 'Calendar' },
              { id: 'standings', label: 'Standings' },
              { id: 'constructors', label: 'Constructors' },
              { id: 'news', label: 'News' },
            ]}
          />
          <F1Hub teamColor={config.color} />
        </div>
      </div>
    )
  }

  // Strict week parsing: ?week=3junk or ?week=abc used to slip through
  // parseInt (prefix match / NaN) into the schedule board. Garbage falls
  // back to the current week instead of corrupting the view.
  const weekNum = week && /^\d+$/.test(week) ? parseInt(week, 10) : undefined
  const validWeekNum = weekNum != null && weekNum >= 1 && weekNum <= 18 ? weekNum : undefined
  const currentWeek = sportKey === 'NFL' ? await fetchCurrentNflWeek() : 1
  const leagueSlug = sportKey.toLowerCase() as 'nfl' | 'nba' | 'nhl' | 'mlb'
  const leagueTeams = teams.filter((t) => t.sport === sportKey).sort((a, b) => a.name.localeCompare(b.name))
  const copy = SECTION_COPY[sportKey] ?? SECTION_COPY.NFL

  const jumps = [
    ...(sportKey === 'NFL' ? [{ id: 'schedule', label: 'Schedule' }] : [{ id: 'schedule', label: 'Scores' }]),
    { id: 'standings', label: 'Standings' },
    { id: 'leaders', label: 'Stat Leaders' },
    { id: 'news', label: 'News' },
    { id: 'teams', label: 'Teams' },
  ]

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${theme.glow}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-6 transition-colors">&larr; All Leagues</Link>

        <SportHero sport={sportKey} jumps={jumps} />

        <div className="space-y-14">
          <section id="schedule" aria-label="Schedule" className="scroll-mt-20">
            <SectionHeader
              eyebrow={sportKey === 'NFL' ? 'This week' : 'On the board'}
              title={sportKey === 'NFL' ? 'Weekly Schedule' : 'Scores & Schedule'}
              description={copy.schedule}
              tint={theme.accent}
            />
            {sportKey === 'NFL' ? (
              <WeeklySchedule week={validWeekNum} view={view ?? 'all'} currentWeek={currentWeek} />
            ) : (
              <GlobalScoreboard sports={[sportKey]} layout="grid" />
            )}
          </section>

          <section id="standings" aria-label="Standings" className="scroll-mt-20">
            <SectionHeader
              eyebrow="League table"
              title="Standings"
              description={copy.standings}
              tint={theme.accent}
            />
            <StandingsTable sport={sportKey} />
          </section>

          <section id="leaders" aria-label="Stat leaders" className="scroll-mt-20">
            <SectionHeader
              eyebrow="Top performers"
              title="Stat Leaders"
              description={copy.leaders}
              tint={theme.accent}
            />
            <StatLeaders sport={sportKey} />
          </section>

          <section id="news" aria-label="League news" className="scroll-mt-20">
            <SectionHeader
              eyebrow="Latest"
              title={`${sportKey} News`}
              description={copy.news}
              tint={theme.accent}
            />
            <NewsFeed ranking="balanced" limit={12} leagues={[leagueSlug]} initialFilter={leagueSlug} />
          </section>

          <section id="teams" aria-label="Teams" className="scroll-mt-20">
            <SectionHeader
              eyebrow="All teams"
              title={`${leagueTeams.length} Teams`}
              description={copy.teams}
              tint={theme.accent}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {leagueTeams.map((team, i) => (
                <TeamCard key={team.id} team={team} sport={leagueSlug} index={i} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
