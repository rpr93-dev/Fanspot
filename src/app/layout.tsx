import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Fanspot - Multi-Sport Dashboard',
  description: 'Track your favorite NFL, NBA, NHL, and MLB teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-900 text-white min-h-screen">{children}</body>
    </html>
  )
}
