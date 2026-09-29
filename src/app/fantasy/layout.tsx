import type { Metadata } from 'next'
import { fontVariables } from '../fonts'

export const metadata: Metadata = {
  title: 'Fantasy Steals - Fanspot',
  description: 'Find value picks across your fantasy drafts using projection vs ADP analysis.',
}

export default function FantasyLayout({ children }: { children: React.ReactNode }) {
  return <div className={fontVariables}>{children}</div>
}
