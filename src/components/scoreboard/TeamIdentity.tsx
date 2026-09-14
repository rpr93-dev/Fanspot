'use client'

import { useState } from 'react'

/** Team logo + abbreviation, with a text fallback when the logo fails. */
export function TeamIdentity({
  abbr,
  name,
  logo,
  size = 'md',
  showRecord,
  record,
}: {
  abbr: string
  name: string
  logo: string
  size?: 'sm' | 'md' | 'lg'
  showRecord?: boolean
  record?: string | null
}) {
  const [failed, setFailed] = useState(false)
  const dims = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-12 h-12' : 'w-8 h-8'
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className={`${dims} shrink-0 flex items-center justify-center`} aria-hidden="true">
        {logo && !failed ? (
          <img
            src={logo}
            alt=""
            className="w-full h-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="fs-mono text-[10px] font-bold text-fs-muted-2">{abbr.slice(0, 3)}</span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-sm truncate" title={name}>
          {abbr}
        </span>
        {showRecord && record && (
          <span className="block fs-mono text-[10px] text-fs-muted-2 tabular-nums">{record}</span>
        )}
      </span>
    </span>
  )
}
