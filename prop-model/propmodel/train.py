"""Train / tune the prop-model's weights on historical data.

Uses walk-forward scoring (same harness as ``backtest.py``) but grid-searches
the knobs that matter for out-of-sample MAE:

    halflife        — recency decay (2, 4, 6, 8)
    prior_strength  — shrinkage toward position prior (0, 0.5, 1, 3)
    opp_shrink      — shrinkage toward league-average defense (3, 6, 10)
    opponent        — exponent on opponent factor (0.5, 1.0)
    game_script     — exponent on Vegas factor (0, 0.5, 1) — neutral here

Data source
-----------
``--data-source nflverse``  walks the cached nflverse weekly frames
(``cache/*.pkl``) — the model's native history.

``--data-source espn`` builds a dashboard-native frame from ESPN
scoreboard + summary box scores (``propmodel.espn_fetcher``), cached as
``cache/espn_weekly_<lo>_<hi>.parquet`` so the first run downloads but the
next is instant. Weekly columns are the same as nflverse so the walk-forward
is identical; ESPN tends to lag on advanced stats but tracks the core
yards/TD/reception numbers the prop markets use.

Usage
-----
    # Tune on ESPN's last two seasons (first run downloads ~500 summaries)
    .venv/bin/python -m propmodel.train --data-source espn --seasons 2024 2025

    # Tune on nflverse's cached data
    .venv/bin/python -m propmodel.train --data-source nflverse --seasons 2024 2025

    # Quick smoke (fewer combos, fewer weeks):
    .venv/bin/python -m propmodel.train --quick --data-source espn

Outputs best weights per stat (lowest MAE) and writes
``cache/tuned_weights_<source>.json`` for the dashboard to consume.

The resulting MAE / coverage are directly comparable to ``backtest.py`` —
same walk-forward, same ``FIRST_WEEK=2`` / ``LAST_WEEK=18`` window and
``PER_WEEK_CAP`` sampling, just with a different ``ModelWeights`` per trial.
"""

from __future__ import annotations

import argparse
import itertools
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

from .data_pipeline import COL_POSITION, COL_SEASON, COL_WEEK, normalize_weekly
from .model import ModelWeights

logger = logging.getLogger(__name__)

DEFAULT_SEASONS = [2024, 2025]
STATS = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "tds"]

# Small grid — big enough to find signal, small enough to finish in minutes.
GRID = {
    "halflife": [2.0, 4.0, 6.0, 8.0],
    "prior_strength": [0.0, 0.5, 1.0, 3.0],
    "opp_shrink": [3.0, 6.0, 10.0],
    "opponent": [0.5, 1.0],
}

QUICK_GRID = {
    "halflife": [4.0, 6.0],
    "prior_strength": [0.5, 1.0],
    "opp_shrink": [6.0],
    "opponent": [1.0],
}


def _load_weekly(source: str, seasons: list[int], cache_dir: Path) -> pd.DataFrame:
    if source == "espn":
        from .espn_fetcher import fetch_weekly_espn_cached

        df = fetch_weekly_espn_cached(seasons, cache_dir=cache_dir)
        if df.empty:
            raise SystemExit(f"ESPN fetch for {seasons} returned 0 rows — scoreboard/summary may be down")
        return normalize_weekly(df)
    # nflverse
    import glob as _glob

    hits = sorted(_glob.glob(str(cache_dir / "*.pkl")))
    if not hits:
        raise SystemExit(f"No cached nflverse weekly data under {cache_dir}/ — run a live CLI pull once first")
    frames = [pd.read_pickle(p) for p in hits]
    weekly = normalize_weekly(pd.concat(frames, ignore_index=True))
    # Filter to requested seasons if present
    if COL_SEASON in weekly.columns:
        weekly = weekly[weekly[COL_SEASON].isin(seasons)]
    if weekly.empty:
        raise SystemExit(f"No nflverse rows for seasons {seasons} in cache")
    return weekly


