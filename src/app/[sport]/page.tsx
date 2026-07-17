import Link from 'next/link'
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

  if (!config) {
    return <div className="p-8 text-center text-2xl text-gray-600">League not found</div>
  }

  const sportTeams = teams.filter((team) => team.sport === sportKey).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="text-sm text-gray-600 hover:text-white transition-colors inline-block mb-8">&larr; All Leagues</Link>

        <div className="mb-10">
          <h1 className="text-4xl font-light tracking-tight text-white mb-2">{config.name}</h1>
          <p className="text-sm text-gray-500">{sportTeams.length} teams</p>
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
