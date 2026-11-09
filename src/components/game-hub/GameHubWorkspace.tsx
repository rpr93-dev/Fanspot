'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useMultiviewSelection } from '@/hooks/useMultiviewSelection'
import { RAIL_MAX, RAIL_MIN, type GameHubMode, type GameHubPrefs } from '@/lib/gameHub'
import { ViewModeSwitch } from './ViewModeSwitch'
import { ResizableSplit } from './ResizableSplit'
import { StreamDock } from './StreamDock'
import { HubPanel } from './HubPanel'
import { MultiviewWorkspace } from './MultiviewWorkspace'

/** One-line description of what each mode is for (toolbar hierarchy). */
const MODE_BLURB: Record<GameHubMode, string> = {
  watch: 'Large player with a live companion column',
  command: 'Every panel on screen at once — resize and scroll independently',
  multiview: 'Watch up to four games side by side',
}

/**
 * Game Hub workspace. Three integrated modes are arranged around the SAME
 * mounted nodes, so a mode/tab/resize change can never remount the player or
 * re-resolve a feed:
 *
 *   watch     — large player + companion column (tabs, defaults to the
 *               overview: recent plays, game leaders, team comparisons)
 *   command   — a different workspace: player beside a Live Plays / Player Box
 *               Score rail (independently resizable + scrollable) with the
 *               head-to-head team stats strip across the full width below
 *   multiview — the shared split-screen board (kept mounted once visited)
 *
 * The DOM *structure* is identical in every mode; only classes, visibility and
 * which slots are on stage change. The stream and the data column never move
 * between parents, which is what keeps playback alive across mode switches.
 */
export function GameHubWorkspace({
  prefs,
  patch,
  reset,
  hasStream,
  stream,
  column,
  commandPlays,
  commandBox,
  commandStats,
  live = false,
}: {
  prefs: GameHubPrefs
  patch: (p: Partial<GameHubPrefs>) => void
  reset: () => void
  hasStream: boolean
  /** The game's stream panel (kept mounted across every mode). */
  stream: ReactNode
  /** The classic tab strip + panels — the Watch companion column. */
  column: ReactNode
  /** Command mode: live play-by-play feed. */
  commandPlays: ReactNode
  /** Command mode: player box score. */
  commandBox: ReactNode
  /** Command mode: head-to-head team statistics. */
  commandStats: ReactNode
  /** Drives the live/updating labels on the Command panels. */
  live?: boolean
}) {
  const mode = prefs.mode
  const command = mode === 'command'
  const fit = command && prefs.commandFit
  const collapsed = mode === 'watch' && prefs.sidebarCollapsed
  const multiviewHidden = mode !== 'multiview'

  const mv = useMultiviewSelection([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  // Mount the board the first time Multiview is opened, then keep it mounted
  // (hidden) so returning to it never reloads a feed.
  const [mvVisited, setMvVisited] = useState(false)
  useEffect(() => {
    if (mode === 'multiview') setMvVisited(true)
  }, [mode])

  const stage = hasStream ? (
    <ResizableSplit
      ratio={prefs.split}
      onRatio={(r) => patch({ split: r })}
      collapsed={collapsed}
      label={command ? 'Resize player and panels' : 'Resize player and stats'}
    >
      <StreamDock sticky={mode === 'watch'}>{stream}</StreamDock>

      {/* Right rail: one wrapper, two slots — the Watch column and the Command
          panels both stay mounted, only visibility flips. */}
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <div className={mode === 'watch' ? 'min-w-0' : 'hidden'}>{column}</div>

        <div
          className={
            command
              ? `flex min-h-0 min-w-0 flex-col gap-3${fit ? ' hub-rail--fit' : ''}`
              : 'hidden'
          }
        >
          <ResizableSplit
            orientation="vertical"
            ratio={prefs.commandRailSplit}
            onRatio={(r) => patch({ commandRailSplit: r })}
            min={RAIL_MIN}
            max={RAIL_MAX}
            divider={fit}
            label="Resize live plays and box score"
            className={fit ? 'min-h-0 flex-1' : 'min-h-0'}
          >
            <HubPanel
              title="Live Plays"
              meta={live ? 'Updating live' : 'Play by play'}
              className={fit ? 'h-full min-h-0' : 'min-h-0 lg:max-h-[32rem]'}
            >
              {commandPlays}
            </HubPanel>
            <HubPanel
              title="Player Box Score"
              meta={live ? 'Updating live' : 'Game to date'}
              className={fit ? 'h-full min-h-0' : 'min-h-0 lg:max-h-[32rem]'}
            >
              {commandBox}
            </HubPanel>
          </ResizableSplit>
        </div>
      </div>
    </ResizableSplit>
  ) : (
    <div>{column}</div>
  )

  return (
    <section aria-label="Game workspace" className="space-y-3">
      <div className="hub-toolbar">
        <div className="flex min-w-0 flex-col gap-1.5">
          <ViewModeSwitch mode={mode} onMode={(m) => patch({ mode: m })} />
          <p className="fs-meta hidden sm:block">{MODE_BLURB[mode]}</p>
        </div>

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
          {command && (
            <button
              type="button"
              className="fs-btn"
              aria-pressed={prefs.commandFit}
              onClick={() => patch({ commandFit: !prefs.commandFit })}
              title={
                prefs.commandFit
                  ? 'Panels currently share the viewport — switch to free scrolling'
                  : 'Fit every panel into the viewport with its own scrollbar'
              }
            >
              {prefs.commandFit ? '⤢ Free scroll' : '⤡ Fit screen'}
            </button>
          )}
          <button
            type="button"
            className="fs-meta px-2 py-1 rounded-md hover:text-fs-text"
            onClick={reset}
            title="Reset mode, panel sizes and the multiview layout to the defaults"
          >
            Reset layout
          </button>
        </div>
      </div>

      <div className={multiviewHidden ? '' : 'hidden'}>
        <div className="hub-canvas">
          {stage}

          {/* Command statistics strip — full width under the player, own scroll. */}
          <div className={command ? 'hub-strip' : 'hidden'}>
            <HubPanel
              title="Team Stats"
              meta="Head-to-head"
              className={fit ? 'hub-strip__panel' : 'min-h-0 lg:max-h-[26rem]'}
            >
              {commandStats}
            </HubPanel>
          </div>
        </div>
      </div>

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
          audioKey={mv.audioKey}
          onAudioKey={mv.setAudioKey}
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
