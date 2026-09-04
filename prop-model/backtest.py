"""Backtest harness: score the projection model against cached actuals.

Loads the cached nflverse weekly frames (populated by any live CLI pull via
``reliability.DiskCache``), then walks sampled player-weeks of a backtest
season and asks: "what would the model have projected *before* this game,
using only prior games and an as-of opponent read?" Each evaluation is scored
against the actual stat line.

Per stat we report MAE, bias, RMSE, coverage of the stated ~68% confidence
range, mean range width, and the refusal rate, plus a history-size breakdown
(thin samples are where models usually lie to you). Baseline-only (no
opponent / game-script factor) is reported alongside the full model so each
stage's contribution is visible.

Game-script is neutral 1.0 throughout: no historical Vegas lines are cached
(The Odds API integration is deferred), so this measures baseline + opponent
quality. Position priors and defense reads are computed strictly from games
before each evaluation week — no leakage.

Usage (from prop-model/):
    .venv/bin/python backtest.py                     # score defaults
    .venv/bin/python backtest.py --halflife 6 ...    # sweep a knob
"""

from __future__ import annotations

import argparse
import glob
import json
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from propmodel.data_pipeline import (
    COL_POSITION,
    COL_SEASON,
    COL_WEEK,
    fetch_player_history,
    normalize_weekly,
    _stat_value,
)
from propmodel.game_script import script_adjustment
from propmodel.model import ModelWeights, project, recency_weights, effective_sample_size
from propmodel.opponent import DEFAULT_OPP_SHRINK, _allowed_per_team_week, team_week_rates
from propmodel.stats import get_stat

FIRST_WEEK = 2          # week 1 has no in-season history for most players
LAST_WEEK = 18          # regular season
PER_WEEK_CAP = 12       # max players per stat per week (seeded sample)
SEED = 17


@dataclass
class Eval:
    player_id: str
    stat: str
    season: int
    week: int
    n_games: int
    actual: float | None      # None = refused / not scoreable
    projection: float | None = None
    low: float | None = None
    high: float | None = None
    baseline_proj: float | None = None   # opponent/game-script neutral twin
    pred_sd: float | None = None
    covered: bool | None = None
    baselines: dict[str, float] | None = None  # simple baseline projections


def load_cached_frames(cache_dir: str) -> pd.DataFrame:
    """Concatenate every cached weekly pickle into one frame."""
    hits = sorted(glob.glob(f"{cache_dir}/*.pkl"))
    if not hits:
        raise SystemExit(
            f"No cached weekly data under {cache_dir}/ — run a live CLI pull "
            "once first (it populates the disk cache)."
        )
    frames = [pd.read_pickle(p) for p in hits]
    return normalize_weekly(pd.concat(frames, ignore_index=True))


def eligible_sample(weekly: pd.DataFrame, stat_key: str, season: int) -> list[dict]:
    """Seeded sample of (player_id, week) evaluations for one stat."""
    spec = get_stat(stat_key)
    season_rows = weekly[
        (weekly[COL_SEASON] == season)
        & (weekly[COL_WEEK] >= FIRST_WEEK)
        & (weekly[COL_WEEK] <= LAST_WEEK)
        & (weekly[COL_POSITION].isin(spec.positions))
    ]
    rng = np.random.default_rng(SEED)
    picked: dict[tuple, dict] = {}
    for wk in range(FIRST_WEEK, LAST_WEEK + 1):
        pool = season_rows[season_rows[COL_WEEK] == wk]
        if pool.empty:
            continue
        idx = rng.choice(pool.index.to_list(), size=min(PER_WEEK_CAP, len(pool)), replace=False)
        for i in idx:
            r = pool.loc[i]
            key = (r["player_id"], wk)
            picked.setdefault(key, {
                "player_id": str(r["player_id"]),
                "week": int(wk),
                "opponent": str(r["opponent_team"]),
            })
    return [picked[k] for k in sorted(picked)]


def rates_as_of(tw: pd.DataFrame, window: int, min_games: int, shrink_games: float, as_of) -> pd.DataFrame:
    """Defense rates using only team-games on/before ``as_of`` (no leakage)."""
    sub = tw[tw["gameday"] <= pd.Timestamp(as_of)]
    return team_week_rates(sub, window=window, min_games=min_games, shrink_games=shrink_games)


