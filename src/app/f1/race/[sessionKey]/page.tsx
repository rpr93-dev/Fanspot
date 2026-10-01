import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { sportConfig } from '@/data/teams'
import { RaceView } from '@/components/f1/RaceView'

export async function generateMetadata({ params }: { params: Promise<{ sessionKey: string }> }): Promise<Metadata> {
  const { sessionKey } = await params
  if (!/^\d+$/.test(sessionKey)) return { title: 'Race not found - Fanspot' }
  return {
    title: 'F1 Race Center - Fanspot',
    description: 'Live Formula 1 timing: car positions on the circuit map, gaps, and race control.',
  }
}

/** /f1/race/[sessionKey] — live circuit map + position tower for one session. */
export default async function F1RacePage({ params }: { params: Promise<{ sessionKey: string }> }) {
  const { sessionKey } = await params
  if (!/^\d+$/.test(sessionKey)) return notFound()
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10 max-w-6xl">
        <RaceView sessionKey={sessionKey} teamColor={config.color} />
      </div>
    </div>
  )
}
