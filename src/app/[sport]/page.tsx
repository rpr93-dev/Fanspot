import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { teams, sportConfig } from '@/data/teams'
import TeamCard from './TeamCard'
import WeeklySchedule from './WeeklySchedule'
import { fetchCurrentNflWeek } from '@/lib/scheduleWeek'

export async function generateMetadata({ params }: { params: Promise<{ sport: string }> }): Promise<Metadata> {
  const { sport } = await params
  const sportKey = sport.toUpperCase()
  const config = sportConfig[sportKey]
  if (!config) return { title: 'League Not Found - Fanspot' }
  return {
    title: `${config.name} Teams - Fanspot`,
    description: `Browse all ${config.name} teams and view dashboards with schedule, standings, odds, and news.`,
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
  const sportKey = sport.toUpperCase()
  const config = sportConfig[sportKey]
  if (!config) return notFound()

  const weekNum = week ? parseInt(week, 10) : undefined
  const currentWeek = sportKey === 'NFL' ? await fetchCurrentNflWeek() : 1

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-8 transition-colors">&larr; All Leagues</Link>

        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-10">
          <div>
            <p className="fs-eyebrow mb-2" style={{ '--tint': config.color } as React.CSSProperties}>League Overview</p>
            <h1 className="fs-title text-5xl sm:text-6xl mb-3">{config.name}</h1>
          </div>
          <p className="fs-meta shrink-0">{teams.filter((t) => t.sport === sportKey).length} teams</p>
        </div>

        {sportKey === 'NFL' && <WeeklySchedule week={weekNum} view={view ?? 'all'} currentWeek={currentWeek} />}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {teams.filter((team) => team.sport === sportKey).sort((a, b) => a.name.localeCompare(b.name)).map((team) => (
            <TeamCard key={team.id} team={team} sport={sport} />
          ))}
        </div>
      </div>
    </div>
  )
}
