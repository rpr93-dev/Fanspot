"""Smoke test for the honest evaluation harness.

Guards the harness contract: the baseline and every ablation are scored on the
identical rows as the full model, and the summary reports the required metrics
plus clustered improvement intervals.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

import eval_honest
from propmodel.model import ModelWeights


def _frame() -> pd.DataFrame:
    rows = []
    players = [
        ("00-1", "QB One", "QB", "HOU"),
        ("00-2", "QB Two", "QB", "BUF"),
        ("00-3", "RB One", "RB", "SF"),
        ("00-4", "WR One", "WR", "DET"),
        ("00-5", "WR Two", "WR", "MIA"),
        ("00-6", "TE One", "TE", "KC"),
    ]
    rng = np.random.default_rng(3)
    for season in (2024, 2025):
        for wk in range(1, 7):
            for pid, name, pos, team in players:
                opp = "TEN" if team != "TEN" else "HOU"
                base = date(season, 9, 8) + timedelta(days=7 * (wk - 1))
                row = {
                    "player_id": pid, "player_name": name, "player_display_name": name,
                    "position": pos, "recent_team": team, "opponent_team": opp,
                    "season": season, "week": wk, "gameday": base.isoformat(),
                    "game_id": f"{season}_{wk:02d}_{team}_{opp}", "games": 1,
                    "passing_yards": 0.0, "passing_tds": 0.0, "attempts": 0.0,
                    "completions": 0.0, "passing_interceptions": 0.0,
                    "rushing_yards": 0.0, "rushing_tds": 0.0, "carries": 0.0,
                    "receiving_yards": 0.0, "receptions": 0.0, "receiving_tds": 0.0,
                    "targets": 0.0,
                }
                noise = rng.normal(0, 1)
                if pos == "QB":
                    row.update(passing_yards=240 + 20 * noise, passing_tds=2,
                               attempts=34, completions=22, passing_interceptions=0)
                elif pos == "RB":
                    row.update(rushing_yards=70 + 15 * noise, carries=15, targets=3, receptions=2)
                else:
                    row.update(receiving_yards=55 + 12 * noise, targets=7, receptions=5)
                rows.append(row)
    return pd.DataFrame(rows)


def test_evaluate_scores_identical_rows_and_reports_metrics():
    weekly = _frame()
    df = eval_honest.evaluate(
        weekly, seasons=[2024, 2025], weights=ModelWeights(),
        per_week_cap=100, first_week=2, last_week=6, seed=17, n_games=8,
    )
    assert not df.empty
    # Every candidate is present on every scored row (identical-row guarantee).
    for col in ["model", "baseline_w8", "baseline_mean8",
                "no_opponent", "no_shrink_prior", "shrink_prior_on", "no_factor_clamp"]:
        assert col in df.columns
        assert df[col].notna().all()

    summary = eval_honest.summarize(df, ModelWeights(), n_boot=50)
    assert summary["pooled"]["n"] == len(df)
    assert summary["pooled"]["mae"] is not None
    assert "delta_mae_vs_w8" in summary["pooled"]
    # Clustered CIs computed.
    assert "delta_mae_ci_by_player" in summary["pooled"]
    assert "delta_mae_ci_by_game" in summary["pooled"]
    # Ablations scored.
    assert "no_opponent" in summary["ablations"]["pooled"]
    # Posted-props subset honestly marked unavailable without a lines file.
    assert summary["posted_props"]["available"] is False


def test_manifest_hashes_code_and_rows():
    weekly = _frame()
    df = eval_honest.evaluate(
        weekly, seasons=[2024, 2025], weights=ModelWeights(),
        per_week_cap=50, first_week=2, last_week=6, seed=1, n_games=8,
    )
    import argparse

    args = argparse.Namespace(seasons=[2024, 2025], per_week_cap=50, first_week=2,
                              last_week=6, n_games=8, seed=1, n_boot=50, forward=False)
    m = eval_honest.manifest(ModelWeights(), args, df)
    assert m["rows_hash"] and m["code_hashes"]
    assert "propmodel/model.py" in m["code_hashes"]
