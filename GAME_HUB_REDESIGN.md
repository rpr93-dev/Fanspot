# Fanspot Game Hub Redesign — Phase 0 Audit & Plan

Branch: `game-hub-redesign` · Base commit: `988871a560a392698218e9cec5ee9daba0aeaba6`
(Working tree also carries a prior, unrelated prop-model/line-scraper change set — see
"Pre-existing working-tree changes" at the bottom.)

This is an **incremental redesign**, not a rewrite. Every existing feature, route,
integration and data source is preserved.

---

## 1. Existing architecture summary (Game Hub + streams + multiview)

### Routes
- `/[sport]/game/[eventId]` → `src/app/[sport]/game/[eventId]/page.tsx` (server,
  `generateMetadata`) renders `GameView` (client, 585 lines).
- `/multiview` → `src/app/multiview/page.tsx` → `MultiviewClient` (client).
- F1 mirrors the same shape: `/f1/round/[round]` (`WeekendView`), `/f1/race/[sessionKey]`
  (`RaceView`) — `F1StreamPanel` + session tabs, stream-dominant.
- `/nfl/redzone` → `RedzoneView` (stream-dominant two-column, mirrors the Game Hub).

### Game Hub (`GameView.tsx`)
- Loads `/api/game` (header), `/api/box-score` (15 s poll while `in`), `/api/plays`,
  odds + props lazily when the Odds tab opens.
- Layout: `GameHeader`, then a `grid lg:grid-cols-[3fr_2fr]`:
  - **Left (persistent, sticky):** `GameStreamPanel` — matching streams by BOTH team
    names, feed picker, `?tab=watch&source=&sid=&autoplay=1` deep link, plus an
    "Open in split screen" link.
  - **Right:** a `role="tablist"` tab nav (`summary` Overview / `box` Box Score /
    `plays` Plays / `teams` Team Stats / `model` Odds) that swaps **panel content only**,
    so switching tabs never remounts the player. Roving `tabIndex` + Arrow/Home/End.
- Tabs render existing components untouched: `LiveGameSummary`, `LinescoreTable`,
  `PlayerBoxScore`, `PlayByPlay`, `GameStatsSection`, `NextGamePanel` (prop model +
  ledger + grades), `PropTableLegend`.
- Mobile: header → stream → tabs → data.
- Conventions: every fetch has an error path (`ErrorState`/`EmptyState` + retry),
  skeletons, `generateMetadata`, `h1`.

### Streams
- `src/components/streams/GameStreamPanel.tsx` — `/api/streams/matches` → filter by
  `matchGame`, list picker, hands a match to `StreamPlayer`.
- `src/components/streams/StreamPlayer.tsx` — `/api/streams/embed`, ordered by HD/viewers;
  **keys its resolve effect on a `signature`** (`match.id` + sources + preselect/autoplay)
  so polled listings don't reset the feed; `pickActiveEmbed` keeps the playing feed.
  Fullscreen via the Fullscreen API; iframe keeps `allowFullScreen`.
- `src/lib/streams.ts` — pure helpers: `matchGame`, `pickActiveEmbed`, `isValidWatchSport`,
  RedZone gating (`isRedzoneWindow`, `findRedzoneStream`), `WatchSport` type.

### Multiview / split screen (`/multiview`)
- `MultiviewClient.tsx` — up to 4 slots, selection in `?games=nfl:123,nba:456`, persisted
  to `localStorage['fanspot:multiview']`; spotlight (re-orders, no remount), per-tile
  pause (unmounts only the player to silence audio), "Start all" autoplay toggle,
  copy-link, clear-all. `MultiviewPicker` adds games from `/api/scoreboard/multi`
  (live first) + the `nfl:redzone` channel.
- `MultiviewTile.tsx` — score header (`/api/game` + live poll) + `GameStreamPanel`, kept
  mounted across layout switches.
- `src/lib/multiview.ts` — pure: `MAX_MULTIVIEW_SLOTS=4`, parse/serialize/add/remove,
  `multiviewHref`, `multiviewGridClass`, `REDZONE_SLOT_ID`. Tests:
  `src/lib/__tests__/multiview.test.ts`.

### Navigation & identity (must not change)
- `GlobalNav.tsx`: horizontal desktop nav (Scores, Split, NFL, NBA, NHL, MLB, F1, Fantasy,
  News, Saved) + header search + mobile bottom tab bar. Branding = "FANSPOT" wordmark.
