import type { Metadata } from 'next'
import './globals.css'
import { fontVariables } from './fonts'

export const metadata: Metadata = {
  title: 'Fanspot - Multi-Sport Dashboard',
  description: 'Track your favorite NFL, NBA, NHL, and MLB teams',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`bg-fs-bg text-fs-text min-h-screen antialiased ${fontVariables}`}>{children}</body>
    </html>
  )
}