def _score_weights(weekly: pd.DataFrame, season: int, weights: ModelWeights, stat: str, n_games: int = 8) -> dict:
    """Walk-forward score for one stat/season/weights (copied from backtest.run_stat)."""
    # Import here so train.py doesn't import backtest at top-level when not needed.
    from backtest import run_stat

    history_seasons = list(range(season - 3, season + 1))
    return run_stat(weekly, stat, weights, n_games, season, history_seasons)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-source", choices=["nflverse", "espn"], default="espn", help="history to train on")
    ap.add_argument("--seasons", type=int, nargs="*", default=DEFAULT_SEASONS, help="seasons to walk forward (last is validation)")
    ap.add_argument("--quick", action="store_true", help="tiny grid for smoke tests")
    ap.add_argument("--cache-dir", default="cache", help="prop-model cache dir")
    ap.add_argument("--out", default=None, help="where to write tuned weights JSON")
    ap.add_argument("--n-games", type=int, default=8, help="history window")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    cache_dir = Path(args.cache_dir)
    seasons = sorted(int(s) for s in args.seasons)
    grid = QUICK_GRID if args.quick else GRID
    combos = list(itertools.product(grid["halflife"], grid["prior_strength"], grid["opp_shrink"], grid["opponent"]))
    logger.info("Training on %s %s — %d combos × %d stats × %d seasons", args.data_source, seasons, len(combos), len(STATS), len(seasons))

    weekly = _load_weekly(args.data_source, seasons, cache_dir)
    logger.info("Loaded %d weekly rows (vintage %s)", len(weekly), str(weekly["gameday"].max()) if "gameday" in weekly.columns else "unknown")

    best: dict[str, dict] = {}
    for stat in STATS:
        logger.info("=== %s ===", stat)
        best_mae = float("inf")
        best_w = None
        best_detail = None
        for halflife, prior_strength, opp_shrink, opponent in combos:
            w = ModelWeights(halflife=halflife, prior_strength=prior_strength, opp_shrink=opp_shrink, opponent=opponent)
            maes = []
            for season in seasons:
                try:
                    res = _score_weights(weekly, season, w, stat, n_games=args.n_games)
                    if res["mae"] is not None:
                        maes.append(res["mae"])
                except Exception as e:
                    logger.warning("score failed for %s %s season %d: %s", stat, w, season, e)
            if not maes:
                continue
            mae = float(np.mean(maes))
            if mae < best_mae:
                best_mae = mae
                best_w = w
                best_detail = {"mae": mae, "seasons": seasons, "maes": maes}
                logger.info("  new best %s MAE %.2f <- %s", stat, mae, w)
        if best_w is not None:
            best[stat] = {
                "halflife": best_w.halflife,
                "prior_strength": best_w.prior_strength,
                "opp_shrink": best_w.opp_shrink,
                "opponent": best_w.opponent,
                "mae": best_detail["mae"],
                "per_season_mae": best_detail["maes"],
            }
            logger.info("Best %s: MAE %.2f with halflife=%.1f prior=%.1f opp_shrink=%.1f opponent=%.1f", stat, best_detail["mae"], best_w.halflife, best_w.prior_strength, best_w.opp_shrink, best_w.opponent)
        else:
            logger.warning("No valid score for %s", stat)

    out_path = Path(args.out) if args.out else cache_dir / f"tuned_weights_{args.data_source}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"source": args.data_source, "seasons": seasons, "n_games": args.n_games, "grid": grid, "best": best}
    out_path.write_text(json.dumps(payload, indent=2))
    logger.info("Wrote %s", out_path)
    # Also write a single ModelWeights JSON consumable by --weights-json (average of per-stat best)
    if best:
        avg = {
            "halflife": round(float(np.mean([v["halflife"] for v in best.values()])), 2),
            "prior_strength": round(float(np.mean([v["prior_strength"] for v in best.values()])), 2),
            "opp_shrink": round(float(np.mean([v["opp_shrink"] for v in best.values()])), 2),
            "opponent": round(float(np.mean([v["opponent"] for v in best.values()])), 2),
        }
        avg_path = cache_dir / "tuned_weights_avg.json"
        avg_path.write_text(json.dumps(avg, indent=2))
        logger.info("Wrote %s (avg over stats)", avg_path)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
