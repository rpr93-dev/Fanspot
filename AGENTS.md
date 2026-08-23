# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## prop-model (Python)

- Setup: `cd prop-model && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pyarrow requests` (system Python has no pandas; `pyarrow` is needed for the direct nflverse parquet fallback, `requests` for downloads).
- On Python ≥3.13 `nfl_data_py` fails to install/404s; the fetcher falls back to direct nflverse parquet downloads automatically. Live pulls are cached under `prop-model/cache/*.pkl` via `DiskCache` (24h TTL) — any CLI pull populates it.
- Sharp edge: with `prop-model/.venv` present, `npm run build` (Turbopack) fails tracing `src/app/api/prop-model/route.ts` ("Symlink ... is invalid, it points out of the filesystem root"). Temporarily move the venv out of the tree to build; it is git-ignored.
- Measuring API latency against a prod server (`npx next start -p PORT`): a previous instance still holding the port makes the new one die silently (EADDRINUSE only in its log) and you end up measuring stale code. Check `ss -tlnp | grep PORT` first; free the port with `fuser -k PORT/tcp`, never `pkill -f "next start -p PORT"` — that pattern matches your own shell's command line and kills it.
- Route-level in-memory caches (`fetchOrCache`) live per server process: restart wipes them, so "cold" is first-hit-after-start and warm hits are ~3 ms (dashboard route is the reference).
- Tests: `.venv/bin/python -m pytest tests/ -q` run from `prop-model/`. No network needed.
- `tests/test_walkforward_acceptance.py` is the shrinkage regression gate (model MAE vs plain mean-8 on real data, per repair-plan item 5). It needs a populated `prop-model/cache/*.pkl` — git-ignored, so it skips silently in CI; populate once with any live CLI pull (e.g. `--player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV`) and re-run. Knob changes to `ModelWeights` (esp. `prior_strength`, `opp_shrink`, `*_count` fields) must keep it green.
- As-of convention: `--as-of DATE` projects an event on DATE using strictly-prior data; internally the CLI subtracts one day and `fetch_player_history(as_of)` / `defense_allowed(as_of)` treat the cutoff as inclusive last-usable gameday.
- Backtest/validation: `.venv/bin/python backtest.py --help` — walks a cached season as-of each week. Interval calibration constants (`model.CALIBRATED_SD_MULT_*`) were fitted on 2024+2025 walk-forwards; refit via the quantile method in the backtest if the interval formula changes (they were re-checked after the 2026-08 shrinkage retune: coverage 0.71 continuous / 0.72 count).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
