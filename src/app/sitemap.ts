import type { MetadataRoute } from 'next'
import { teams } from '@/data/teams'

const sports = ['nfl', 'nba', 'nhl', 'mlb', 'f1']

const SITE = 'https://khannaconsulting.ai/fanspot'

export default function sitemap(): MetadataRoute.Sitemap {
  const leagueEntries = sports.map((sport) => ({
    url: `${SITE}/${sport}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }))

  const teamEntries = teams.map((team) => ({
    url: `${SITE}/${team.sport.toLowerCase()}/${team.id}`,
    lastModified: new Date(),
    changeFrequency: 'hourly' as const,
    priority: 1.0,
  }))

  return [
    { url: SITE, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    { url: `${SITE}/scores`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE}/news`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.7 },
    { url: `${SITE}/favorites`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.4 },
    { url: `${SITE}/search`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.4 },
    ...leagueEntries,
    ...teamEntries,
  ]
}
