"""STAGE 6 — output formatting: dashboard-ready table + atomic writers."""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import pandas as pd

from .model import FullProjection, Projection

# Columns the dashboard consumes. market_line / edge are intentionally empty for
# now (market comparison was deferred); they exist so the schema doesn't change
# when The Odds API lines are wired in.
# Canonical projection fields (p10-p90, pred_sd, ESS, confidence_score, role)
# are appended for forward compat — the legacy projection view still works.
TABLE_COLUMNS = [
    "player", "stat", "my_projection", "market_line", "edge",
    "confidence", "last_updated", "low", "high", "n_games",
    "baseline", "opponent_factor", "script_factor", "refused_reason", "note", "reliability",
    # Canonical extension (Phase 2): distribution + diagnostics
    "p10", "p25", "p50", "p75", "p90", "pred_sd",
    "effective_sample_size", "confidence_score", "role_factor", "recent_form_factor",
    "warnings",
]


def projections_table(
    projections: list[Projection | FullProjection],
    as_of: date | None = None,
    data_through: date | None = None,
) -> pd.DataFrame:
    """One row per projection with the dashboard schema.

    ``last_updated`` stamps the **data vintage** (the newest gameday in the
    input frame, ``data_through``), not the wall-clock run time — a projection
    computed off a days-old cache must say so. Falls back to ``as_of``/today
    only when the frame carries no dates.
    """
    stamp = data_through or as_of or date.today()
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
            "last_updated": f"{stamp.isoformat()}T00:00:00",
            "low": d["low"],
            "high": d["high"],
            "n_games": d["n_games"],
            "baseline": d["baseline"],
            "opponent_factor": d["opponent_factor"],
            "script_factor": d["script_factor"],
            "refused_reason": d["refused_reason"],
            "note": d.get("note"),
            "reliability": d.get("reliability", 0),
            # Canonical extension
            "p10": d.get("p10"),
            "p25": d.get("p25"),
            "p50": d.get("p50"),
            "p75": d.get("p75"),
            "p90": d.get("p90"),
            "pred_sd": d.get("pred_sd"),
            "effective_sample_size": d.get("effective_sample_size"),
            "confidence_score": d.get("confidence_score"),
            "role_factor": d.get("role_factor"),
            "recent_form_factor": d.get("recent_form_factor"),
            "warnings": json.dumps(d["warnings"]) if d.get("warnings") else None,
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
        # NaN → null: Python's json module would otherwise emit bare `NaN`
        # tokens, which aren't valid JSON (the dashboard's JSON.parse rejects them).
        records = df.astype(object).where(pd.notna(df), None).to_dict(orient="records")
        tmp.write_text(json.dumps(records, default=str), encoding="utf-8")
    else:
        raise ValueError(f"Unsupported output extension: {path.suffix} (use .csv or .json)")
    os.replace(tmp, path)
    return path