def _bucket_table(scored: pd.DataFrame) -> str:
    b = scored.copy()
    b["bucket"] = pd.cut(b["n"], [0, 4, 7, 99], labels=["3-4", "5-7", "8+"])
    g = b.groupby(["stat", "bucket"], observed=True).agg(
        n=("err", "size"),
        mae=("err", lambda x: round(float(x.abs().mean()), 1)),
        bias=("err", lambda x: round(float(x.mean()), 1)),
        cov=("covered", lambda x: round(float(x.mean()), 2)),
    )
    return g.to_string()



def ewma_projection(values: np.ndarray, alpha: float = 0.3) -> float:
    """EWMA projection from historical values."""
    if len(values) == 0:
        return 0.0
    result = values[0]
    for v in values[1:]:
        result = alpha * v + (1 - alpha) * result
    return result


def mean_n_projection(values: np.ndarray, n: int) -> float:
    """Plain mean of last n values."""
    if len(values) < n:
        return float(np.mean(values)) if len(values) > 0 else 0.0
    return float(np.mean(values[-n:]))


def run_stat(weekly: pd.DataFrame
, stat_key: str, weights: ModelWeights,
             n_games: int, season: int, history_seasons: list[int]) -> dict:
    spec = get_stat(stat_key)
    tw = _allowed_per_team_week(weekly, spec)

    # Precompute this stat's per-row values once; the position prior for week
    # W is then a cheap masked mean over strictly-prior weeks.
    row_vals = weekly.apply(lambda r: _stat_value(r, spec), axis=1)
    pos_mask = weekly[COL_POSITION].isin(spec.positions)

    def prior_as_of(wk: int) -> float | None:
        m = pos_mask & ((weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk))
        v = row_vals[m].dropna().astype(float)
        return float(v.mean()) if len(v) else None

    evals: list[Eval] = []
    for s in eligible_sample(weekly, stat_key, season):
        pid, wk = s["player_id"], s["week"]
        hist_frame = weekly[(weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk)]
        hist = fetch_player_history(pid, spec, n_games=n_games,
                                    seasons=history_seasons, fetcher=lambda _: hist_frame)

        row = weekly[(weekly["player_id"] == pid) & (weekly[COL_SEASON] == season)
                     & (weekly[COL_WEEK] == wk)].iloc[0]
        vals = [float(row[c]) for c in spec.columns if not pd.isna(row.get(c))]
        actual = sum(vals) if vals else None

        ev = Eval(player_id=pid, stat=stat_key, season=season, week=wk,
                  n_games=hist.n_games, actual=actual)

        # Opponent adjustment strictly as-of the day before this game
        # (synthetic gameday: Sep 8 + (week-1)*7, same convention as
        # data_pipeline.normalize_weekly).
        game_day = pd.Timestamp(f"{season}-09-08") + pd.Timedelta(days=(wk - 1) * 7)
        rates = rates_as_of(tw, window=n_games, min_games=weights.min_games,
                            shrink_games=weights.opp_shrink,
                            as_of=game_day - pd.Timedelta(days=1))
        opp_row = rates[rates["team"] == s["opponent"].upper()]
        if opp_row.empty:
            opp_f = {"factor": 1.0, "available": False}
        else:
            r0 = opp_row.iloc[0]
            opp_f = {"factor": float(r0["ratio"]), "available": not bool(r0["low_sample"])}

        proj = project(hist, opp_f, script_adjustment("X", "Y", None), weights,
                       position_prior=prior_as_of(wk))
        neutral_w = ModelWeights(**{**weights.__dict__, "opponent": 0.0, "game_script": 0.0})
        neutral = project(hist, {"factor": 1.0}, {"factor": 1.0}, neutral_w,
                          position_prior=prior_as_of(wk))
        
        # Compute simple baselines for comparison
        raw_values = hist.games["value"].values.astype(float) if not hist.games.empty else np.array([])
        baselines = {
            "mean_8": mean_n_projection(raw_values, 8),
            "mean_5": mean_n_projection(raw_values, 5),
            "mean_3": mean_n_projection(raw_values, 3),
            "ewma": ewma_projection(raw_values),
        }
        
        if proj.projection is not None:
            ev.projection = proj.projection
            ev.low = proj.low
            ev.high = proj.high
            ev.pred_sd = proj.pred_sd
            ev.baseline_proj = neutral.baseline
            ev.baselines = baselines
            if actual is not None:
                ev.covered = bool(proj.low <= actual <= proj.high)
        evals.append(ev)

    scored = [e for e in evals if e.projection is not None and e.actual is not None]
    baselines = {b: [] for b in ["mean_8", "mean_5", "mean_3", "ewma"]}
    refused = [e for e in evals if e.projection is None]
    errs = np.array([e.projection - e.actual for e in scored])
    base_errs = np.array([e.baseline_proj - e.actual for e in scored])
    for e in scored:
        if e.baselines:
            for k, v in e.baselines.items():
                baselines[k].append(v - e.actual)
    for k in baselines:
        baselines[k] = np.array(baselines[k])
    cover = np.array([e.covered for e in scored])
    width = np.array([e.high - e.low for e in scored])

    def mae(x):
        return round(float(np.mean(np.abs(x))), 1) if len(x) else None

    df = pd.DataFrame([{
        "stat": stat_key, "n": e.n_games,
        "err": (e.projection - e.actual) if (e.projection is not None and e.actual is not None) else None,
        "covered": e.covered,
    } for e in evals]).dropna(subset=["err"])

    return {
        "stat": stat_key,
        "sampled": len(evals),
        "scored": len(scored),
        "refused": len(refused),
        "refusal_pct": round(100 * len(refused) / max(1, len(evals)), 1),
        "mae": mae(errs),
        "baseline_mae": mae(base_errs),
        "bias": round(float(np.mean(errs)), 1) if len(errs) else None,
        "rmse": round(float(math.sqrt(np.mean(errs ** 2))), 1) if len(errs) else None,
        "coverage68": round(float(np.mean(cover)), 3) if len(cover) else None,
        "mean_width": round(float(np.mean(width)), 1) if len(width) else None,
        "_evals": evals,
        "_scored_df": df,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--backtest-season", type=int, default=None,
                    help="season to walk forward through (default: latest cached minus none)")
    ap.add_argument("--halflife", type=float, default=ModelWeights.halflife)
    ap.add_argument("--min-games", type=int, default=ModelWeights.min_games)
    ap.add_argument("--n-games-hint", type=int, default=8, help="history length hint")
    ap.add_argument("--opponent-w", type=float, default=ModelWeights.opponent)
    ap.add_argument("--prior-strength", type=float, default=ModelWeights.prior_strength)
    ap.add_argument("--opp-shrink", type=float, default=DEFAULT_OPP_SHRINK)
    ap.add_argument("--sd-mult-continuous", type=float, default=ModelWeights.sd_mult_continuous)
    ap.add_argument("--sd-mult-count", type=float, default=ModelWeights.sd_mult_count)
    ap.add_argument("--cache-dir", default="cache")
    ap.add_argument("--json-out", help="write per-evaluation detail JSON here")
    args = ap.parse_args()

    weights = ModelWeights(
        halflife=args.halflife, opponent=args.opponent_w, min_games=args.min_games,
        prior_strength=args.prior_strength, opp_shrink=args.opp_shrink,
        sd_mult_continuous=args.sd_mult_continuous, sd_mult_count=args.sd_mult_count,
    )

    weekly = load_cached_frames(args.cache_dir)
    seasons = sorted(int(s) for s in weekly[COL_SEASON].unique())
    season = args.backtest_season or max(seasons)
    # History window: up to three prior seasons plus the backtest season's
    # earlier weeks (fetcher output is pre-filtered per evaluation anyway).
    history_seasons = list(range(season - 3, season + 1))
    stats = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "tds"]
    results = [run_stat(weekly, k, weights, args.n_games_hint, season, history_seasons)
               for k in stats]

    cols = ["stat", "sampled", "scored", "refused", "refusal_pct", "mae", "baseline_mae",
            "bias", "rmse", "coverage68", "mean_width"]
    print(f"=== backtest season {season} ===")
    print(pd.DataFrame([{c: r[c] for c in cols} for r in results]).to_string(index=False))
    print("\n--- by history size ---")
    print("\n\n".join(_bucket_table(r["_scored_df"]) for r in results))

    pooled = pd.concat([r["_scored_df"] for r in results], ignore_index=True)
    cont = pooled[pooled.stat != "tds"]
    cnt = pooled[pooled.stat == "tds"]
    print(f"\npooled coverage68: continuous={cont.covered.mean():.3f} (n={len(cont)}), "
          f"count={cnt.covered.mean():.3f} (n={len(cnt)})")

    if args.json_out:
        all_evals = [vars(e) for r in results for e in r["_evals"]]
        with open(args.json_out, "w") as f:
            json.dump(all_evals, f, default=str)
        print(f"wrote {len(all_evals)} evaluations to {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
