import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'
import { fontVariables } from './fonts'
import { GlobalNav } from '@/components/GlobalNav'
import { SportScopedScoreboard } from '@/components/SportScopedScoreboard'

export const metadata: Metadata = {
  title: 'Fanspot - Multi-Sport Dashboard',
  description: 'Track your favorite NFL, NBA, NHL, and MLB teams',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-48x48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Fanspot',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`bg-fs-bg text-fs-text min-h-screen antialiased ${fontVariables}`}>
        <GlobalNav />
        <SportScopedScoreboard />
        <main className="pb-24 md:pb-10">{children}</main>
        <footer className="border-t border-fs-line mt-8">
          <div className="fs-shell px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="fs-meta">FANSPOT · scores, news, and fantasy edges</p>
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 fs-meta" aria-label="Footer">
              <Link href="/scores" className="hover:text-fs-text" prefetch={false}>Scores</Link>
              <Link href="/nfl" className="hover:text-fs-text" prefetch={false}>NFL</Link>
              <Link href="/nba" className="hover:text-fs-text" prefetch={false}>NBA</Link>
              <Link href="/nhl" className="hover:text-fs-text" prefetch={false}>NHL</Link>
              <Link href="/mlb" className="hover:text-fs-text" prefetch={false}>MLB</Link>
              <Link href="/f1" className="hover:text-fs-text" prefetch={false}>F1</Link>
              <Link href="/fantasy/nfl" className="hover:text-fs-text" prefetch={false}>Fantasy</Link>
              <Link href="/news" className="hover:text-fs-text" prefetch={false}>News</Link>
              <Link href="/favorites" className="hover:text-fs-text" prefetch={false}>Saved</Link>
            </nav>
            <p className="fs-meta">Data via ESPN · Unofficial fan project</p>
          </div>
        </footer>
      </body>
    </html>
  )
}
