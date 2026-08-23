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

## How the projection works

```
baseline   = recency-weighted mean of the player's last N played games
             (exponential decay, halflife = 4 games), shrunk toward a
             position-level prior in proportion to sample noise:
             weight on own mean = ESS / (ESS + prior_strength)
projection = baseline × opponent_factor × game_script_factor
opponent_factor    = defense's allowed-per-game ratio vs league average over
                     the same recent window, shrunk toward 1.0 for short
                     windows (games / (games + opp_shrink) of raw signal)
game_script_factor = implied team total ÷ league-average team total,
                     clamped to [0.6, 1.4]; neutral 1.0 without lines
[low, high]        = projection ± predictive_sd, where
    predictive_sd  = eff_std × sqrt(1 + 1/ESS) × calibration_multiplier
```

- **ESS** (effective sample size) = `1/Σwᵢ²` of the recency weights — a full
  8-game window carries ≈5 games' worth of information after decay.
- **Calibration multipliers** (`model.CALIBRATED_SD_MULT_*`) were fitted by
  walking the cached 2024–2025 seasons with `backtest.py` so the stated ~68%
  range covers ≈68% of held-out outcomes (realized: ~0.70 continuous /
  ~0.72 count on 2025).
- **Thin history refuses loudly**: fewer than `min_games` usable games (or any
  error-severity data flag) returns `projection: null` with a reason instead
  of a fabricated number. Played weeks missing a recorded continuous-stat
  value are excluded and flagged (`INCOMPLETE_STAT`), never silently zeroed.
- Backtest results per stat (MAE, bias, coverage by history size) are printed
  by `backtest.py`; see its docstring.

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

## Backtest

Scores the model against cached actuals by walking a season week-by-week,
projecting each sampled player-week from strictly-prior data only:

```bash
# one-time: populate the disk cache (any live pull does this)
python -m propmodel.cli --player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV

.venv/bin/python backtest.py                     # walk the latest cached season
.venv/bin/python backtest.py --backtest-season 2024
.venv/bin/python backtest.py --prior-strength 3  # sweep knobs (--help for all)
```

Game-script is neutral (no historical Vegas lines are cached), so results
measure baseline + opponent quality. Position priors and defense reads are
computed as-of each evaluation week — no leakage.
