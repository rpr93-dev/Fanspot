"""STAGE 6 tests — player resolution, output table/writers, CLI end-to-end."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pytest

from propmodel.output import projections_table, write_table
from propmodel.players import normalize_name, resolve_player_id


def test_normalize_name():
    assert normalize_name("C.J. Stroud") == "cj stroud"
    assert normalize_name("  De'Von   Achane ") == "devon achane"


def test_resolve_player_id_matches_name_and_team():
    weekly = pd.DataFrame([
        {"player_id": "00-1", "player_name": "C.J. Stroud", "recent_team": "HOU", "season": 2025, "week": 1},
        {"player_id": "00-2", "player_name": "CJ Stroud", "recent_team": "HOU", "season": 2025, "week": 2},
        {"player_id": "00-3", "player_name": "C.J. Stroud", "recent_team": "LV", "season": 2025, "week": 3},
    ])
    # Both HOU rows normalize to the same name; the most recent (week 2) wins.
    assert resolve_player_id(weekly, "C.J. Stroud", "HOU") == "00-2"
    assert resolve_player_id(weekly, "c.j. stroud", "lv") == "00-3"
    # Name-only fallback: a player who changed teams still resolves (their
    # history lives under the old team), but the requested team is preferred
    # when both exist.
    assert resolve_player_id(weekly, "C.J. Stroud", "SEA") == "00-3"
    assert resolve_player_id(weekly, "Nobody", "HOU") is None


def test_resolve_player_id_prefers_requested_team():
    weekly = pd.DataFrame([
        {"player_id": "00-1", "player_name": "Kirk Cousins", "recent_team": "ATL", "season": 2025, "week": 17},
        {"player_id": "00-1", "player_name": "Kirk Cousins", "recent_team": "ATL", "season": 2024, "week": 12},
        {"player_id": "00-2", "player_name": "Kirk Cousins", "recent_team": "LV", "season": 2025, "week": 1},
    ])
    # Both teams present: the requested team (LV, the player's current team)
    # wins even though ATL has more games.
    assert resolve_player_id(weekly, "Kirk Cousins", "LV") == "00-2"
    # No rows on the requested team → fall back to name-only.
    assert resolve_player_id(weekly, "Kirk Cousins", "HOU") == "00-1"


def test_cli_uses_espn_prior_for_rookie(tmp_path):
    """A player with no NFL history projects the ESPN prior instead of refusing."""
    import tests.test_data_pipeline as tdp  # reuse row builders

    rows = [
        {
            **tdp.qb_row(1, 220, gameday="2025-09-08", opp="HOU"),
            "player_id": "00-100001", "player_name": "Opp QB", "recent_team": "IND",
            "opponent_team": "HOU",
        },
        {
            **tdp.qb_row(1, 180, gameday="2025-09-08", opp="LV"),
            "player_id": "00-100002", "player_name": "Opp2 QB", "recent_team": "KC",
            "opponent_team": "LV",
        },
    ]
    weekly_csv = tmp_path / "weekly.csv"
    tdp._weekly(rows).to_csv(weekly_csv, index=False)

    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([
        {"player": "Fernando Mendoza", "stat": "passing_yards", "team": "LV", "opponent": "HOU", "prior": 180},
    ]))
    result = subprocess.run(
        [sys.executable, "-m", "propmodel.cli", "--weekly", str(weekly_csv), "--input", str(batch)],
        capture_output=True, text=True, cwd=Path(__file__).resolve().parent.parent,
    )
    assert result.returncode == 0, result.stderr
    records = json.loads(result.stdout)
    row = records[0]
    assert row["projection"] == 180.0
    assert row["refused_reason"] is None
    assert "rookie" in (row["note"] or "")
    assert row["confidence"] == "low"


def _sample_projection():
    from propmodel.data_pipeline import PlayerHistory
    from propmodel.model import Projection
    from propmodel.stats import get_stat

    return Projection(
        player_name="Test QB", stat=get_stat("passing_yards"), projection=232.5,
        baseline=220.0, low=180.0, high=285.0, confidence="high", n_games=10,
        opponent_factor=1.1, script_factor=0.95,
    )


def test_projections_table_schema():
    df = projections_table([_sample_projection()], as_of=date(2026, 8, 18))
    assert df.columns.tolist() == [
        "player", "stat", "my_projection", "market_line", "edge",
        "confidence", "last_updated", "low", "high", "n_games",
        "baseline", "opponent_factor", "script_factor", "refused_reason", "note",
    ]
    row = df.iloc[0]
    assert row["my_projection"] == 232.5
    assert row["market_line"] is None and row["edge"] is None  # deferred
    assert row["last_updated"].startswith("2026-08-18")


def test_write_table_csv_and_json(tmp_path):
    df = projections_table([_sample_projection()])
    csv_path = write_table(df, tmp_path / "out.csv")
    assert csv_path.exists()
    assert "player,stat,my_projection" in csv_path.read_text(encoding="utf-8").splitlines()[0]

    json_path = write_table(df, tmp_path / "out.json")
    records = json.loads(json_path.read_text(encoding="utf-8"))
    assert records[0]["player"] == "Test QB"
    # No temp files left behind.
    assert list(tmp_path.glob("*.tmp")) == []


def test_cli_end_to_end(tmp_path):
    """Full pipeline via `python -m propmodel.cli` with offline weekly data."""
    import tests.test_data_pipeline as tdp  # reuse row builders

    from datetime import date as _d

    rows = []
    start = date.today() - timedelta(days=7 * 6)
    for i in range(6):
        gameday = start + timedelta(days=7 * i)
        rows.append({
            **tdp.qb_row(i + 1, 200 + i * 15, gameday=gameday.isoformat()),
            "player_id": "00-000001",
            "player_name": "Test QB",
            "recent_team": "HOU",
            "opponent_team": "TEN",
        })
        # Opposing QBs vs HOU and LV so the defense-allowed rates have data.
        rows.append({
            **tdp.qb_row(i + 1, 220, gameday=gameday.isoformat(), opp="HOU"),
            "player_id": "00-100001", "player_name": "Opp QB", "recent_team": "IND",
            "opponent_team": "HOU",
        })
        rows.append({
            **tdp.qb_row(i + 1, 180, gameday=gameday.isoformat(), opp="LV"),
            "player_id": "00-100002", "player_name": "Opp2 QB", "recent_team": "KC",
            "opponent_team": "LV",
        })
    weekly_csv = tmp_path / "weekly.csv"
    tdp._weekly(rows).to_csv(weekly_csv, index=False)

    lines_json = tmp_path / "lines.json"
    lines_json.write_text(json.dumps({"HOU": {"total": 40.5, "spread": 1.5, "favorite": "HOU"}}))

    out_json = tmp_path / "out.json"
    result = subprocess.run(
        [
            sys.executable, "-m", "propmodel.cli",
            "--weekly", str(weekly_csv),
            "--lines-json", str(lines_json),
            "--player", "Test QB", "--stat", "passing_yards",
            "--team", "HOU", "--opponent", "LV",
            "--n-games", "5",
            "--output", str(out_json),
        ],
        capture_output=True, text=True, cwd=Path(__file__).resolve().parent.parent,
    )
    assert result.returncode == 0, result.stderr
    records = json.loads(out_json.read_text(encoding="utf-8"))
    assert len(records) == 1
    row = records[0]
    assert row["player"] == "Test QB"
    assert row["my_projection"] is not None
    assert row["n_games"] == 5
    assert row["confidence"] in ("high", "medium", "low")
    # Projection should be baseline scaled by the opponent + script factors.
    baseline = row["baseline"]
    # Output values are rounded (projection 1dp, factors 3dp), so allow ~1%.
    assert row["my_projection"] == pytest.approx(
        baseline * row["opponent_factor"] * row["script_factor"], rel=0.01
    )


def test_cli_batch_with_unknown_player(tmp_path):
    weekly_csv = tmp_path / "weekly.csv"
    pd.DataFrame(columns=["player_id", "player_name", "recent_team"]).to_csv(weekly_csv, index=False)
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([{"player": "Nobody", "stat": "passing_yards", "team": "HOU", "opponent": "LV"}]))
    result = subprocess.run(
        [sys.executable, "-m", "propmodel.cli", "--weekly", str(weekly_csv), "--input", str(batch)],
        capture_output=True, text=True, cwd=Path(__file__).resolve().parent.parent,
    )
    assert result.returncode == 0
    records = json.loads(result.stdout)
    assert records[0]["projection"] is None
    assert "not found" in (records[0]["refused_reason"] or "")
