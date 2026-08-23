# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## prop-model (Python)

- Setup: `cd prop-model && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pyarrow requests` (system Python has no pandas; `pyarrow` is needed for the direct nflverse parquet fallback, `requests` for downloads).
- On Python ≥3.13 `nfl_data_py` fails to install/404s; the fetcher falls back to direct nflverse parquet downloads automatically. Live pulls are cached under `prop-model/cache/*.pkl` via `DiskCache` (6h TTL) — any CLI pull populates it.
- Tests: `.venv/bin/python -m pytest tests/ -q` run from `prop-model/`. No network needed.
- Backtest/validation: `.venv/bin/python backtest.py --help` — walks a cached season as-of each week. Interval calibration constants (`model.CALIBRATED_SD_MULT_*`) were fitted on 2024+2025 walk-forwards; refit via the quantile method in the backtest if the interval formula changes.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
