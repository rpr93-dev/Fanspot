"""STAGE 6 — output formatting: dashboard-ready table + atomic writers."""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import pandas as pd

from .model import Projection

# Columns the dashboard consumes. market_line / edge are intentionally empty for
# now (market comparison was deferred); they exist so the schema doesn't change
# when The Odds API lines are wired in.
TABLE_COLUMNS = [
    "player", "stat", "my_projection", "market_line", "edge",
    "confidence", "last_updated", "low", "high", "n_games",
    "baseline", "opponent_factor", "script_factor", "refused_reason",
]


def projections_table(
    projections: list[Projection],
    as_of: date | None = None,
) -> pd.DataFrame:
    """One row per projection with the dashboard schema."""
    as_of = as_of or date.today()
    rows = []
    for p in projections:
        d = p.to_dict()
        rows.append({
            "player": d["player"],
            "stat": d["stat"],
            "my_projection": d["projection"],
            "market_line": None,
            "edge": None,
            "confidence": d["confidence"],
            "last_updated": f"{as_of.isoformat()}T00:00:00",
            "low": d["low"],
            "high": d["high"],
            "n_games": d["n_games"],
            "baseline": d["baseline"],
            "opponent_factor": d["opponent_factor"],
            "script_factor": d["script_factor"],
            "refused_reason": d["refused_reason"],
        })
    return pd.DataFrame(rows, columns=TABLE_COLUMNS)


def write_table(df: pd.DataFrame, path: str | Path) -> Path:
    """Write a table atomically (temp file + rename). CSV or JSON by extension.

    JSON output is a list of records (each row a dict), which is what the
    dashboard's API layer can hand straight to the front end.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    if path.suffix.lower() == ".csv":
        df.to_csv(tmp, index=False)
    elif path.suffix.lower() == ".json":
        tmp.write_text(json.dumps(df.to_dict(orient="records"), default=str), encoding="utf-8")
    else:
        raise ValueError(f"Unsupported output extension: {path.suffix} (use .csv or .json)")
    os.replace(tmp, path)
    return path
