import type { Metadata } from 'next'
import { WeekendView } from '@/components/f1/WeekendView'
import { sportConfig } from '@/data/teams'

export async function generateMetadata({ params }: { params: Promise<{ round: string }> }): Promise<Metadata> {
  const { round } = await params
  if (!/^\d+$/.test(round)) return { title: 'Grand Prix not found - Fanspot' }
  return {
    title: `Grand Prix Round ${round} - Formula 1 - Fanspot`,
    description: 'Every session of the Grand Prix weekend: race, qualifying and practice classifications plus live timing.',
  }
}

/** /f1/round/[round] — whole Grand Prix weekend (past + current). */
export default async function F1RoundPage({ params }: { params: Promise<{ round: string }> }) {
  const { round } = await params
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10 max-w-6xl">
        <WeekendView round={round} />
      </div>
    </div>
  )
}
