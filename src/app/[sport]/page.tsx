import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { teams, sportConfig } from '@/data/teams'
import TeamCard from './TeamCard'

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

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params
  const sportKey = sport.toUpperCase()
  const config = sportConfig[sportKey]

  if (!config) notFound()

  const sportTeams = teams.filter((team) => team.sport === sportKey).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-8 transition-colors">&larr; All Leagues</Link>

        <div className="mb-10">
          <p className="fs-eyebrow mb-2" style={{ '--tint': config.color } as React.CSSProperties}>League Overview</p>
          <h1 className="fs-title text-5xl sm:text-6xl mb-3">{config.name}</h1>
          <p className="fs-meta">{sportTeams.length} teams</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sportTeams.map((team) => (
            <TeamCard key={team.id} team={team} sport={sport} />
          ))}
        </div>
      </div>
    </div>
  )
}
