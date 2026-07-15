# Environment

This project runs on **Windows**. The default integrated terminal is **PowerShell**, not bash or sh.

## Shell rules

- Use PowerShell syntax for all terminal commands. Do NOT use bash/POSIX syntax.
- Do not use `&&` or `||` — PowerShell 5.1 does not support them. Use `;` or separate commands.
- Use `Test-Path path` instead of `[ -d path ]` or `[ -f path ]`.
- Use `Remove-Item -Recurse -Force` instead of `rm -rf`.
- Forward slashes work in npm/Node commands even on Windows.

## Commands

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Test (vitest) | `npm run test` |

Build order: `build` runs TypeScript check + production build automatically.

## Architecture

- **Framework**: Next.js 16 (App Router) + Tailwind CSS v4 + TypeScript
- **Routes**: `/` (home) → `/[sport]` (league overview) → `/[sport]/[team]` (team dashboard)
- **League slugs**: `nfl`, `nba`, `nhl`, `mlb`
- **Team slugs**: lowercased team `id` from `src/data/teams.ts` (e.g. `ne`, `dal`, `lal`, `nyy`)

## Data

- `src/data/teams.ts` — all NFL (32), NBA (30), NHL (32), MLB (30) teams with colors, conference, division
- `src/data/mock-data.ts` — mock generators for upcoming games, win probability odds, last 5 results, news items
- Mock data is randomized per render. Replace with a real API when available.

## Team dashboard layout

Each team page at `/[sport]/[team]/page.tsx` is a `"use client"` component with:
1. **Top-left**: Next game + win probability bar
2. **Top-right**: Team logo (colored circle with abbreviation)
3. **Bottom-left**: Last 5 games (W/L indicators)
4. **Bottom-right**: Latest news items (4 mock articles)

## When a shell command fails

If a terminal command returns a parser error, rewrite using correct PowerShell syntax and retry before giving up.
