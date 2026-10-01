import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DriverPanel } from '@/components/f1/DriverPanel'
import { sportConfig } from '@/data/teams'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params
  if (!/^[A-Za-z]{3}$/.test(code)) return { title: 'Driver not found - Fanspot' }
  return {
    title: `${code.toUpperCase()} - Formula 1 Driver - Fanspot`,
    description: 'Formula 1 driver profile: championship standing, race-by-race results, and the latest news.',
  }
}

/** /f1/driver/[code] — driver detail (VER, HAM, …). */
export default async function F1DriverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!/^[A-Za-z]{3}$/.test(code)) return notFound()
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10 max-w-5xl">
        <DriverPanel code={code.toUpperCase()} />
      </div>
    </div>
  )
}
