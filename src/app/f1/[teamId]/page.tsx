import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { teams, sportConfig } from '@/data/teams'
import { F1TeamPanel } from '@/components/f1/F1TeamPanel'

/** /f1/[teamId] — constructor page (static route wins over [sport]/[team]). */
export async function generateMetadata({ params }: { params: Promise<{ teamId: string }> }): Promise<Metadata> {
  const { teamId } = await params
  const team = teams.find((t) => t.id === teamId.toLowerCase() && t.sport === 'F1')
  if (!team) return { title: 'Constructor not found - Fanspot' }
  return {
    title: `${team.name} - Fanspot`,
    description: `Formula 1 constructor: championship position, drivers, and next race for ${team.name}.`,
  }
}

export default async function F1TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const team = teams.find((t) => t.id === teamId.toLowerCase() && t.sport === 'F1')
  if (!team) return notFound()
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <F1TeamPanel team={team} teamColor={config.color} />
      </div>
    </div>
  )
}
