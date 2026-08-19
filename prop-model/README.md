# prop-model

A self-built NFL player prop projection system. It generates its own
over/under projection for a given player + stat (passing yards, receiving
yards, receptions, TDs, …) so it can be compared against sportsbook lines and
spotted for discrepancies.

Built in stages — each stage is a separate, testable module:

| Stage | Module | Status |
|-------|--------|--------|
| 1. Data pipeline | `propmodel/data_pipeline.py` | ✅ done |
| 2. Opponent adjustment | `propmodel/opponent.py` | ✅ done |
| 3. Game-script adjustment (Vegas total/spread) | `propmodel/game_script.py` | ✅ done |
| 4. Weighted model + confidence range | `propmodel/model.py` | ✅ done |
| 5. Reliability (retry, rate limit, cache, logging, cron) | `propmodel/reliability.py` | ✅ done |
| 6. Output table + CLI (player, stat, projection, edge, confidence) | `propmodel/output.py`, `propmodel/cli.py` | ✅ done |

## Data source

NFL nflverse weekly player stats via [`nfl_data_py`](https://pypi.org/project/nfl-data-py/)
(one row per player-week: stats, opponent, games played). The Odds API is
intended for the Vegas total/spread in Stage 3, but market-line *comparison*
(edge) is deferred.

## Setup

```bash
cd prop-model
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

`nfl_data_py` is only needed for live pulls — the package and unit tests run
without it (the fetcher is injectable).

## Run

```bash
# Single player (live data via nfl_data_py, cached in ./cache):
python -m propmodel.cli --player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV

# Batch + CSV output:
python -m propmodel.cli --input batch.json --lines-json lines.json --output projections.csv
```

Lines JSON format: `{"HOU": {"total": 40.5, "spread": 1.5, "favorite": "HOU"}}`.

## Test

```bash
python -m pytest tests/ -q
```
