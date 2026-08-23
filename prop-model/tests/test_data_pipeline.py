"""STAGE 1 tests — synthetic nflverse weekly frames, no network / no nfl_data_py."""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from propmodel.data_pipeline import (
    fetch_player_history,
    normalize_weekly,
    validate_weekly,
    weekly_is_usable,
)
from propmodel.stats import get_stat

QB_ID = "00-000001"
QB_NAME = "Test QB"


def _weekly(rows: list[dict]) -> pd.DataFrame:
    cols = [
        "player_id", "player_name", "position", "recent_team", "opponent_team",
        "season", "week", "gameday", "game_id", "games",
        "passing_yards", "passing_tds",
        "rushing_yards", "rushing_tds",
        "receiving_yards", "receptions", "receiving_tds",
    ]
    return pd.DataFrame(rows, columns=cols)


def qb_row(week: int, yds: int, tds: int = 1, played: bool = True,
           gameday: str | None = None, season: int = 2025, opp: str = "TEN") -> dict:
    return {
        "player_id": QB_ID, "player_name": QB_NAME, "position": "QB",
        "recent_team": "HOU", "opponent_team": opp,
        "season": season, "week": week,
        "gameday": gameday or f"2025-09-{10 + week:02d}",
        "game_id": f"{season}_{week:02d}_HOU_{opp}",
        "games": 1 if played else 0,
        "passing_yards": yds if played else None,
        "passing_tds": tds if played else None,
        "rushing_yards": None, "rushing_tds": None,
        "receiving_yards": None, "receptions": None, "receiving_tds": None,
    }


def fetch(rows: list[dict], **kwargs):
    frame = _weekly(rows)
    return fetch_player_history(QB_ID, "passing_yards", seasons=[2025], fetcher=lambda s: frame, **kwargs)


def test_last_n_played_skips_dnp_weeks():
    """A week the player sat (games=0) must not count toward the last N played,
    and must be reported as a missed week inside the window."""
    rows = [qb_row(w, yds=200 + w * 10) for w in range(1, 11)]
    rows[6] = qb_row(7, 0, played=False, gameday="2025-09-17")  # week 7: injured/DNP
    hist = fetch(rows, n_games=8)

    assert hist.ok
    assert hist.n_games == 8
    # The DNP week (7) should not appear among the 8 played games.
    assert 7 not in hist.games["week"].tolist()
    # Last 8 played = weeks 10,9,8,6,5,4,3,2 (week 1 is the oldest, dropped).
    assert hist.games["week"].tolist() == [2, 3, 4, 5, 6, 8, 9, 10]
    assert len(hist.missed_games) == 1
    assert hist.missed_games.iloc[0]["week"] == 7
    assert any(f.code == "MISSED_GAMES" for f in hist.flags)


def test_insufficient_history_is_error():
    hist = fetch([qb_row(1, 220), qb_row(2, 180)], min_games=3)
    assert not hist.ok
    codes = {f.code: f.severity for f in hist.flags}
    assert codes["INSUFFICIENT_HISTORY"] == "error"


def test_stale_flag_warns_when_gap_is_short_offseason_is_info():
    old = (date.today() - timedelta(days=60)).isoformat()
    hist = fetch([qb_row(1, 220, gameday=old), qb_row(2, 180, gameday=old)])
    stale = [f for f in hist.flags if f.code == "STALE"]
    assert stale and stale[0].severity == "warn"

    ancient = (date.today() - timedelta(days=120)).isoformat()
    hist2 = fetch([qb_row(1, 220, gameday=ancient), qb_row(2, 180, gameday=ancient)], min_games=2)
    stale2 = [f for f in hist2.flags if f.code == "STALE"]
    assert stale2 and stale2[0].severity == "info"


def test_td_stat_sums_columns():
    """Anytime-TD for a QB = passing + rushing TDs (missing receiving = 0)."""
    rows = [
        {**qb_row(1, 250, tds=2), "rushing_tds": 1, "receiving_tds": None},
        {**qb_row(2, 300, tds=0), "rushing_tds": 0, "receiving_tds": None},
    ]
    frame = _weekly(rows)
    hist = fetch_player_history(QB_ID, "tds", seasons=[2025], fetcher=lambda s: frame)
    assert hist.games["value"].tolist() == [3.0, 0.0]


