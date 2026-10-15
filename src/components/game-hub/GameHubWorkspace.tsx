'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useMultiviewSelection } from '@/hooks/useMultiviewSelection'
import type { GameHubPrefs } from '@/lib/gameHub'
import { ViewModeSwitch } from './ViewModeSwitch'
import { ResizableSplit } from './ResizableSplit'
import { StreamDock } from './StreamDock'
import { MultiviewWorkspace } from './MultiviewWorkspace'

/** Watch mode keeps the player dominant; Command mode lets the user resize. */
const WATCH_RATIO = 0.68

/**
 * Game Hub shell. It arranges three integrated modes around the SAME mounted
 * children:
 *   watch     — large player + collapsible statistics sidebar
 *   command   — resizable player/statistics split, independent scroll
 *   multiview — the shared split-screen board (kept mounted once visited)
 *
 * The stream element and the data column never move between parents, so a
 * mode/tab/resize change can't remount the iframe or drop the feed.
 */
export function GameHubWorkspace({
  stream,
  children,
  hasStream,
  prefs,
  patch,
  reset,
}: {
  /** The game's stream panel (kept mounted across every mode). */
  stream: ReactNode
  /** The data column: tab nav + panels for this game. */
  children: ReactNode
  hasStream: boolean
  /** Prefs are owned by the shell host so there is a single writer. */
  prefs: GameHubPrefs
  patch: (p: Partial<GameHubPrefs>) => void
  reset: () => void
}) {
  const mode = prefs.mode

  const mv = useMultiviewSelection([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Mount the board the first time Multiview is opened, then keep it mounted
  // (hidden) so returning to it never reloads a feed.
  const [mvVisited, setMvVisited] = useState(false)
  useEffect(() => {
    if (mode === 'multiview') setMvVisited(true)
  }, [mode])

  const collapsed = mode === 'watch' && prefs.sidebarCollapsed
  const ratio = mode === 'watch' ? WATCH_RATIO : prefs.split
  const multiviewHidden = mode !== 'multiview'

  const streamAndData = hasStream ? (
    <ResizableSplit
      ratio={ratio}
      onRatio={(r) => patch({ split: r })}
      divider={mode === 'command'}
      collapsed={collapsed}
    >
      <StreamDock sticky>{stream}</StreamDock>
      <div
        className={
          mode === 'command'
            ? 'lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1'
            : ''
        }
      >
        {children}
      </div>
    </ResizableSplit>
  ) : (
    <div>{children}</div>
  )

  return (
    <section aria-label="Game workspace" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ViewModeSwitch mode={mode} onMode={(m) => patch({ mode: m })} />
        <div className="flex items-center gap-2">
          {mode === 'watch' && hasStream && (
            <button
              type="button"
              className="fs-btn"
              aria-pressed={prefs.sidebarCollapsed}
              onClick={() => patch({ sidebarCollapsed: !prefs.sidebarCollapsed })}
              title={prefs.sidebarCollapsed ? 'Show the statistics sidebar' : 'Hide the statistics sidebar'}
            >
              {prefs.sidebarCollapsed ? '⟨ Show stats' : '⟩ Hide stats'}
            </button>
          )}
          <button
            type="button"
            className="fs-meta px-2 py-1 rounded-md hover:text-fs-text"
            onClick={reset}
            title="Reset mode and panel sizes to the defaults"
          >
            Reset layout
          </button>
        </div>
      </div>

      <div className={multiviewHidden ? '' : 'hidden'}>{streamAndData}</div>

      {mvVisited && (
        <MultiviewWorkspace
          slots={mv.slots}
          onAdd={mv.add}
          onRemove={mv.remove}
          clear={mv.clear}
          spotlight={mv.spotlight}
          onSpotlight={mv.setSpotlight}
          paused={mv.paused}
          onTogglePause={mv.togglePause}
          autoplay={mv.autoplay}
          onAutoplay={mv.setAutoplay}
          layout={prefs.multiviewLayout}
          onLayout={(l) => patch({ multiviewLayout: l })}
          activeKey={activeKey}
          onActive={setActiveKey}
          hidden={multiviewHidden}
        />
      )}
    </section>
  )
}
