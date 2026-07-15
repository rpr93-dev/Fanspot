'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function TeamError({ error, reset }: { error: Error; reset: () => void }) {
  const params = useParams()
  const sport = params.sport as string

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
      <div className="text-center max-w-md px-6">
        <h1 className="text-2xl font-light text-white/90 mb-2">Failed to load team data</h1>
        <p className="text-sm text-gray-500 mb-6">{error.message}</p>
        <div className="flex items-center justify-center gap-4">
          <button onClick={reset} className="px-6 py-2 text-sm text-white/80 rounded-lg transition-colors" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            Try again
          </button>
          <Link href={`/${sport}`} className="text-sm text-gray-600 hover:text-white transition-colors">&larr; Back to League</Link>
        </div>
      </div>
    </div>
  )
}