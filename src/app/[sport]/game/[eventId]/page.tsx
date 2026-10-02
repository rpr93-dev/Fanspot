import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { normalizeSportKey } from '@/lib/models'
import { GameView } from './GameView'

interface GamePageParams {
  sport: string
  eventId: string
}

export async function generateMetadata({ params }: { params: Promise<GamePageParams> }): Promise<Metadata> {
  const { sport } = await params
  return { title: `Game Center · ${sport.toUpperCase()} - Fanspot` }
}

/**
 * Server wrapper: unknown sports 404 at the HTTP layer. The event itself
 * can only be validated client-side (live ESPN lookup), so a bad eventId
 * keeps the in-page error state.
 */
export default async function GamePage({ params }: { params: Promise<GamePageParams> }) {
  const { sport, eventId } = await params
  if (!normalizeSportKey(sport)) notFound()
  return <GameView key={`${sport}/${eventId}`} sportParam={sport} eventId={eventId} />
}