- Design tokens in `globals.css`: `fs-page/fs-shell/fs-panel/fs-panel-2/fs-eyebrow/fs-title/
  fs-meta/fs-mono/fs-btn/fs-chip/fs-tab/fs-input/fs-skeleton`, `fs-scroll-x/fs-rail*`.
  Near-black `#0b0f0d`, turf/gold/red accents. Focus-visible ring is global.

### Relevant APIs (contracts must not break)
`/api/game`, `/api/box-score`, `/api/plays`, `/api/live-stats`, `/api/streams/matches`,
`/api/streams/embed`, `/api/streams/redzone`, `/api/scoreboard/multi`, `/api/odds`,
`/api/props`, `/api/prop-model`, `/api/prop-ledger`, `/api/prop-grades`,
`/api/fantasy/team-outlook/...`, `/api/f1/*`.

---

## 2. Feature-preservation checklist

Navigation / identity
- [ ] FANSPOT branding + logo unchanged
- [ ] Horizontal desktop nav + mobile tab bar + search unchanged
- [ ] All nav destinations (Scores, Split, NFL, NBA, NHL, MLB, F1, Fantasy, News, Saved)

Game Hub
- [ ] `GameHeader` (logos, records, live state, period, clock, venue, broadcast, odds ctx)
- [ ] Live score updating (box-score poll 15 s live)
- [ ] Stream column: matching, feed picker, source switching, deep link, fullscreen
- [ ] Tabs: Overview / Box Score / Plays / Team Stats / Odds all still render
- [ ] Box score, play-by-play, team stats
- [ ] Odds + player props + prop model + ledger + grades (`NextGamePanel`) untouched
- [ ] `?tab=watch` deep-link preselect/autoplay
- [ ] "Open in split screen" entry point
- [ ] Error / empty / skeleton / retry states
- [ ] Mobile stacking

Multiview
- [ ] `/multiview` 2–4 tiles, any mix of NFL/NBA/NHL/MLB + RedZone
- [ ] URL `?games=` share + localStorage restore
- [ ] Spotlight, per-tile pause, start-all, copy link, clear
- [ ] Add games from the existing board; reflow on add/remove

Cross-cutting
- [ ] F1 WeekendView / RaceView / RedZone hub unchanged in behavior
- [ ] Player/team/fantasy/news/search/favorites pages unchanged
- [ ] API contracts, caching, polling unchanged
- [ ] No existing test deleted or weakened

---

## 3. Proposed component structure (additive, reuses existing)

New dir `src/components/game-hub/`:
- `GameHubWorkspace.tsx` — owns `mode` (`watch` | `command` | `multiview`), persisted
  layout prefs, and renders the dock + workspace. Wraps the existing tab/data components;
  does not fork them.
- `ViewModeSwitch.tsx` — segmented control (Watch / Command / Multiview).
- `StreamDock.tsx` — thin wrapper around the existing `GameStreamPanel` that stays mounted
  across mode/tab changes (moved, not remounted).
- `ResizableSplit.tsx` — one horizontal draggable divider (pointer + keyboard, min/max,
  `suppressHydrationWarning`), used by Watch (collapsible sidebar) and Command. Chosen over
  drag-and-drop per the brief.
- `MultiviewWorkspace.tsx` — reuses `MultiviewTile` + `lib/multiview` for the in-hub
  1–4 stream board with layout presets and an "active game for stats" selector.
- `hooks/usePersistentLayout.ts` — small localStorage-backed preference hook
  (mode, panes, split ratio, multiview slots) with a reset.

New pure module `src/lib/gameHub.ts` — layout presets, prefs parse/serialize/reset,
mode helpers (unit-testable, mirrors the `lib/multiview.ts` pattern).

`GameView.tsx` is refactored to render `GameHubWorkspace` in place of its current
two-column block, keeping the same children/components and tab state.

---

## 4. Files expected to change

- `src/app/[sport]/game/[eventId]/GameView.tsx` (wire modes + layout shell)
- `src/components/game-hub/*` (new)
- `src/lib/gameHub.ts` (new) + `src/lib/__tests__/game-hub.test.ts` (new)
- `src/app/globals.css` (Phase 6 polish tokens only)
- Possibly small prop additions to `GameStreamPanel`/`StreamPlayer` (e.g. a `mode`/`className`
  passthrough) so the same instance survives mode changes — no behavior change.
- `GAME_HUB_REDESIGN.md` (this doc)

Explicitly **not** touched: prop model, fantasy tools, backend routes, `NextGamePanel`,
`GlobalNav`, existing multi-view behavior for `/multiview`.

---

## 5. Risks to existing functionality

1. **Stream remount on mode/tab change** — highest risk. `StreamPlayer` already guards a
   signature; the shell must keep the panel mounted (CSS/position changes only), never
   conditionally unmount per mode. Verified by a test asserting the iframe element persists.
