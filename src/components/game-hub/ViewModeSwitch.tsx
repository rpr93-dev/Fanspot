'use client'

import {
  GAME_HUB_MODE_LABELS,
  GAME_HUB_MODES,
  nextMode,
  type GameHubMode,
} from '@/lib/gameHub'

/**
 * Segmented workspace-mode switch. Rendered as buttons with `aria-pressed`
 * (the project convention for mutually-exclusive chips/segments) plus
 * ArrowLeft/ArrowRight roving, so the control is operable by keyboard.
 */
export function ViewModeSwitch({
  mode,
  onMode,
  compact,
}: {
  mode: GameHubMode
  onMode: (mode: GameHubMode) => void
  compact?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Workspace mode"
      className="inline-flex items-center gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60 max-w-full overflow-x-auto fs-scroll-x"
    >
      {GAME_HUB_MODES.map((m) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            title={
              m === 'watch'
                ? 'Watch — large player, compact stats sidebar'
                : m === 'command'
                  ? 'Command — resizable video + detailed statistics'
                  : 'Multiview — watch up to four games at once'
            }
            onClick={() => onMode(m)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault()
                onMode(nextMode(mode, 1))
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                onMode(nextMode(mode, -1))
              }
            }}
            className={`fs-tab ${compact ? '!px-3 !py-1' : ''} ${active ? 'fs-tab-active' : ''}`}
          >
            {GAME_HUB_MODE_LABELS[m]}
          </button>
        )
      })}
    </div>
  )
}
