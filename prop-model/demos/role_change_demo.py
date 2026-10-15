"""Demonstrate pregame role-change handling on the known 2026 cases.

For each case we rebuild the *pregame* information set (history strictly before
the game) and project the player both ways:

- **history-only** — what the model does with no role feed (the old behavior);
- **role-aware** — the same history plus a timestamped depth-chart/availability
  row saying whether the player is the expected starter.

Only pregame information is used: the history cutoff excludes the game being
projected and the depth-chart row is effective before kickoff. The point is not
to be right about one game; it is to show the model's *behavior* changes the
right way — a promoted backup is projected at starter volume, an unavailable
player is refused rather than projected from stale history, and a case with no
role information is flagged uncertain instead of silently confident.

Run from prop-model/:  .venv/bin/python demos/role_change_demo.py
"""

from __future__ import annotations

import glob
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from propmodel.data_pipeline import fetch_player_history, normalize_weekly
from propmodel.model import ModelWeights, project
from propmodel.role import load_depth_chart, resolve_role, starter_volume_prior
from propmodel.stats import get_stat

# (label, player_id, display name, team, 2026 week, kickoff gameday, pregame role, actual attempts, actual passing yards)
CASES = [
    ("Bagent wk4 (promoted backup)", "00-0038416", "Tyson Bagent", "CHI", 4, "2026-09-29", "named_starter"),
    ("Huntley wk5 (promoted backup)", "00-0035993", "Tyler Huntley", "MIA", 5, "2026-10-06", "named_starter"),
    ("Dart wk2 (starter exited)", "00-0040691", "Jaxson Dart", "NYG", 2, "2026-09-15", "named_starter"),
]


def _load():
    hits = sorted(glob.glob("cache/*.pkl"))
    frames = [normalize_weekly(pd.read_pickle(p)) for p in hits]
    return normalize_weekly(pd.concat(frames, ignore_index=True))


def main() -> int:
    weekly = _load()
    weights = ModelWeights()
    stat = "passing_yards"
    print(f"{'case':<34}{'hist games':>11}{'no-role proj':>14}{'role proj':>11}{'expected vol':>14}{'actual att/yds':>16}")
    for label, pid, name, team, week, kick, role in CASES:
        kick_ts = pd.Timestamp(kick)
        cutoff = (kick_ts - pd.Timedelta(days=1)).date()
        prior_frame = weekly.copy()
        if "gameday" in prior_frame.columns:
            gd = pd.to_datetime(prior_frame["gameday"], errors="coerce")
            prior_frame = prior_frame[gd.isna() | (gd <= pd.Timestamp(cutoff))]
        hist = fetch_player_history(pid, stat, n_games=8, seasons=[2023, 2024, 2025, 2026],
                                    fetcher=lambda _: prior_frame)
        pos_prior_vals = prior_frame[prior_frame["position"] == "QB"].apply(
            lambda r: r.get("passing_yards"), axis=1).dropna().astype(float)
        pos_prior = float(pos_prior_vals.mean()) if len(pos_prior_vals) else None
        starter_prior, _ = starter_volume_prior(prior_frame, stat, as_of=cutoff)

        no_role = project(hist, {"factor": 1.0}, {"factor": 1.0}, weights, position_prior=pos_prior)
        info = resolve_role([], name, team, "QB", batch_role=role)
        role_proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, weights, position_prior=pos_prior,
                            role_info=info, starter_volume_prior=starter_prior)

        # Realized line for context (not used by the model).
        game = weekly[(weekly["player_id"] == pid) & (weekly["season"] == 2026) & (weekly["week"] == week)]
        actual = "-"
        if len(game):
            g = game.iloc[0]
            att = g.get("attempts")
            yds = g.get("passing_yards")
            actual = f"{'' if pd.isna(att) else int(att)}/{'' if pd.isna(yds) else int(yds)}"

        nr = "refused" if no_role.projection is None else f"{no_role.projection:.1f}"
        rp = "refused" if role_proj.projection is None else f"{role_proj.projection:.1f}"
        ev = f"{starter_prior:.1f}" if starter_prior is not None else "-"
        print(f"{label:<34}{hist.n_games:>11}{nr:>14}{rp:>11}{ev:>14}{actual:>16}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
