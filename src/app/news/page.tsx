import type { Metadata } from 'next'
import { NewsFeed } from '@/components/NewsFeed'
import { SectionHeader } from '@/components/feedback'

export const metadata: Metadata = {
  title: 'News - Fanspot',
  description: 'The latest stories across the NFL, NBA, NHL, MLB, and Formula 1.',
}

export default function NewsPage() {
  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader
          as="h1"
          eyebrow="Around the leagues"
          title="News"
          description="Every league, one feed — NFL, NBA, NHL, MLB, and F1. Recency-weighted and deduplicated."
          action={<p className="fs-meta hidden sm:block">Recency-weighted</p>}
        />
        <NewsFeed ranking="balanced" limit={30} layout="grid" />
      </div>
    </div>
  )
}
