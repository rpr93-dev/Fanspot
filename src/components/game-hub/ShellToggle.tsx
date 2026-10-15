'use client'

import { GAME_HUB_SHELLS, GAME_HUB_SHELL_LABELS, type GameHubShell } from '@/lib/gameHub'

/**
 * Switches the game hub between the original layout (`Old`) and the
 * Watch/Command/Multiview redesign (`Beta v2`). Rendered on both shells so you
 * can always flip back. Persisted with the rest of the hub prefs.
 */
export function ShellToggle({
  shell,
  onShell,
}: {
  shell: GameHubShell
  onShell: (shell: GameHubShell) => void
}) {
  return (
    <div
      role="group"
      aria-label="Hub version"
      className="inline-flex items-center gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60"
    >
      <span className="fs-meta hidden px-1.5 sm:inline">Hub</span>
      {GAME_HUB_SHELLS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={shell === s}
          title={s === 'old' ? 'The original game hub' : 'Beta v2 — Watch / Command / Multiview workspace'}
          onClick={() => onShell(s)}
          className={`fs-tab !px-3 !py-1 ${shell === s ? 'fs-tab-active' : ''}`}
        >
          {GAME_HUB_SHELL_LABELS[s]}
        </button>
      ))}
    </div>
  )
}
