import { notFound } from 'next/navigation'
import { normalizeSportKey } from '@/lib/models'
import { GameView } from './GameView'

interface GamePageParams {
  sport: string
  eventId: string
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
