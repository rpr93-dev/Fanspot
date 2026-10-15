"""Forward-test harness tests (repair item 2).

The headline regression: a snapshot "locked" 2026-10-14 must never carry an
as-of cutoff of 2026-10-20. Also guards slate verification and snapshot
immutability.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from forward.forward_test import (
    Slate,
    cutoff_for_slate,
    freeze_snapshot,
    load_schedule,
    plan,
    verify_slate,
)


def _weekly(season=2026, week=7):
    rows = []
    for h, a in [("BUF", "MIA"), ("KC", "DEN")]:
        rows.append({
            "player_id": "00-1", "player_name": "A", "player_display_name": "A",
            "position": "QB", "recent_team": h, "opponent_team": a,
            "season": season, "week": week, "gameday": "2026-10-22",
            "game_id": f"{h}{a}", "games": 1,
        })
    return pd.DataFrame(rows)


def test_future_cutoff_is_refused():
    # The exact defect: predictions locked 2026-10-14 with a week-7 slate that
    # (under the old synthetic mapping) produced a 2026-10-20 cutoff.
    slate = Slate(season=2026, week=7,
                  games=[{"date": "2026-10-22", "home": "BUF", "away": "MIA"}],
                  verified=True, notes=[])
    locked = datetime(2026, 10, 14, tzinfo=timezone.utc)
    cutoff, problems = cutoff_for_slate(slate, locked)
    assert any("FUTURE CUTOFF" in p for p in problems)
    assert cutoff == "2026-10-21"


def test_cutoff_is_before_first_kickoff():
    slate = Slate(season=2026, week=7,
                  games=[{"date": "2026-10-15", "home": "BUF", "away": "MIA"}],
                  verified=True, notes=[])
    locked = datetime(2026, 10, 14, tzinfo=timezone.utc)
    cutoff, problems = cutoff_for_slate(slate, locked)
    assert not problems
    assert cutoff == "2026-10-14"


def test_verified_schedule_loads_and_validates(tmp_path):
    p = tmp_path / "sched.json"
    p.write_text(json.dumps({
        "season": 2026,
        "weeks": {"7": [{"date": "2026-10-15", "home": "BUF", "away": "MIA"},
                        {"date": "2026-10-15", "home": "KC", "away": "DEN"}]},
    }))
    slate = load_schedule(p, 2026, 7)
    assert slate.verified and len(slate.games) == 2
    assert verify_slate(slate, _weekly()) == []


def test_slate_missing_frame_teams_is_flagged(tmp_path):
    p = tmp_path / "sched.json"
    p.write_text(json.dumps({"season": 2026, "weeks": {"7": [
        {"date": "2026-10-15", "home": "BUF", "away": "MIA"}]}}))
    slate = load_schedule(p, 2026, 7)
    problems = verify_slate(slate, _weekly())  # frame also has KC/DEN
    assert any("omits teams" in x for x in problems)


def test_plan_without_schedule_marks_unverified():
    slate, cutoff, problems = plan(_weekly(), 2026, 7,
                                   datetime(2026, 10, 14, tzinfo=timezone.utc), None)
    assert slate.verified is False
    assert any("UNVERIFIED" in p for p in problems)


def test_snapshot_is_frozen_and_immutable(tmp_path):
    slate = Slate(season=2026, week=7,
                  games=[{"date": "2026-10-15", "home": "BUF", "away": "MIA"}],
                  verified=True, notes=[])
    locked = datetime(2026, 10, 14, tzinfo=timezone.utc)
    snap = freeze_snapshot(tmp_path / "snaps", 2026, 7, locked, slate, "2026-10-14",
                           batch=[{"player": "A"}], projections=[{"player": "A", "projection": 1.0}],
                           weights={"halflife": 8.0}, code_root=Path.cwd())
    assert (snap / "batch.json").exists()
    assert (snap / "projections.json").exists()
    assert (snap / "MANIFEST.sha256.json").exists()
    meta = json.loads((snap / "meta.json").read_text())
    assert meta["cutoff_as_of"] == "2026-10-14"
    assert meta["slate_verified"] is True
    # Re-freezing the same identity must never overwrite a frozen snapshot.
    with pytest.raises(FileExistsError):
        freeze_snapshot(tmp_path / "snaps", 2026, 7, locked, slate, "2026-10-14",
                        batch=[], projections=[], weights={}, code_root=Path.cwd())
