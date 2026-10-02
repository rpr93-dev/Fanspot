import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { normalizeSportKey } from '@/lib/models'
import { PlayerView } from './PlayerView'

interface PlayerPageParams {
  sport: string
  playerId: string
}

export async function generateMetadata({ params }: { params: Promise<PlayerPageParams> }): Promise<Metadata> {
  const { sport } = await params
  return { title: `Player · ${sport.toUpperCase()} - Fanspot` }
}

/**
 * Server wrapper: unknown sports 404 at the HTTP layer. The player itself
 * can only be validated client-side (live ESPN lookup), so a bad playerId
 * keeps the in-page error state.
 */
export default async function PlayerPage({ params }: { params: Promise<PlayerPageParams> }) {
  const { sport, playerId } = await params
  if (!normalizeSportKey(sport)) notFound()
  return <PlayerView key={`${sport}/${playerId}`} sportParam={sport} playerId={playerId} />
}
