# Autonomous Optimization Log

## Commit 1 — Fix useEffect dependency arrays

**Commit hash**: `5384cb9`
**Date**: 2026-07-16

### Problem
Three `useEffect` hooks in `page.tsx` had incorrect or incomplete dependency arrays:

1. **Initial load** (line 190): `[team]` — using object reference instead of stable string `team?.id`. If the `teams` array reference changes (e.g., HMR in dev), the entire dashboard re-fetches unnecessarily.
2. **Roster fetch** (line 203): `[showRoster]` — missing `team?.id`. If the user navigates to a different team while the roster panel is open, the effect does not re-fire, leaving the old team's roster displayed.
3. **Box-score fetch** (line 295): `[selectedGameId]` — missing `team?.id`. If the team changes while a game is selected, the fetch uses stale `team.sport`/`team.abbreviation` values from the closure.

### Solution
- Changed `[team]` to `[team?.id]` for the initial data load effect
- Changed `[showRoster]` to `[showRoster, team?.id]` for the roster effect
- Changed `[selectedGameId]` to `[selectedGameId, team?.id]` for the box-score effect

### Benefits
- **Correctness**: Roster and box-score now correctly re-fetch when the team changes
- **Performance**: Stable `team?.id` string prevents unnecessary re-fetches from object reference changes

### Verification
- `npm run build` — passed (TypeScript + production build)
- All effect bodies already guard with `if (!team) return` / `if (!selectedGameId || !team) return`, so the fix is strictly additive and cannot break existing behavior

### Files modified
- `src/app/[sport]/[team]/page.tsx`

### Tradeoffs
- None identified

### Follow-up
- Future: Add AbortController to all fetch effects to prevent stale response handling

## Commit 2 — Reduce unnecessary re-renders in BoxScorePanel

**Commit hash**: `470453e`
**Date**: 2026-07-16

### Problem
The `BoxScorePanel` component created new object/array/function references on every render:

1. **`periodLabels`** — new array `['1', '2', ..., '12']` created every render
2. **`sum`** — new arrow function created every render
3. **`teamStatKeys`** — 4 arrays and 1 record object created every render
4. **`teamStatLabels`** — Record with 24 entries created every render
5. **`sortedPlayerStats`** — Array spread + sort executed on every render, even when `data.playerStats` and `teamAbbr` haven't changed

### Solution
- Hoisted `periodLabels`, `sum`, `teamStatKeys`, `teamStatLabels` to module scope (created once at module load)
- Wrapped `sortedPlayerStats` in `useMemo` with `[data?.playerStats, teamAbbr]` dependencies
- All changes are purely additive optimizations — no behavior change

### Benefits
- **Performance**: ~100+ fewer object allocations per render of BoxScorePanel
- **Performance**: `sortedPlayerStats` sort (O(n log n) for up to ~100 athletes) skips when dependencies haven't changed
- **Readability**: Constants are clearly static at the module level

### Verification
- `npm run build` — passed (TypeScript + production build)

### Files modified
- `src/app/[sport]/[team]/page.tsx`

### Tradeoffs
- None. These values are truly static and belong at module scope.

## Commit 3 — Extract shared espnSportMap constant

**Commit hash**: `d1d490d`
**Date**: 2026-07-16

### Problem
The identical `espnSportMap` (`{ NFL: 'football/nfl', NBA: 'basketball/nba', ... }`) was defined as a local `const` in 5 API route files:
- `schedule/route.ts`
- `standings/route.ts`
- `odds/route.ts`
- `roster/route.ts`
- `box-score/route.ts`

Any change to an ESPN API path (e.g., adding a new sport) required updating all 5 files. This is a maintenance risk.

### Solution
- Exported `espnSportMap` from `src/lib/providers/espn.ts` (which already contains ESPN-specific path logic like `getEspnAbbr`)
- Replaced all 5 local definitions with `import { espnSportMap } from '@/lib/providers/espn'`

### Benefits
- **Maintainability**: Single source of truth for ESPN API path mapping
- **Consistency**: Eliminates risk of drift between route files

### Verification
- `npm run build` — passed (TypeScript + production build)

### Files modified
- `src/lib/providers/espn.ts` (added export)
- `src/app/api/schedule/route.ts` (removed local, added import)
- `src/app/api/standings/route.ts` (removed local, added to existing import)
- `src/app/api/odds/route.ts` (removed local, added import)
- `src/app/api/roster/route.ts` (removed local, added import)
- `src/app/api/box-score/route.ts` (removed local, added import)

### Tradeoffs
- Adds a dependency from API route files to `@/lib/providers/espn.ts`. However, `standings/route.ts` already had this dependency, so it's not a new coupling pattern.


