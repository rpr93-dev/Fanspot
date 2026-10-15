'use client'

import type { ReactNode } from 'react'

/**
 * Holds the game's stream player in the workspace. The player element is
 * always rendered — mode changes only toggle visibility/width here — so a mode
 * or layout switch never unmounts the iframe and never drops the feed.
 *
 * `hidden` uses `display:none` (still mounted), which is what lets Multiview
 * mode take the stage without killing the single-game stream underneath.
 */
export function StreamDock({
  hidden = false,
  sticky = false,
  className = '',
  children,
}: {
  hidden?: boolean
  sticky?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={hidden ? 'hidden' : 'min-w-0'} aria-hidden={hidden || undefined}>
      <div className={`${sticky ? 'lg:sticky lg:top-20 ' : ''}${className}`}>{children}</div>
    </div>
  )
}
