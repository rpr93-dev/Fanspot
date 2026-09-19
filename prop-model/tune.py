"""Fast walk-forward weight tuner (precompute once, grid-search cheaply).

Why this exists: ``propmodel.train`` re-runs the full walk for every weight
combo (player-history fetch, prior scan, opponent rates) — ~96x redundant
work. This tuner precomputes each sampled player-week's history, as-of
opponent factor and position prior ONCE per (stat, season), then scores all
weight combos with bare ``project()`` calls (~0.5 ms each). Same wall-clock
quality, ~10x faster.

Same harness as ``backtest.py`` (seed 17, FIRST_WEEK=2, LAST_WEEK=18,
PER_WEEK_CAP=12) and the same grid as ``propmodel.train`` — except
``game_script``, which is neutral in backtests (no historical Vegas lines are
cached, factor is 1.0, and 1.0**x == 1.0 for any x).

Usage (from prop-model/):
    .venv/bin/python tune.py --seasons 2023 2024 2025
    .venv/bin/python tune.py --seasons 2023 2024 2025 --fit-sd
    .venv/bin/python tune.py --seasons 2023 2024 2025 --json-out detail.json
"""

from __future__ import annotations

import argparse
import glob
import itertools
import json
import time

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
from propmodel.model import ModelWeights, project
from propmodel.opponent import _allowed_per_team_week, team_week_rates
from propmodel.stats import get_stat

FIRST_WEEK = 2
LAST_WEEK = 18
PER_WEEK_CAP = 12
SEED = 17

STATS = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "tds"]

# Same grid as propmodel.train (game_script excluded — see module docstring).
GRID = {
    "halflife": [2.0, 4.0, 6.0, 8.0],
    "prior_strength": [0.0, 0.5, 1.0, 3.0],
    "opp_shrink": [3.0, 6.0, 10.0],
    "opponent": [0.5, 1.0],
}

NEUTRAL_SCRIPT = script_adjustment("X", "Y", None)


def load_cached_frames(cache_dir: str) -> pd.DataFrame:
    hits = sorted(glob.glob(f"{cache_dir}/*.pkl"))
    if not hits:
        raise SystemExit(
            f"No cached weekly data under {cache_dir}/ — run a live CLI pull once first."
        )
    frames = [pd.read_pickle(p) for p in hits]
    return normalize_weekly(pd.concat(frames, ignore_index=True))


def _eligible_sample(weekly: pd.DataFrame, stat_key: str, season: int) -> list[dict]:
    """Identical seeded sample to backtest.eligible_sample (keep in sync)."""
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


def build_evals(weekly: pd.DataFrame, stat_key: str, seasons: list[int],
                n_games: int, shrinks: list[float]) -> dict[int, list[dict]]:
    """Precompute everything a weight combo does NOT change, per sampled
    player-week: player history, actual, position prior, and the as-of
    opponent factor for every grid opp_shrink value."""
    spec = get_stat(stat_key)
    tw = _allowed_per_team_week(weekly, spec)

    row_vals = weekly.apply(lambda r: _stat_value(r, spec), axis=1)
    pos_mask = weekly[COL_POSITION].isin(spec.positions)

    out: dict[int, list[dict]] = {}
    for season in seasons:
        weeks = sorted(int(w) for w in weekly.loc[
            (weekly[COL_SEASON] == season) & (weekly[COL_WEEK].between(FIRST_WEEK, LAST_WEEK)),
            COL_WEEK,
        ].unique())
        if not weeks:
            continue

        # Position prior per week (strictly-prior games only).
        priors: dict[int, float | None] = {}
        for wk in weeks:
            m = pos_mask & ((weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk))
            v = row_vals[m].dropna().astype(float)
            priors[wk] = float(v.mean()) if len(v) else None

        # Opponent rates per (week, shrink) — window/min_games fixed like the
        # backtest (window=n_games, min_games=ModelWeights.min_games=3).
        rates: dict[tuple, pd.DataFrame] = {}
        for wk in weeks:
            game_day = pd.Timestamp(f"{season}-09-08") + pd.Timedelta(days=(wk - 1) * 7)
            as_of = game_day - pd.Timedelta(days=1)
            sub = tw[tw["gameday"] <= as_of]
            for sh in shrinks:
                rates[(wk, sh)] = team_week_rates(sub, window=n_games, min_games=3,
                                                  shrink_games=sh)

        history_seasons = list(range(season - 3, season + 1))
        evals = []
        for s in _eligible_sample(weekly, stat_key, season):
            pid, wk, opp = s["player_id"], s["week"], s["opponent"]
            hist_frame = weekly[(weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk)]
            hist = fetch_player_history(pid, spec, n_games=n_games,
                                        seasons=history_seasons, fetcher=lambda _: hist_frame)
            row = weekly[(weekly["player_id"] == pid) & (weekly[COL_SEASON] == season)
                          & (weekly[COL_WEEK] == wk)].iloc[0]
            vals = [float(row[c]) for c in spec.columns if not pd.isna(row.get(c))]
            actual = sum(vals) if vals else None

            opp_f: dict[float, dict] = {}
            for sh in shrinks:
                r = rates[(wk, sh)]
                opp_row = r[r["team"] == opp.upper()]
                if opp_row.empty:
                    opp_f[sh] = {"factor": 1.0, "available": False}
                else:
                    r0 = opp_row.iloc[0]
                    opp_f[sh] = {"factor": float(r0["ratio"]),
                                 "available": not bool(r0["low_sample"])}
            evals.append({
                "player_id": pid, "week": wk, "hist": hist, "actual": actual,
                "prior": priors[wk], "opp_f": opp_f, "n_games": hist.n_games,
            })
        out[season] = evals
    return out


