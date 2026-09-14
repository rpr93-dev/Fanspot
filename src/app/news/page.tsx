import type { Metadata } from 'next'
import { NewsFeed } from '@/components/NewsFeed'
import { SectionHeader } from '@/components/feedback'

export const metadata: Metadata = {
  title: 'News - Fanspot',
  description: 'The latest stories across the NFL, NBA, NHL, and MLB.',
}

export default function NewsPage() {
  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8 max-w-4xl">
        <SectionHeader
          eyebrow="Around the leagues"
          title="News"
          action={<p className="fs-meta hidden sm:block">Recency-weighted</p>}
        />
        <NewsFeed ranking="balanced" limit={30} />
      </div>
    </div>
  )
}