def test_unknown_player_reports_no_data():
    rows = [qb_row(1, 220)]
    frame = _weekly(rows)
    hist = fetch_player_history("00-999999", "passing_yards", seasons=[2025], fetcher=lambda s: frame)
    assert not hist.ok
    assert any(f.code == "NO_DATA" for f in hist.flags)


def test_unknown_stat_raises():
    with pytest.raises(ValueError):
        get_stat("bogus_stat")


def test_fewer_games_than_requested_is_info():
    hist = fetch([qb_row(w, 200) for w in range(1, 6)], n_games=8)
    assert hist.ok
    assert any(f.code == "FEWER_GAMES" and f.severity == "info" for f in hist.flags)
    assert hist.n_games == 5


def test_season_boundary_ordering():
    """Weeks reset each season; history must respect season then week so a Week 1
    of a new season is newer than Week 18 of the previous one."""
    rows = [
        qb_row(18, 210, season=2025, gameday="2026-01-04"),
        qb_row(1, 240, season=2026, gameday="2026-09-10"),
        qb_row(17, 190, season=2025, gameday="2025-12-28"),
    ]
    hist = fetch(rows, n_games=3)
    assert hist.games["week"].tolist() == [17, 18, 1]
    assert hist.games["season"].tolist() == [2025, 2025, 2026]


def test_incomplete_stat_excluded_and_flagged():
    """A played week with no recorded continuous-stat value is excluded loudly.

    It must never silently enter the model as a 0.0 — that would fabricate a
    dud game out of a data gap. The week is flagged INCOMPLETE_STAT and
    dropped from the modeling series.
    """
    rows = [qb_row(1, 220), qb_row(2, 0, gameday="2025-09-20", played=True)]
    rows[-1]["passing_yards"] = None  # played but stat missing
    hist = fetch(rows, min_games=2)
    assert not hist.ok  # 1 usable game < min_games=2 → refuse rather than fake it
    assert hist.games["value"].tolist() == [220.0]
    incomplete = [f for f in hist.flags if f.code == "INCOMPLETE_STAT"]
    assert len(incomplete) == 1
    assert "excluded" in incomplete[0].message


def test_incomplete_count_stat_reads_zero():
    """Count stats legitimately read missing columns as zero (a player never
    accumulates TDs in a category they don't line up in)."""
    rows = [{**qb_row(w, 200 + w), "passing_tds": None} for w in (1, 2)]
    frame = _weekly(rows)
    hist = fetch_player_history(QB_ID, "tds", seasons=[2025], min_games=2,
                                fetcher=lambda s: frame)
    assert hist.ok
    assert hist.games["value"].tolist() == [0.0, 0.0]
    assert not any(f.code == "INCOMPLETE_STAT" for f in hist.flags)


def test_missing_gameday_does_not_crash():
    rows = [qb_row(w, 200 + w, gameday=None) for w in range(1, 6)]
    hist = fetch(rows)
    assert hist.ok
    assert hist.n_games == 5


# ---- as-of plumbing (walk-forward safety) + absence honesty ----

def test_as_of_excludes_later_games():
    """``as_of`` is the inclusive last usable gameday: games after it are
    excluded so a projection can't see the future. (Strictly-before-the-event
    semantics are composed at the CLI layer by passing event_date - 1 day.)"""
    rows = [
        qb_row(1, 210, gameday="2025-09-08"),
        qb_row(2, 220, gameday="2025-09-14"),
        qb_row(3, 230, gameday="2025-09-15"),   # Monday game after the cutoff
        qb_row(4, 240, gameday="2025-09-21"),
    ]
    hist = fetch(rows, as_of="2025-09-14")
    assert hist.games["week"].tolist() == [1, 2]

    hist_mon = fetch(rows, as_of="2025-09-15")
    assert hist_mon.games["week"].tolist() == [1, 2, 3]

    hist_all = fetch(rows)
    assert hist_all.games["week"].tolist() == [1, 2, 3, 4]