def score_combo(evals: dict[str, dict[int, list[dict]]], weights: ModelWeights,
                seasons: list[int]) -> dict[str, dict[int, float | None]]:
    """MAE per (stat, season) for one weight combo."""
    out: dict[str, dict[int, float | None]] = {}
    for stat, by_season in evals.items():
        per_season: dict[int, float | None] = {}
        for season in seasons:
            errs: list[float] = []
            for ev in by_season.get(season, []):
                if ev["actual"] is None or ev["hist"].games.empty:
                    continue
                proj = project(ev["hist"], ev["opp_f"][weights.opp_shrink], NEUTRAL_SCRIPT,
                               weights, position_prior=ev["prior"])
                if proj.projection is not None:
                    errs.append(proj.projection - ev["actual"])
            per_season[season] = round(float(np.mean(np.abs(errs))), 2) if errs else None
        out[stat] = per_season
    return out


def fit_sd_mult(errs: np.ndarray, base_sds: np.ndarray, target: float = 0.68) -> float:
    """Solve mean(|err| <= mult * base_sd) == target by bisection.

    The model's 68% interval is proj +/- base_sd * sd_mult, so this directly
    calibrates the stated coverage to ``target``."""
    if len(errs) == 0:
        return 1.0
    a = np.abs(errs)
    b = np.maximum(base_sds, 1e-6)

    def cov(m: float) -> float:
        return float(np.mean(a <= m * b))

    lo, hi = 0.05, 10.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if cov(mid) < target:
            lo = mid
        else:
            hi = mid
    return round(0.5 * (lo + hi), 3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seasons", type=int, nargs="*", default=[2023, 2024, 2025],
                    help="seasons to walk forward (all used for tuning)")
    ap.add_argument("--n-games", type=int, default=8)
    ap.add_argument("--cache-dir", default="cache")
    ap.add_argument("--fit-sd", action="store_true",
                    help="also fit sd_mult (continuous/count) from best-combo OOS residuals")
    ap.add_argument("--json-out", default=None, help="write per-combo score detail here")
    ap.add_argument("--out", default=None, help="tuned-weights JSON path (default cache/tuned_weights_nflverse.json)")
    args = ap.parse_args()

    t_start = time.time()
    seasons = sorted(int(s) for s in args.seasons)
    combos = list(itertools.product(GRID["halflife"], GRID["prior_strength"],
                                    GRID["opp_shrink"], GRID["opponent"]))
    print(f"tune: {len(combos)} combos x {len(STATS)} stats x {seasons} "
          f"(game_script excluded — neutral in backtest)")

    weekly = load_cached_frames(args.cache_dir)
    print(f"loaded {len(weekly)} weekly rows (vintage {weekly['gameday'].max()})")

    # ── Phase 1: precompute ─────────────────────────────────────────────────
    print("\n== precomputing history / priors / opponent rates ==")
    evals: dict[str, dict[int, list[dict]]] = {}
    for stat in STATS:
        t0 = time.time()
        evals[stat] = build_evals(weekly, stat, seasons, args.n_games,
                                  sorted(GRID["opp_shrink"]))
        n_evals = sum(len(v) for v in evals[stat].values())
        print(f"  {stat:<15} {n_evals} evals in {time.time() - t0:.0f}s")

    # ── Phase 2: grid search ────────────────────────────────────────────────
    print("\n== grid search ==")
    detail: list[dict] = []
    best: dict[str, dict] = {}
    for i, (halflife, prior_strength, opp_shrink, opponent) in enumerate(combos):
        w = ModelWeights(halflife=halflife, prior_strength=prior_strength,
                         opp_shrink=opp_shrink, opponent=opponent)
        t0 = time.time()
        res = score_combo(evals, w, seasons)
        dt = time.time() - t0
        for stat in STATS:
            maes = [res[stat].get(s) for s in seasons]
            maes = [m for m in maes if m is not None]
            if not maes:
                continue
            mae = float(np.mean(maes))
            row = {"combo_idx": i, "stat": stat, "halflife": halflife,
                   "prior_strength": prior_strength, "opp_shrink": opp_shrink,
                   "opponent": opponent, "mae": round(mae, 2),
                   "per_season_mae": [res[stat].get(s) for s in seasons]}
            detail.append(row)
            cur = best.get(stat)
            if cur is None or mae < cur["mae"]:
                best[stat] = {
                    "halflife": halflife, "prior_strength": prior_strength,
                    "opp_shrink": opp_shrink, "opponent": opponent,
                    "mae": round(mae, 2),
                    "per_season_mae": [res[stat].get(s) for s in seasons],
                }
        if (i + 1) % 16 == 0:
            print(f"  combo {i + 1}/{len(combos)} ({dt:.1f}s each)")

    # ── Phase 3: report + write ─────────────────────────────────────────────
    print("\n== best per stat (mean of per-season walk-forward MAE) ==")
    hdr = f"{'stat':<15} {'mae':>7}  " + "  ".join(f"{s:>7}" for s in seasons) + "   weights (hl, prior, shrink, opp)"
    print(hdr)
    for stat in STATS:
        b = best.get(stat)
        if not b:
            print(f"{stat:<15}   (no valid score)")
            continue
        ps = "  ".join(f"{(m if m is not None else float('nan')):>7.1f}" for m in b["per_season_mae"])
        print(f"{stat:<15} {b['mae']:>7.1f}  {ps}   ({b['halflife']:.1f}, {b['prior_strength']:.1f}, {b['opp_shrink']:.0f}, {b['opponent']:.1f})")

    # ── Phase 4 (optional): sd_mult calibration from best-combo OOS residuals
    sd_payload = None
    if args.fit_sd:
        print("\n== fitting sd_mult from best-combo residuals (target 68% coverage) ==")
        cont_errs: list[float] = []
        cont_sds: list[float] = []
        cnt_errs: list[float] = []
        cnt_sds: list[float] = []
        for stat in STATS:
            b = best.get(stat)
            if not b:
                continue
            w = ModelWeights(halflife=b["halflife"], prior_strength=b["prior_strength"],
                             opp_shrink=b["opp_shrink"], opponent=b["opponent"])
            is_count = get_stat(stat).kind == "count"
            sd_mult = w.sd_mult_count if is_count else w.sd_mult_continuous
            for season in seasons:
                for ev in evals[stat].get(season, []):
                    if ev["actual"] is None or ev["hist"].games.empty:
                        continue
                    proj = project(ev["hist"], ev["opp_f"][w.opp_shrink], NEUTRAL_SCRIPT,
                                   w, position_prior=ev["prior"])
                    if proj.projection is None or proj.pred_sd is None:
                        continue
                    err = proj.projection - ev["actual"]
                    base_sd = proj.pred_sd / sd_mult
                    if is_count:
                        cnt_errs.append(err); cnt_sds.append(base_sd)
                    else:
                        cont_errs.append(err); cont_sds.append(base_sd)

        mult_cont = fit_sd_mult(np.array(cont_errs), np.array(cont_sds))
        mult_cnt = fit_sd_mult(np.array(cnt_errs), np.array(cnt_sds))
        cov_cont = float(np.mean(np.abs(cont_errs) <= mult_cont * np.array(cont_sds)))
        cov_cnt = float(np.mean(np.abs(cnt_errs) <= mult_cnt * np.array(cnt_sds)))
        print(f"  continuous: sd_mult {mult_cont}  (coverage {cov_cont:.3f}, n={len(cont_errs)})")
        print(f"  count:      sd_mult {mult_cnt}  (coverage {cov_cnt:.3f}, n={len(cnt_errs)})")
        sd_payload = {
            "sd_mult_continuous": mult_cont,
            "sd_mult_count": mult_cnt,
            "target_coverage": 0.68,
            "n_continuous": len(cont_errs),
            "n_count": len(cnt_errs),
            "seasons": seasons,
            "note": "calibrated so mean(|err| <= sd_mult * base_sd) == 0.68 on walk-forward OOS residuals of the tuned weights; base_sd = core_std * sqrt(1 + 1/ess)",
        }

    # ── Write outputs ───────────────────────────────────────────────────────
    cache = args.cache_dir
    out_path = args.out or f"{cache}/tuned_weights_nflverse.json"
    payload = {"source": "nflverse", "seasons": seasons, "n_games": args.n_games,
               "grid": {k: v for k, v in GRID.items()}, "best": best,
               "runtime_sec": round(time.time() - t_start, 1)}
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nwrote {out_path}")

    if best:
        # "Avg" = single on-grid combo that minimizes the mean model-vs-plain
        # mean-8 MAE ratio across all stats (scale-invariant: a naive knob
        # average lands off-grid and is dominated by passing-yards scale).
        plain_mae: dict[str, dict[int, float]] = {}
        for stat in STATS:
            plain_mae[stat] = {}
            for season in seasons:
                plain, act = [], []
                for ev in evals[stat].get(season, []):
                    if ev["actual"] is None or ev["hist"].games.empty:
                        continue
                    plain.append(float(ev["hist"].games["value"].mean()))
                    act.append(ev["actual"])
                if plain:
                    plain_mae[stat][season] = float(
                        np.mean(np.abs(np.array(plain) - np.array(act))))
        # Per-combo, per-stat, per-season model MAE (per_season_mae aligns to seasons).
        combo_mae: dict[int, dict[str, list]] = {}
        for r in detail:
            combo_mae.setdefault(r["combo_idx"], {})[r["stat"]] = r["per_season_mae"]
        scored = []
        for i, (halflife, prior_strength, opp_shrink, opponent) in enumerate(combos):
            ratios = []
            for stat in STATS:
                per_season = combo_mae.get(i, {}).get(stat)
                if not per_season:
                    continue
                for si, season in enumerate(seasons):
                    m = per_season[si]
                    p = plain_mae[stat].get(season)
                    if m is None or not p:
                        continue
                    ratios.append(m / p)
            if ratios:
                scored.append(((halflife, prior_strength, opp_shrink, opponent),
                               float(np.mean(ratios))))
        scored.sort(key=lambda x: x[1])
        (halflife, prior_strength, opp_shrink, opponent), ratio = scored[0]
        avg = {"halflife": halflife, "prior_strength": prior_strength,
               "opp_shrink": opp_shrink, "opponent": opponent,
               "_meta": {"selection": "on-grid combo minimizing mean "
                                       "model/plain-mean-8 MAE ratio across stats",
                         "mean_ratio": round(ratio, 4)}}
        avg_path = f"{cache}/tuned_weights_avg.json"
        with open(avg_path, "w") as f:
            json.dump(avg, f, indent=2)
        print(f"wrote {avg_path} (on-grid ratio winner, mean ratio {ratio:.4f})")

    if sd_payload:
        sd_path = f"{cache}/sd_calibration.json"
        with open(sd_path, "w") as f:
            json.dump(sd_payload, f, indent=2)
        print(f"wrote {sd_path}")

    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump(detail, f, indent=1)
        print(f"wrote {args.json_out} ({len(detail)} rows)")

    print(f"\ndone in {time.time() - t_start:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