2. **Third-party iframe limits** — autoplay/audio may need a click; some providers block
   embedded fullscreen. "Seamless" is only promised where the provider allows; no fake playback.
3. **Deep link `?tab=watch`** and `?games=` must keep working (URL is a contract).
4. **localStorage prefs** — new keys must namespace (`fanspot:gamehub:*`) to avoid clashing
   with `fanspot:multiview` / favorites.
5. **Tests** — 541 existing tests must stay green; new shell must not change existing exports.
6. **Build** — `npm run build` can fail tracing `prop-model/.venv` per AGENTS.md; temporarily
   move the venv if that recurs.
7. **Scope creep into unrelated features** — forbidden by the brief; keep presentation
   changes separate from data-layer changes.

---

## 6. Implementation sequence (one phase at a time, validated)

1. **Phase 1** — branch + baseline (done); confirm identity untouched.
2. **Phase 2** — layout shell only (stream dock + workspace columns), no mode switching yet;
   verify tabs/streams/scores unchanged.
3. **Phase 3** — Watch / Command / Multiview modes + presets + active-game selection.
4. **Phase 4** — playback continuity: assert no remount across mode/tab/layout changes;
   keep deep links.
5. **Phase 5** — resizable/collapsible panels, saved prefs, reset, independent scroll,
   keyboard support, mobile.
6. **Phase 6** — visual polish (near-black surfaces, hierarchy, larger scores, accents),
   removing redundant glow/borders.
7. **Phase 7** — full verification (nav, sport pages, live scores, box/plays, odds/props,
   streams, fullscreen, multiview, tab-switch playback, resize, saved prefs, mobile) +
   regression tests.

---

## 7. Baseline (recorded at branch creation)

- `npx tsc --noEmit` (== `npm run lint`): **pass**
- `npx vitest run`: **541 passed / 48 files**
- `npm run build`: **pass**
- `prop-model` pytest: not run (no Python change) — available via
  `cd prop-model && .venv/bin/python -m pytest tests/ -q`

## Status — implemented (Phases 2–6)

Rollout: the redesign ships behind a persisted **Old / Beta v2** toggle on the game
hub (`ShellToggle`, `GameShell`), defaulting to `Old` so the redesign is opt-in and
reversible. `Old` and `Beta v2` lay out the same stream/data nodes.

Delivered on this branch:
- `src/lib/gameHub.ts` + `__tests__/game-hub.test.ts` — modes, prefs parse/serialize,
  split clamp, multiview layout presets (13 tests).
- `src/hooks/useGameHubPrefs.ts` — persisted layout (`fanspot:gamehub`).
- `src/hooks/useMultiviewSelection.ts` — shared slot selection + persistence.
- `src/components/game-hub/` — `GameHubWorkspace`, `ViewModeSwitch`, `ResizableSplit`,
  `StreamDock`, `MultiviewWorkspace`, `ActiveGameStats`.
- `src/components/multiview/MultiviewTile.tsx` — additive `active`/`onSelectActive`.
- `src/app/[sport]/game/[eventId]/GameView.tsx` — renders `GameHubWorkspace`.
- `src/app/multiview/MultiviewClient.tsx` — reused `MultiviewWorkspace` (one impl).
- `src/app/globals.css` — `.hub-split*` (no-reflow resize; single column below lg).

Verified in headless Chromium on the real game hub: mode switch Watch→Command→
Multiview→Watch keeps exactly one `/api/streams/embed` request and one iframe
(**no stream remount**); tab switching likewise; the divider toggles only in
Command (`role=separator`, ArrowLeft moved aria-valuenow 66→63); sidebar collapse
applies `.hub-split--collapsed` while the tablist stays mounted; Command mode
persists across reload; Reset returns to Watch; `/multiview` renders the shared
board; mobile (390px) has 0px horizontal overflow and a single-column split.

Not yet done: Phase 7 exhaustive pass is partial (nav/sport pages not re-clicked
exhaustively); no DOM test harness exists (vitest is node-env, no jsdom/RTL), so
new interactive coverage is the pure-helper tests + browser verification.

## Pre-existing working-tree changes (unrelated to this redesign)
`NextGamePanel.tsx`, `src/app/api/prop-ledger/route.ts` (+ test), `prop-model/line_refresh.py`,
`prop-model/propmodel/ledger.py` (+ test), `scraper/*`, `README.md`, `AGENTS`-related docs,
`.gitignore`. These are the prior prop/line task and should be committed separately so the
redesign diff stays clean.
