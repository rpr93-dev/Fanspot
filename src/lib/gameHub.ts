/**
 * Game Hub workspace preferences — pure, client-safe helpers shared by the
 * Game Hub shell (`GameHubWorkspace`) and its persisted layout.
 *
 * Three integrated viewing modes live on the same hub:
 *   watch     — large 16:9 player, collapsible statistics sidebar (default)
 *   command   — resizable video/stats split, detailed panels, independent scroll
 *   multiview — 1–4 simultaneous streams, reusing the split-screen tiles
 *
 * Nothing here touches DOM or storage — `useGameHubPrefs` owns that — so the
 * mode/split/layout rules stay unit-testable exactly like `lib/multiview.ts`.
 */

export type GameHubMode = 'watch' | 'command' | 'multiview'

/**
 * Which hub shell to render. `old` is the original two-column Game Hub;
 * `v2` is the Watch/Command/Multiview redesign, now the main (default) shell.
 */
export type GameHubShell = 'old' | 'v2'

export const GAME_HUB_SHELLS: readonly GameHubShell[] = ['v2', 'old']

export const GAME_HUB_SHELL_LABELS: Record<GameHubShell, string> = {
  v2: 'New',
  old: 'Classic',
}

export function isGameHubShell(value: unknown): value is GameHubShell {
  return value === 'old' || value === 'v2'
}

export const GAME_HUB_MODES: readonly GameHubMode[] = ['watch', 'command', 'multiview']

export const GAME_HUB_MODE_LABELS: Record<GameHubMode, string> = {
  watch: 'Watch',
  command: 'Command',
  multiview: 'Multiview',
}

export type MultiviewLayout = 'auto' | 'stack' | 'focus'

export const MULTIVIEW_LAYOUTS: readonly MultiviewLayout[] = ['auto', 'stack', 'focus']

export const MULTIVIEW_LAYOUT_LABELS: Record<MultiviewLayout, string> = {
  auto: 'Auto',
  stack: 'Stack',
  focus: 'Focus',
}

/** localStorage key (namespaced so it never collides with favorites/multiview). */
export const GAME_HUB_PREFS_KEY = 'fanspot:gamehub:2'

/**
 * Legacy prefs key from when the Old shell was the default. Read once for
 * migration, then written under the versioned key above.
 */
export const LEGACY_GAME_HUB_PREFS_KEY = 'fanspot:gamehub'

export interface GameHubPrefs {
  /** Which shell renders the hub (Old vs the redesign). */
  shell: GameHubShell
  mode: GameHubMode
  /** Fraction of the width given to the stream column (Watch + Command). */
  split: number
  /** Watch mode: hide the statistics sidebar. */
  sidebarCollapsed: boolean
  /**
   * Command mode: size the workspace to the viewport so every pane gets its
   * own scrollbar (a real "wall" layout) instead of one long page scroll.
   */
  commandFit: boolean
  /** Command mode: fraction of the right rail's height given to live plays. */
  commandRailSplit: number
  multiviewLayout: MultiviewLayout
}

export const DEFAULT_GAME_HUB_PREFS: GameHubPrefs = {
  shell: 'v2',
  mode: 'watch',
  split: 0.62,
  sidebarCollapsed: false,
  commandFit: true,
  commandRailSplit: 0.55,
  multiviewLayout: 'auto',
}

/** Divider bounds: never squeeze the video below 35% or above 82%. */
export const SPLIT_MIN = 0.35
export const SPLIT_MAX = 0.82

/** Command-mode rail bounds: plays never collapse below 25% of the rail. */
export const RAIL_MIN = 0.25
export const RAIL_MAX = 0.8

export function clampRailSplit(value: unknown, min = RAIL_MIN, max = RAIL_MAX): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_GAME_HUB_PREFS.commandRailSplit
  return Math.min(max, Math.max(min, n))
}

export function clampSplit(value: unknown, min = SPLIT_MIN, max = SPLIT_MAX): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_GAME_HUB_PREFS.split
  return Math.min(max, Math.max(min, n))
}

export function isGameHubMode(value: unknown): value is GameHubMode {
  return value === 'watch' || value === 'command' || value === 'multiview'
}

export function isMultiviewLayout(value: unknown): value is MultiviewLayout {
  return value === 'auto' || value === 'stack' || value === 'focus'
}

/** Next mode in a direction, wrapping — powers ArrowLeft/Right on the switch. */
export function nextMode(mode: GameHubMode, dir: 1 | -1): GameHubMode {
  const i = GAME_HUB_MODES.indexOf(mode)
  const n = GAME_HUB_MODES.length
  return GAME_HUB_MODES[(i + dir + n) % n]
}

