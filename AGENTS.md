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
- Game-day ledger: `prop-model/propmodel/ledger.py` + `prop-model-ledger.py` CLI (`pre`/`live`/`get`/`list`), data in git-ignored `prop-model/ledger/ledger.json`, served by `src/app/api/prop-ledger/route.ts`. NextGamePanel auto-runs the model once per game, saves the pre snapshot (model + book line + pick), then records one live point per quarter from the ESPN box score; the model table shows a Live/Final column vs the frozen snapshot. Client-safe stat parsing lives in `src/lib/propLedger.ts` — never import `@/lib/propModel` (it pulls in `child_process`) from a client component; `eventDateToAsOf` now lives in `propLedger.ts` and is re-exported by `propModel.ts`.
- Schedule freshness follows the game clock: `scheduleTtlFor` (`src/lib/cache/ttl.ts`) returns `TTL.SCHEDULE_FAST` (30s) when any event is live or inside the ±6h gameday window, else `TTL.SCHEDULE` (6h). Applied in `src/app/api/schedule/route.ts` and `gameService.getSchedule` — a flat 6h TTL drops live games from the dash (cached `pre` state + past date matches neither future nor live). Tests: `src/lib/cache/__tests__/schedule-ttl.test.ts`.
- Injury-aware props (all teams, nothing game-specific): pre-game `out` starters auto-swap to their outlook `contender` via `effectiveLineup` (any position); mid-game, QB exits are derived fresh every live poll from box-score attempts + the ESPN roster `injuries` feed — a different QB holding the job 2+ polls with an injury flag (or a 0-attempt starter vs 8+ backup attempts past Q1) marks EXITED, fires a single-target backup projection, and swaps back the moment the starter throws again. Helpers in `src/lib/injury.ts` (tests: `src/lib/__tests__/injury.test.ts`); substitutions are recorded on ledger live points.

---

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
