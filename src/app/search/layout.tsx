import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Search - Fanspot',
  description: 'Search teams and players across the NFL, NBA, NHL, and MLB.',
}

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children
}
