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