/**
 * Parse a persisted prefs blob. Anything malformed falls back per-field to the
 * default, so a corrupt/older value can never blank the hub.
 *
 * `resetShell` is used when importing from the legacy prefs key: v2 is now the
 * main shell, so a blob written while Old was the default must not pin
 * returning users to the old layout. Their new shell choice persists normally.
 */
export function parseGameHubPrefs(
  raw: string | null | undefined,
  { resetShell = false }: { resetShell?: boolean } = {},
): GameHubPrefs {
  if (!raw) return { ...DEFAULT_GAME_HUB_PREFS }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_GAME_HUB_PREFS }
  }
  if (!data || typeof data !== 'object') return { ...DEFAULT_GAME_HUB_PREFS }
  const d = data as Record<string, unknown>
  const prefs: GameHubPrefs = {
    shell: isGameHubShell(d.shell) ? d.shell : DEFAULT_GAME_HUB_PREFS.shell,
    mode: isGameHubMode(d.mode) ? d.mode : DEFAULT_GAME_HUB_PREFS.mode,
    split: clampSplit(d.split),
    sidebarCollapsed: typeof d.sidebarCollapsed === 'boolean' ? d.sidebarCollapsed : DEFAULT_GAME_HUB_PREFS.sidebarCollapsed,
    commandFit: typeof d.commandFit === 'boolean' ? d.commandFit : DEFAULT_GAME_HUB_PREFS.commandFit,
    commandRailSplit: clampRailSplit(d.commandRailSplit),
    multiviewLayout: isMultiviewLayout(d.multiviewLayout) ? d.multiviewLayout : DEFAULT_GAME_HUB_PREFS.multiviewLayout,
  }
  if (resetShell) prefs.shell = 'v2'
  return prefs
}

export function serializeGameHubPrefs(prefs: GameHubPrefs): string {
  return JSON.stringify({
    shell: isGameHubShell(prefs.shell) ? prefs.shell : 'v2',
    mode: prefs.mode,
    split: clampSplit(prefs.split),
    sidebarCollapsed: !!prefs.sidebarCollapsed,
    commandFit: prefs.commandFit !== false,
    commandRailSplit: clampRailSplit(prefs.commandRailSplit),
    multiviewLayout: isMultiviewLayout(prefs.multiviewLayout) ? prefs.multiviewLayout : 'auto',
  })
}

/**
 * Grid classes for the multiview board. `auto` is the responsive default: a
 * single column on phones, then the 2-up / 3-up / 4-up arrangement as soon as
 * there is room (a 3- or 4-screen wall is unusable behind one column).
 * `stack` forces a single column; `focus` keeps the grid but lifts the first
 * tile across the full width so the primary game dominates.
 *
 * The breakpoint is `md` (768px) rather than `xl`: on a 1280px laptop the
 * earlier `xl`-only grid left three of four screens scrolled out of view.
 */
export function multiviewBoardClass(count: number, layout: MultiviewLayout = 'auto'): string {
  if (count <= 1 || layout === 'stack') return 'grid gap-3 grid-cols-1'
  return 'grid gap-3 grid-cols-1 md:grid-cols-2'
}

/** Per-tile span so 3-up reads as a hero + two, and 4-up as a 2×2. */
export function multiviewTileClass(
  count: number,
  index: number,
  layout: MultiviewLayout = 'auto',
): string {
  if (layout === 'stack' || count <= 1) return ''
  if (layout === 'focus') return index === 0 ? 'md:col-span-2' : ''
  if (count === 3 && index === 0) return 'md:col-span-2'
  return ''
}

/**
 * Layout presets for 1–4 streams: how many tiles a preset targets and the
 * arrangement to apply. Selecting a preset simply changes the grid; it never
 * removes a selected game (the user removes tiles explicitly).
 */
export interface MultiviewPreset {
  count: 1 | 2 | 3 | 4
  layout: MultiviewLayout
  label: string
}

export const MULTIVIEW_PRESETS: MultiviewPreset[] = [
  { count: 1, layout: 'focus', label: '1' },
  { count: 2, layout: 'auto', label: '2' },
  { count: 3, layout: 'focus', label: '3' },
  { count: 4, layout: 'auto', label: '4' },
]

/** The preset whose count matches the current tile count, if any. */
export function activeMultiviewPreset(count: number, layout: MultiviewLayout): MultiviewPreset | null {
  return MULTIVIEW_PRESETS.find((p) => p.count === count && p.layout === layout) ?? null
}
