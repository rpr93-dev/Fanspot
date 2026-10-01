# Fanspot Project Agent Memory

## ALWAYS USE GRAPHIFY FIRST

This project uses [Graphify](https://github.com/Graphify-Labs/graphify) for codebase understanding. The knowledge graph is the authoritative source for architecture and code relationships.

### If graphify is not installed:
```bash
uv tool install graphifyy
graphify install --project --platform opencode
```

### After any code change:
```bash
graphify update .
```

### Always query the graph before grepping:
- `graphify query "<question>"` — scoped subgraph for a question
- `graphify path "<A>" "<B>"` — shortest path between two concepts
- `graphify explain "<concept>"` — detailed node explanation with source locations

### Files:
- `graphify-out/graph.json` — full knowledge graph (query directly)
- `graphify-out/GRAPH_REPORT.md` — architecture overview, god nodes, communities
- `graphify-out/graph.html` — interactive visualization (open in browser)

The graph is automatically rebuilt on `git commit` and `git checkout` via git hooks.

---

## prop-model (Python)

- Setup: `cd prop-model && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pyarrow requests` (system Python has no pandas; `pyarrow` is needed for the direct nflverse parquet fallback, `requests` for downloads).
- On Python ≥3.13 `nfl_data_py` fails to install/404s; the fetcher falls back to direct nflverse parquet downloads automatically. Live pulls are cached under `prop-model/cache/*.pkl` via `DiskCache` (24h TTL) — any CLI pull populates it.
- Sharp edge: with `prop-model/.venv` present, `npm run build` (Turbopack) fails tracing `src/app/api/prop-model/route.ts` ("Symlink ... is invalid, it points out of the filesystem root"). Temporarily move the venv out of the tree to build; it is git-ignored.
- Measuring API latency against a prod server (`npx next start -p PORT`): a previous instance still holding the port makes the new one die silently (EADDRINUSE only in its log) and you end up measuring stale code. Check `ss -tlnp | grep PORT` first; free the port with `fuser -k PORT/tcp`, never `pkill -f "next start -p PORT"` — that pattern matches your own shell's command line and kills it.
- Route-level in-memory caches (`fetchOrCache`) live per server process: restart wipes them, so "cold" is first-hit-after-start and warm hits are ~3 ms (dashboard route is the reference).
- Tests: `.venv/bin/python -m pytest tests/ -q` run from `prop-model/`. No network needed.
- `tests/test_walkforward_acceptance.py` is the shrinkage regression gate (model MAE vs plain mean-8 on real data, per repair-plan item 5). It needs a populated `prop-model/cache/*.pkl` — git-ignored, so it skips silently in CI; populate once with any live CLI pull (e.g. `--player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV`) and re-run. Knob changes to `ModelWeights` (esp. `prior_strength`, `opp_shrink`, `*_count` fields) must keep it green.
- Cache entries from different vintages can carry different raw schemas (e.g. gameday native vs derived). Always `normalize_weekly` each entry BEFORE concatenating frames — concat-then-normalize poisons mixed-dtype columns with NaT (this bit the walk-forward gate loader).
- As-of convention: `--as-of DATE` projects an event on DATE using strictly-prior data; internally the CLI subtracts one day and `fetch_player_history(as_of)` / `defense_allowed(as_of)` treat the cutoff as inclusive last-usable gameday.
- Backtest/validation: `.venv/bin/python backtest.py --help` — walks a cached season as-of each week. Interval calibration constants (`model.CALIBRATED_SD_MULT_*`) were fitted on 2024+2025 walk-forwards; refit via the quantile method in the backtest if the interval formula changes (they were re-checked after the 2026-08 shrinkage retune: coverage 0.71 continuous / 0.72 count).
- Game-day ledger (ALL sports): `prop-model/propmodel/ledger.py` + `prop-model-ledger.py` CLI (`pre`/`live`/`lines`/`finalize`/`grade`/`grades`/`get`/`list`), data in git-ignored `prop-model/ledger/ledger.json`, served by `src/app/api/prop-ledger/route.ts` (+ `GET /api/prop-grades` running accuracy). NextGamePanel saves the pre snapshot (NFL: Python model + book line + pick; NBA/NHL/MLB: keyless season-average rows joined to the DK line), records one live point per period (Q/P/inning via linescore length) from the ESPN box score, snapshots DK lines hourly pre-game, and freezes closing lines on final. Per-sport live parsing (`MODEL_STATS_PER_SPORT`, DNP-as-null so dressed-but-benched players are never graded as zeroes) lives in `src/lib/propLedger.ts`; grading/scorecards in `src/lib/propGrades.ts` — both client-safe. Never import `@/lib/propModel` (it pulls in `child_process`) from a client component. GameView renders ONE panel per game (ledger key = sorted team pair: fantasy abbrs for NFL, ESPN codes otherwise); `record_live` dedups same-period replays so concurrent views can't double-record.
- Daily warm (kc-llm cron `0 6 * * * .../prop-model/daily-warm.sh`): one CLI pull refreshes the shared nflverse disk cache (24h TTL), then `daily_warm.py` warms `/api/props` + triggers `/api/scraper` for games kicking off within 96h — NFL via 3 weekly slates, NBA/NHL/MLB via ESPN scoreboard (one call/day in window). Read-only — never writes ledger snapshots (pre is write-once; an early lineless snapshot would lock out Friday's lines).
- Hourly line refresh (kc-llm cron `0 * * * * .../prop-model/line-refresh.sh`): `line_refresh.py` re-scrapes DraftKings lines for pre-game games of all 4 leagues kicking off within 7d and banks each pull as an append-only `lines` snapshot on the ledger (`prop-model/propmodel/ledger.py::record_lines`, capped at 200/game); recent finals are `finalize`d so the latest pre-final snapshot freezes as the closing lines. `GET /api/prop-ledger` returns the game plus its `grade` (pre projections vs final actuals at the closing lines, computed in `src/lib/propGrades.ts`, mirrored in Python `grade_game`); `GET /api/prop-grades` aggregates the running accuracy (MAE + over/under hit rate) across graded games. NextGamePanel re-pulls `/api/props` hourly while pre-game, snapshots the on-screen board hourly, and freezes on final.
- DraftKings-only board: the Docker scraper (`scraper/scraper_api.py`) serves DK lines for NFL/NBA/NHL/MLB via Action Network's free web API (per-league scoreboard paths + stat-keyword maps in `LEAGUES`, ESPN-abbr canonicalization, optional `game_time` for MLB doubleheaders; Odds API path per sport when keyed). Every other book is dropped at the source; results store under sport-scoped keys (`SPORT_TEAM_OPP_DATE`). The old Playwright per-book page scraping was removed (bot-blocked, never returned lines).
- Schedule freshness follows the game clock: `scheduleTtlFor` (`src/lib/cache/ttl.ts`) returns `TTL.SCHEDULE_FAST` (30s) when any event is live or inside the ±6h gameday window, else `TTL.SCHEDULE` (6h). Applied in `src/app/api/schedule/route.ts` and `gameService.getSchedule` — a flat 6h TTL drops live games from the dash (cached `pre` state + past date matches neither future nor live). Tests: `src/lib/cache/__tests__/schedule-ttl.test.ts`.
- League schedule (`/nfl` → WeeklySchedule): one ESPN `scoreboard?week=N&season=Y` call supplies ALL games of the week, completed or not (`fetchNflWeekEvents`/`fetchCurrentNflWeek` in `src/lib/scheduleWeek.ts`; default view = current week, All Games). Live cards poll `/api/live-stats?eventId=` (summary boxscore team stats, 15s-cached) and switch scorelines to a head-to-head stat block; card list itself re-polls at 30s while anything is live/gameday. `/api/game/[eventId]` page polls box-score every 15s during `in` and feeds `isLive`+`liveBoxScore` into NextGamePanel (Model-vs-Live). Don't re-fan-out per-team schedules for the week board — the scoreboard feed is authoritative.
- Injury-aware props (all teams, nothing game-specific): pre-game `out` starters auto-swap to their outlook `contender` via `effectiveLineup` (any position); mid-game, QB exits are derived fresh every live poll from box-score attempts + the ESPN roster `injuries` feed — a different QB holding the job 2+ polls with an injury flag (or a 0-attempt starter vs 8+ backup attempts past Q1) marks EXITED, fires a single-target backup projection, and swaps back the moment the starter throws again. Helpers in `src/lib/injury.ts` (tests: `src/lib/__tests__/injury.test.ts`); substitutions are recorded on ledger live points.
- Prop-table + player-page readability: `src/components/PropTableLegend.tsx` ("What do these mean?" toggle: Proj/Line/Pick %/Conf/Live/Final/Picks x/y) sits above the NFL model table and `PlayerProjections`; every stat abbreviation on the player page (`PlayerView.tsx` tiles, category rows, past-season headers) carries a `title` tooltip from `statMeaning()` plus a "stat guide" toggle (`STAT_GLOSSARY` in `src/lib/roster-stats.ts`). Keep new columns to the same pattern: short header + `title` explanation + glossary row.
- Formula 1 (5th sport, no ESPN team shapes): 11 constructors in `teams.ts` (sport `F1`), `SportKey`/`SPORT_SLUGS`/`sportConfig`/`sportPath`/`SPORT_ALLOWLIST` extended. Data is OpenF1 live timing + Jolpica calendar/standings (`src/lib/f1-server.ts` fetchers, pure merge/format in `src/lib/f1.ts`, tests in `src/lib/__tests__/f1.test.ts`). Routes: `/api/f1/schedule|standings|session|live|track` (3s live cache shared across tabs; 6h track cache; `refresh=1` bypasses track cache). UI: static `/f1` hub (`F1Hub`), `/f1/race/[sessionKey]` live circuit map (`F1TrackCanvas`: outline traced from one clean flying lap with teleport-jump rejection, car dots in raw OpenF1 units shared with the outline) + `F1Tower` + race control, `/f1/[teamId]` constructor pages (`F1TeamPanel`); the generic `[sport]`/`[team]` pages branch to the F1 components so ESPN home/away assumptions never run. OpenF1 throttles heavy endpoints per IP — keep bursts small (one multi-driver location query, not per-driver; cheap path for finals; 5s poll). No F1 fantasy/props/ledger (books have F1 markets but that's unwired).
- API hardening conventions (2026-09 sweep): GET params validated in `src/lib/api-validation.ts` and upstream URL parts go through `encodeURIComponent`; POST bodies on prop-model/concierge/scraper pass `checkRateLimit` (`src/lib/rate-limit.ts`, per-IP token bucket, 30/min+burst). `cacheService` stores max 500 entries (LRU-evicted), hashes keys > 200 chars, and treats `null`/empty/`{error}`/`{odds:null}` results as negative entries served for only 15s (`isCachedFresh`) — failure results must never pin a full TTL. The prop-model route ignores client `weightsJson` (arbitrary-file-read) and always uses `tunedWeightsPath()`; error responses are `{ error: CODE, message }` — never echo tracebacks/`String(err)`/upstream bodies. Ledger `pre` snapshots are write-once (409 `SNAPSHOT_EXISTS`); NextGamePanel treats 409 as success and hydrates from GET.

---

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