def test_as_of_measures_staleness_against_projection_date():
    """Walk-forward runs would read every historical game as stale if staleness
    were measured against today; it must use the as-of date instead."""
    rows = [qb_row(1, 220, gameday="2025-10-01"), qb_row(2, 180, gameday="2025-10-08")]
    fresh = fetch(rows, as_of="2025-10-12")
    assert not any(f.code == "STALE" for f in fresh.flags)

    stale = fetch(rows, as_of="2026-01-01")
    stale_flags = [f for f in stale.flags if f.code == "STALE"]
    assert stale_flags and stale_flags[0].severity == "warn"


def test_calendar_gap_flagged_when_window_stretches():
    """8 games spanning far more than 8 weeks means invisible absences (production
    frames carry no DNP rows); the span itself is the cheap honest proxy."""
    # 4 games, each 21 days apart: 63-day span vs a 21-day straight schedule.
    rows = [
        qb_row(1, 200, gameday="2025-09-08"),
        qb_row(2, 210, gameday="2025-09-29"),
        qb_row(3, 220, gameday="2025-10-20"),
        qb_row(4, 230, gameday="2025-11-10"),
    ]
    hist = fetch(rows, min_games=4)
    gap = [f for f in hist.flags if f.code == "CALENDAR_GAP"]
    assert gap and gap[0].severity == "info"
    assert "64" in gap[0].message or "63" in gap[0].message

    # Consecutive weekly games produce no flag.
    tight = fetch([qb_row(w, 200) for w in range(1, 7)])
    assert not any(f.code == "CALENDAR_GAP" for f in tight.flags)


def test_data_vintage_reads_newest_gameday():
    from propmodel.data_pipeline import data_vintage

    rows = [qb_row(1, 200), qb_row(2, 210, gameday="2025-09-24")]
    frame = _weekly(rows)
    assert data_vintage(frame).isoformat() == "2025-09-24"
    assert data_vintage(pd.DataFrame(columns=["season", "week"])) is None


# ---- schema validation (garbage data must fail loudly, not read as "no data") ----

def test_validate_weekly_passes_valid_frame():
    df = _weekly([qb_row(1, 200)])
    assert validate_weekly(df, source="test") is df


def test_validate_weekly_names_missing_columns():
    # stats_player-style file without season/week: normalize keeps team alias,
    # validation must name exactly what's still missing.
    df = pd.DataFrame([{"player_id": "00-1", "player_name": "A", "team": "HOU"}])
    with pytest.raises(ValueError) as ei:
        validate_weekly(df, source="stats_player.csv")
    msg = str(ei.value)
    for expected in ("season", "week", "stats_player.csv"):
        assert expected in msg


def test_validate_weekly_rejects_empty_frame():
    with pytest.raises(ValueError, match="empty"):
        validate_weekly(pd.DataFrame(), source="weekly.csv")


def test_weekly_is_usable_false_for_garbage_or_empty():
    assert not weekly_is_usable(None)
    assert not weekly_is_usable(pd.DataFrame())
    assert not weekly_is_usable(pd.DataFrame({"legacy": [1]}))
    assert weekly_is_usable(_weekly([qb_row(1, 200)]))


def test_normalize_then_validate_accepts_stats_player_schema():
    df = pd.DataFrame([
        {"player_id": "00-1", "player_name": "A", "team": "HOU",
         "season": 2025, "week": 3, "passing_yards": 250.0},
    ])
    out = validate_weekly(normalize_weekly(df), source="stats_player.csv")
    assert "recent_team" in out.columns and "gameday" in out.columns


def test_live_fetch_names_missing_requests_dependency(monkeypatch):
    """On Python >= 3.13 nfl_data_py can't install; when its fallback dep
    ``requests`` is missing too, the error must name the fix — not a bare
    ModuleNotFoundError."""
    import sys

    import propmodel.data_pipeline as tdp

    monkeypatch.setitem(sys.modules, "nfl_data_py", None)
    monkeypatch.setitem(sys.modules, "requests", None)
    with pytest.raises(RuntimeError, match="requests"):
        tdp._fetch_weekly_nflverse([2025])
