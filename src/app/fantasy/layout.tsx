import { fontVariables } from '../fonts'

export default function FantasyLayout({ children }: { children: React.ReactNode }) {
  return <div className={fontVariables}>{children}</div>
}
