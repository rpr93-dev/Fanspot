"""Honest walk-forward evaluation harness.

Answers, per stat, the only question that matters when changing the model:
*does the change actually reduce error versus a plain weighted 8-game mean,
measured on the SAME rows and the SAME sample?*

Guarantees (these are the point of the harness):

- **Identical rows.** Every candidate (the full model and each ablation) is
  scored on exactly the same player-week rows — rows where the full model
  produced a projection. The comparison sample never changes between columns.
- **Explicit baseline.** The benchmark is the weighted 8-game baseline: the
  same recency-weighted mean of the player's last 8 games (same halflife),
  with NO opponent, NO game script, NO shrinkage, NO role scaling. The plain
  unweighted mean-8 is reported too, for reference.
- **Clustered uncertainty.** Related observations are not independent: the
  same player appears across weeks and the same game-week links many players.
  Improvement CIs come from a two-way cluster bootstrap (resample players and
  resample game-weeks) and the wider of the two is reported.
- **Component ablations.** Opponent adjustment, shrinkage (prior strength),
  game script and the combined-factor clamp are each turned off individually
  so added complexity has to earn its place.
- **Workload-grouped uncertainty.** Interval coverage and width are reported
  inside each stat by comparable-workload tercile — a model cannot look
  "covered" merely by widening every interval.
- **Posted-props subset.** When a lines file is supplied, results are also
  reported for players who actually have a posted sportsbook line. Without one
  that bucket is reported as unavailable, never silently dropped.
- **Development vs forward kept separate.** Seasons are partitioned into a
  development set and a forward set; the two are never pooled in the headline.
- **Frozen.** A manifest records the exact code hashes, weights, sample
  parameters, row-set hash and timestamp for the run.

Usage (from prop-model/):
    .venv/bin/python eval_honest.py                     # development split
    .venv/bin/python eval_honest.py --forward           # forward split only
    .venv/bin/python eval_honest.py --out eval_out      # write JSON + manifest
    .venv/bin/python eval_honest.py --prop-lines lines.json
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import math
import subprocess
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from propmodel.data_pipeline import (
    COL_GAMEDAY,
    COL_POSITION,
    COL_SEASON,
    COL_WEEK,
    fetch_player_history,
    normalize_weekly,
    _stat_value,
)
from propmodel.game_script import script_adjustment
from propmodel.model import ModelWeights, project, recency_weights
from propmodel.opponent import _allowed_per_team_week, team_week_rates
from propmodel.role import resolve_role
from propmodel.stats import get_stat

STATS = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "tds"]
SOURCE_FILES = [
    "propmodel/model.py", "propmodel/role.py", "propmodel/stats.py",
    "propmodel/players.py", "propmodel/cli.py", "propmodel/data_pipeline.py",
    "propmodel/opponent.py", "propmodel/game_script.py",
]


# ── data loading ───────────────────────────────────────────────────────────

def load_cached_frames(cache_dir: str) -> pd.DataFrame:
    hits = sorted(glob.glob(f"{cache_dir}/*.pkl"))
    if not hits:
        raise SystemExit(
            f"No cached weekly data under {cache_dir}/ — run a live CLI pull once first."
        )
    # Normalize BEFORE concat (mixed vintages carry different raw schemas).
    frames = [normalize_weekly(pd.read_pickle(p)) for p in hits]
    return normalize_weekly(pd.concat(frames, ignore_index=True))


def weighted_mean(values: np.ndarray, halflife: float) -> float:
    if len(values) == 0:
        return float("nan")
    w = recency_weights(len(values), halflife)
    return float(np.average(values, weights=w))


# ── sample construction ────────────────────────────────────────────────────

def sample_rows(weekly: pd.DataFrame, stat_key: str, seasons: list[int],
                per_week_cap: int, first_week: int, last_week: int, seed: int) -> list[dict]:
    spec = get_stat(stat_key)
    rng = np.random.default_rng(seed)
    picked: dict[tuple, dict] = {}
    for season in seasons:
        rows = weekly[
            (weekly[COL_SEASON] == season)
            & (weekly[COL_WEEK].between(first_week, last_week))
            & (weekly[COL_POSITION].astype(str).str.upper().isin(spec.positions))
        ]
        for wk in range(first_week, last_week + 1):
            pool = rows[rows[COL_WEEK] == wk]
            if pool.empty:
                continue
            idx = rng.choice(pool.index.to_list(), size=min(per_week_cap, len(pool)), replace=False)
            for i in idx:
                r = pool.loc[i]
                key = (str(r["player_id"]), int(season), int(wk))
                picked.setdefault(key, {
                    "player_id": str(r["player_id"]),
                    "season": int(season),
                    "week": int(wk),
                    "opponent": str(r.get("opponent_team")),
                    "game_key": f"{season}-{wk}",
                })
    return [picked[k] for k in sorted(picked)]


# ── per-row evaluation ─────────────────────────────────────────────────────

def _row_actual(row: pd.Series, spec) -> float | None:
    vals = [float(row[c]) for c in spec.columns if not pd.isna(row.get(c))]
    return sum(vals) if vals else None


def evaluate(weekly: pd.DataFrame, seasons: list[int], weights: ModelWeights,
             per_week_cap: int, first_week: int, last_week: int, seed: int,
             n_games: int, prop_lines: dict[str, float] | None = None) -> pd.DataFrame:
    """Return one scored row per (stat, player, season, week) that the full model
    projects. Every candidate is added as a column on that same row."""
    records: list[dict] = []
    for stat_key in STATS:
        spec = get_stat(stat_key)
        tw = _allowed_per_team_week(weekly, spec)
        if COL_GAMEDAY in tw.columns:
            tw[COL_GAMEDAY] = pd.to_datetime(tw[COL_GAMEDAY], errors="coerce")
        row_vals = weekly.apply(lambda r: _stat_value(r, spec), axis=1)
        pos_mask = weekly[COL_POSITION].astype(str).str.upper().isin(spec.positions)

        for s in sample_rows(weekly, stat_key, seasons, per_week_cap, first_week, last_week, seed):
            pid, season, wk = s["player_id"], s["season"], s["week"]
            hist_frame = weekly[(weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk)]
            hist = fetch_player_history(pid, spec, n_games=n_games, seasons=seasons,
                                        fetcher=lambda _: hist_frame)
            row = weekly[(weekly["player_id"] == pid) & (weekly[COL_SEASON] == season)
                         & (weekly[COL_WEEK] == wk)]
            if row.empty:
                continue
            row = row.iloc[0]
            actual = _row_actual(row, spec)
            if actual is None or hist.games.empty or hist.n_games < weights.min_games:
                continue

            game_day = pd.Timestamp(f"{season}-09-08") + pd.Timedelta(days=(wk - 1) * 7)
            sub = tw[tw[COL_GAMEDAY] <= game_day - pd.Timedelta(days=1)]
            rates = team_week_rates(sub, window=n_games, min_games=weights.min_games,
                                    shrink_games=weights.opp_shrink)
            opp_row = rates[rates["team"] == s["opponent"].upper()] if not rates.empty else rates
            opp_f = ({"factor": float(opp_row.iloc[0]["ratio"]), "available": True}
                     if len(opp_row) else {"factor": 1.0})

            m = pos_mask & ((weekly[COL_SEASON] < season) | (weekly[COL_WEEK] < wk))
            pv = row_vals[m].dropna().astype(float)
            prior = float(pv.mean()) if len(pv) else None

            role = resolve_role([], hist.player_name, s.get("team") or hist.team, hist.position)

            values = hist.games["value"].values.astype(float)
            baseline_w8 = weighted_mean(values, weights.halflife)
            baseline_mean8 = float(np.mean(values[-8:]))

            def _proj(w: ModelWeights):
                return project(hist, opp_f, script_adjustment("X", "Y", None), w,
                               position_prior=prior, role_info=role)

            full = _proj(weights)
            if full.projection is None:
                continue

            # Same-rows ablations: each knob off, one at a time.
            ablate = {
                "no_opponent": _proj(replace(weights, opponent=0.0)),
                "no_shrink_prior": _proj(replace(weights, prior_strength=0.0, prior_strength_count=0.0)),
                "shrink_prior_on": _proj(replace(weights, prior_strength=1.0, prior_strength_count=0.5)),
                "no_factor_clamp": _proj(replace(weights, factor_clamp_hi=10.0, factor_clamp_lo=0.1)),
            }

            opp_col = spec.opportunity_columns[0] if spec.opportunity_columns else None
            workload = None
            if opp_col and opp_col in hist.games.columns:
                ov = pd.to_numeric(hist.games[opp_col], errors="coerce").dropna()
                if len(ov):
                    workload = float(ov.median())

            key = f"{hist.player_name}|{stat_key}"
            rec = {
                "stat": stat_key,
                "player_id": pid,
                "player_name": hist.player_name,
                "season": season,
                "week": wk,
                "game_key": s["game_key"],
                "position": hist.position,
                "workload": workload,
                "actual": actual,
                "model": full.projection,
                "covered": bool(full.low <= actual <= full.high) if full.low is not None else None,
                "width": (full.high - full.low) if full.high is not None else None,
                "confidence": full.confidence,
                "prior_source": (full.inputs or {}).get("prior_source"),
                "baseline_w8": baseline_w8,
                "baseline_mean8": baseline_mean8,
                "has_posted_line": bool(prop_lines and key in prop_lines),
            }
            for name, p in ablate.items():
                rec[name] = p.projection
            records.append(rec)
    return pd.DataFrame(records)


# ── metrics ────────────────────────────────────────────────────────────────

def _metrics(err: np.ndarray) -> dict:
    if len(err) == 0:
        return {"n": 0, "mae": None, "rmse": None, "bias": None}
    return {
        "n": int(len(err)),
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(math.sqrt(np.mean(err ** 2))),
        "bias": float(np.mean(err)),
    }


def cluster_bootstrap_delta(df: pd.DataFrame, col_a: str, col_b: str,
                            cluster: str, n_boot: int = 500, seed: int = 17) -> tuple[float, float]:
    """95% CI for MAE(col_a) - MAE(col_b), resampling whole clusters.

    Positive = col_a has LARGER error (worse). Clusters make related rows move
    together (one player's weeks, or one game-week's players)."""
    d = df.dropna(subset=["actual", col_a, col_b])
    if d.empty:
        return (float("nan"), float("nan"))
    groups = d.groupby(cluster, sort=False)
    clusters = [g for _, g in groups]
    if len(clusters) < 2:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    deltas = []
    for _ in range(n_boot):
        idx = rng.integers(0, len(clusters), size=len(clusters))
        sample = pd.concat([clusters[i] for i in idx], ignore_index=True)
        ea = (sample[col_a] - sample["actual"]).abs().mean()
        eb = (sample[col_b] - sample["actual"]).abs().mean()
        deltas.append(ea - eb)
    lo, hi = np.percentile(deltas, [2.5, 97.5])
    return (float(lo), float(hi))


def summarize(df: pd.DataFrame, weights: ModelWeights, n_boot: int) -> dict:
    out: dict = {"pooled": {}, "by_stat": {}, "workload_coverage": {}, "ablations": {}}
    if df.empty:
        return out

    def _block(d: pd.DataFrame) -> dict:
        model_err = (d["model"] - d["actual"]).values
        base_err = (d["baseline_w8"] - d["actual"]).values
        plain_err = (d["baseline_mean8"] - d["actual"]).values
        m = _metrics(model_err)
        m["baseline_w8"] = _metrics(base_err)
        m["baseline_mean8"] = _metrics(plain_err)
        m["delta_mae_vs_w8"] = (m["mae"] - m["baseline_w8"]["mae"]) if m["mae"] is not None else None
        m["delta_rmse_vs_w8"] = (m["rmse"] - m["baseline_w8"]["rmse"]) if m["rmse"] is not None else None
        m["coverage68"] = float(d["covered"].mean()) if d["covered"].notna().any() else None
        m["mean_width"] = float(d["width"].mean()) if d["width"].notna().any() else None
        if m["mae"] is not None:
            lo, hi = cluster_bootstrap_delta(d, "model", "baseline_w8", "player_id", n_boot)
            m["delta_mae_ci_by_player"] = [lo, hi]
            lo2, hi2 = cluster_bootstrap_delta(d, "model", "baseline_w8", "game_key", n_boot)
            m["delta_mae_ci_by_game"] = [lo2, hi2]
        return m

    out["pooled"] = _block(df)
    for stat, d in df.groupby("stat", sort=False):
        out["by_stat"][stat] = _block(d)
        # Workload-grouped coverage/width: tertiles within the stat.
        wd = d.dropna(subset=["workload"])
        if len(wd) >= 9:
            try:
                wd = wd.assign(bucket=pd.qcut(wd["workload"], 3, labels=["low", "mid", "high"], duplicates="drop"))
            except ValueError:
                wd = wd.assign(bucket="all")
            out["workload_coverage"][stat] = {
                str(b): {
                    "n": int(len(g)),
                    "coverage68": float(g["covered"].mean()) if g["covered"].notna().any() else None,
                    "mean_width": float(g["width"].mean()) if g["width"].notna().any() else None,
                    "mae": float((g["model"] - g["actual"]).abs().mean()),
                }
                for b, g in wd.groupby("bucket", observed=True)
            }

    # Ablations: full vs one-knob-off, per stat, plus pooled.
    def _ablation_block(d: pd.DataFrame, base_col: str) -> dict:
        res = {}
        for name in ["no_opponent", "no_shrink_prior", "shrink_prior_on", "no_factor_clamp"]:
            if name not in d.columns:
                continue
            dd = d.dropna(subset=["actual", "model", name])
            if dd.empty:
                continue
            diff = (dd[name] - dd["actual"]).abs() - (dd[base_col] - dd["actual"]).abs()
            res[name] = {"n": int(len(dd)), "mean_delta_mae_vs_full": float(diff.mean())}
        return res

    out["ablations"]["pooled"] = _ablation_block(df, "model")
    for stat, d in df.groupby("stat", sort=False):
        out["ablations"][stat] = _ablation_block(d, "model")

    # Posted-props subset.
    posted = df[df["has_posted_line"]]
    if len(posted):
        out["posted_props"] = _block(posted)
    else:
        out["posted_props"] = {"available": False, "reason": "no posted-lines file supplied"}
    # Prior/rookie rows reported separately.
    prior_rows = df[df["prior_source"].notna()]
    if len(prior_rows):
        out["prior_rows"] = _block(prior_rows)
    return out


# ── freeze manifest ────────────────────────────────────────────────────────

def code_hashes() -> dict[str, str]:
    out = {}
    root = Path(__file__).resolve().parent
    for rel in SOURCE_FILES:
        p = root / rel
        if p.exists():
            out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    return out


def _git_rev() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parent).decode().strip()
    except Exception:
        return "unknown"


def manifest(weights: ModelWeights, args, df: pd.DataFrame) -> dict:
    row_hash = hashlib.sha256(
        "|".join(sorted(f"{r.player_id}:{r.stat}:{r.season}:{r.week}" for r in df.itertuples())).encode()
    ).hexdigest()[:16]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_rev": _git_rev(),
        "code_hashes": code_hashes(),
        "weights": {k: v for k, v in weights.__dict__.items()},
        "params": {
            "seasons": args.seasons,
            "per_week_cap": args.per_week_cap,
            "first_week": args.first_week,
            "last_week": args.last_week,
            "n_games": args.n_games,
            "seed": args.seed,
            "n_boot": args.n_boot,
            "forward": args.forward,
        },
        "rows_hash": row_hash,
        "n_rows": int(len(df)),
    }


# ── CLI ────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", default="cache")
    ap.add_argument("--seasons", nargs="*", type=int, help="seasons to evaluate (default: dev = all but the latest)")
    ap.add_argument("--forward", action="store_true", help="evaluate the FORWARD split (latest cached season) instead of development")
    ap.add_argument("--per-week-cap", type=int, default=15)
    ap.add_argument("--first-week", type=int, default=2)
    ap.add_argument("--last-week", type=int, default=18)
    ap.add_argument("--n-games", type=int, default=8)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--n-boot", type=int, default=500)
    ap.add_argument("--prop-lines", help="JSON {'player|stat': line} to report the posted-props subset")
    ap.add_argument("--out", help="directory to write eval JSON + freeze manifest")
    args = ap.parse_args(argv)

    weekly = load_cached_frames(args.cache_dir)
    all_seasons = sorted(int(s) for s in weekly[COL_SEASON].unique())
    if args.seasons:
        seasons = args.seasons
    elif args.forward:
        seasons = [max(all_seasons)]
    else:
        seasons = all_seasons[:-1]  # development = everything but the latest
    weekly = weekly[weekly[COL_SEASON].isin(seasons)]

    prop_lines = None
    if args.prop_lines:
        prop_lines = {str(k): float(v) for k, v in json.loads(Path(args.prop_lines).read_text()).items()}

    weights = ModelWeights()
    split = "FORWARD" if args.forward else "DEVELOPMENT"
    print(f"=== eval_honest — {split} split, seasons {seasons} ===")

    df = evaluate(weekly, seasons, weights, args.per_week_cap, args.first_week,
                  args.last_week, args.seed, args.n_games, prop_lines)
    if df.empty:
        print("no evaluable rows (check cache/seasons)")
        return 1

    summary = summarize(df, weights, args.n_boot)

    p = summary["pooled"]
    print(f"\npooled n={p['n']}  model MAE={p['mae']:.2f} / RMSE={p['rmse']:.2f} / bias={p['bias']:.2f} "
          f"| weighted-8 MAE={p['baseline_w8']['mae']:.2f} | plain-8 MAE={p['baseline_mean8']['mae']:.2f}")
    print(f"  delta MAE vs weighted-8: {p['delta_mae_vs_w8']:+.2f} "
          f"(95% CI by player {p['delta_mae_ci_by_player']}, by game {p['delta_mae_ci_by_game']})")
    print(f"  coverage68={p['coverage68']:.3f}  mean_width={p['mean_width']:.2f}")

    print(f"\n{'stat':<16}{'n':>5}{'modelMAE':>10}{'w8MAE':>9}{'dMAE':>8}{'dRMSE':>8}"
          f"{'CI(player)':>20}{'cov':>7}{'width':>8}")
    for stat, m in summary["by_stat"].items():
        ci = m.get("delta_mae_ci_by_player", [float("nan"), float("nan")])
        print(f"{stat:<16}{m['n']:>5}{m['mae']:>10.2f}{m['baseline_w8']['mae']:>9.2f}"
              f"{m['delta_mae_vs_w8']:>+8.2f}{m['delta_rmse_vs_w8']:>+8.2f}"
              f"{f'[{ci[0]:+.2f},{ci[1]:+.2f}]':>20}"
              f"{m['coverage68']:>7.3f}{m['mean_width']:>8.2f}")

    print("\n-- ablations (mean delta MAE vs full; positive = the knob HELPED) --")
    for stat, abl in summary["ablations"].items():
        for name, r in abl.items():
            print(f"  {stat:<16} {name:<18} n={r['n']:<5} delta={r['mean_delta_mae_vs_full']:+.3f}")

    print("\n-- workload-tercile coverage --")
    for stat, buckets in summary["workload_coverage"].items():
        row = "  ".join(f"{b}: n={v['n']} cov={v['coverage68']} w={v['mean_width']:.1f}" for b, v in buckets.items())
        print(f"  {stat:<16} {row}")

    if not summary["posted_props"].get("available", True):
        print(f"\nposted-props subset: UNAVAILABLE ({summary['posted_props']['reason']})")

    out = {"split": split, "seasons": seasons, "summary": summary,
           "manifest": manifest(weights, args, df)}
    if args.out:
        d = Path(args.out)
        d.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        (d / f"eval_{split.lower()}_{stamp}.json").write_text(json.dumps(out, indent=2, default=str))
        (d / f"manifest_{split.lower()}_{stamp}.json").write_text(json.dumps(out["manifest"], indent=2))
        print(f"\nwrote {d}/eval_{split.lower()}_{stamp}.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
