import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { sportConfig } from '@/data/teams'
import { normalizeSportKey } from '@/lib/models'
import { RedzoneView } from './RedzoneView'

interface RedzonePageParams {
  sport: string
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'NFL RedZone - Fanspot',
    description: 'NFL RedZone — every Sunday game in one live feed, plus the day\u2019s scoreboard.',
  }
}

/**
 * Custom Game Hub for NFL RedZone. Only the NFL has a RedZone channel, so any
 * other sport 404s at the HTTP layer. The hub itself tolerates being opened
 * while RedZone is dark (an explanatory state) so shared links still work.
 */
export default async function RedzonePage({ params }: { params: Promise<RedzonePageParams> }) {
  const { sport } = await params
  if (normalizeSportKey(sport) !== 'NFL') notFound()
  return <RedzoneView teamColor={sportConfig.NFL.color} />
}
