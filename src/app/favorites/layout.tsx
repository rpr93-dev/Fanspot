import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Favorites - Fanspot',
  description: 'Your saved teams and players, stored on this device.',
}

export default function FavoritesLayout({ children }: { children: React.ReactNode }) {
  return children
}
