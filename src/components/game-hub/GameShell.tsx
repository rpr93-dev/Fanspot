'use client'

import type { ReactNode } from 'react'
import { useGameHubPrefs } from '@/hooks/useGameHubPrefs'
import { GameHubWorkspace } from './GameHubWorkspace'
import { ShellToggle } from './ShellToggle'

/**
 * Game Hub shell host. Owns the persisted prefs (single source of truth) and
 * renders either the original two-column layout or the Watch/Command/Multiview
 * redesign, with the Old / Beta v2 toggle visible on both.
 *
 * The stream and the data column are passed as nodes, so each shell lays out
 * the exact same elements — nothing is duplicated between the old and new
 * implementations.
 */
export function GameShell({
  hasStream,
  stream,
  children,
}: {
  /** The game's stream block (or null when the sport has no stream). */
  stream: ReactNode
  /** The data column: tab nav + panels for this game. */
  children: ReactNode
  hasStream: boolean
}) {
  const { prefs, patch, reset } = useGameHubPrefs()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <ShellToggle shell={prefs.shell} onShell={(s) => patch({ shell: s })} />
      </div>

      {prefs.shell === 'v2' ? (
        <GameHubWorkspace
          prefs={prefs}
          patch={patch}
          reset={reset}
          hasStream={hasStream}
          stream={stream}
        >
          {children}
        </GameHubWorkspace>
      ) : (
        <div
          className={
            hasStream ? 'grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start' : ''
          }
        >
          {hasStream && <div className="min-w-0 lg:sticky lg:top-20">{stream}</div>}
          {children}
        </div>
      )}
    </div>
  )
}
