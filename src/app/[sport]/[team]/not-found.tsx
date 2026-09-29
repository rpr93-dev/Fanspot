'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

/** Unknown team slug (e.g. /nfl/zzz). Rendered with a real 404 status. */
export default function TeamNotFound() {
  const params = useParams()
  const sport = typeof params.sport === 'string' ? params.sport : ''
  return (
    <div className="min-h-screen fs-page">
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="fs-title text-2xl text-fs-muted mb-4">Team not found</h1>
          <Link
            href={`/${sport}`}
            className="hover-lift fs-meta hover:text-fs-text"
            style={{ '--card-color': 'rgba(255,255,255,0.3)' } as React.CSSProperties}
          >
            &larr; Back to League
          </Link>
        </div>
      </div>
    </div>
  )
}
