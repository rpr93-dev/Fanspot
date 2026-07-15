import type { MetadataRoute } from 'next'
import { teams } from '@/data/teams'

const sports = ['nfl', 'nba', 'nhl', 'mlb']

export default function sitemap(): MetadataRoute.Sitemap {
  const leagueEntries = sports.map((sport) => ({
    url: `https://fanspot.app/${sport}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }))

  const teamEntries = teams.map((team) => ({
    url: `https://fanspot.app/${team.sport.toLowerCase()}/${team.id}`,
    lastModified: new Date(),
    changeFrequency: 'hourly' as const,
    priority: 1.0,
  }))

  return [
    { url: 'https://fanspot.app', lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    ...leagueEntries,
    ...teamEntries,
  ]
}