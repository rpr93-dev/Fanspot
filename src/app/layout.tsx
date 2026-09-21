import type { Metadata } from 'next'
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
      </body>
    </html>
  )
}
