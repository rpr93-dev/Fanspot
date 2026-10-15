"""Pregame role / workload-awareness tests (repair item 1).

Covers the acceptance criteria: role changes are handled from *pregame*
information only, a returning starter's workload is not reduced by the missed
games, a backup promoted to starter is projected at starter volume, missing or
contradictory role information is surfaced (never silently guessed), and a
sportsbook disagreement is a diagnostic that never moves the projection.
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from propmodel.data_pipeline import fetch_player_history
from propmodel.model import ModelWeights, project
from propmodel.role import (
    RoleEntry,
    STATUS_ACTIVE,
    STATUS_OUT,
    expected_opportunities,
    load_depth_chart,
    parse_depth_chart,
    resolve_role,
    starter_volume_prior,
)

QB_ID = "00-000042"

_FRAME_COLS = [
    "player_id", "player_name", "position", "recent_team", "opponent_team",
    "season", "week", "gameday", "game_id", "games",
    "passing_yards", "passing_tds", "attempts", "completions", "passing_interceptions",
    "rushing_yards", "rushing_tds", "carries",
    "receiving_yards", "receptions", "receiving_tds", "targets",
]


def _row(week: int, season: int = 2025, **vals) -> dict:
    base = {
        "player_id": QB_ID, "player_name": "Test QB", "position": "QB",
        "recent_team": "HOU", "opponent_team": "TEN",
        "season": season, "week": week,
        "gameday": (date(2025, 9, 8) + timedelta(days=7 * (week - 1))).isoformat(),
        "game_id": f"{season}_{week:02d}_HOU_TEN", "games": 1,
    }
    base.update(vals)
    return base


def _frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=_FRAME_COLS)


def _history(attempts, yds, misses=()):
    rows = []
    for i, (a, y) in enumerate(zip(attempts, yds)):
        rows.append(_row(i + 1, attempts=a, passing_yards=y))
    # A missed week is simply absent from a production frame; the calendar gap
    # is what exposes it.
    frame = _frame(rows)
    return fetch_player_history(QB_ID, "passing_yards", seasons=[2025], fetcher=lambda s: frame)


RELIEF_ATTEMPTS = [3, 5, 2, 8, 4, 6, 3, 5]
RELIEF_YDS = [20, 30, 15, 40, 25, 35, 20, 30]


# ── timestamped depth chart ────────────────────────────────────────────────

def test_parse_depth_chart_drops_future_rows():
    raw = [
        {"player": "Test QB", "team": "HOU", "role": "named_starter",
         "effective": "2026-10-12", "source": "team-site"},
        {"player": "Test QB", "team": "HOU", "role": "backup",
         "effective": "2026-10-16", "source": "postgame"},
    ]
    kept = parse_depth_chart(raw, as_of="2026-10-14")
    assert len(kept) == 1
    assert kept[0].role == "named_starter"
    # Without a cutoff both survive and the later row wins resolution.
    info = resolve_role(parse_depth_chart(raw), "Test QB", "HOU", "QB")
    assert info.role == "backup"


def test_load_depth_chart_csv(tmp_path):
    p = tmp_path / "depth.csv"
    p.write_text(
        "player,team,position,role,status,effective,source\n"
        "Test QB,HOU,QB,named_starter,active,2026-10-10,beat-writer\n",
        encoding="utf-8",
    )
    entries = load_depth_chart(p, as_of="2026-10-14")
    assert entries and entries[0].role == "named_starter"


# ── role resolution ────────────────────────────────────────────────────────

def test_batch_hint_beats_chart_and_conflict_is_flagged():
    entries = [RoleEntry(player="Test QB", team="HOU", position="QB",
                         role="backup", effective="2026-10-10")]
    info = resolve_role(entries, "Test QB", "HOU", "QB",
                        batch_role="named_starter", batch_status="active")
    assert info.role == "named_starter"
    assert info.uncertain and any("role_conflict" in n for n in info.notes)


def test_missing_role_is_flagged_not_guessed():
    info = resolve_role([], "Test QB", "HOU", "QB")
    assert info.role == "unknown"
    assert any("role_unknown" in n for n in info.notes)


def test_returning_flag_from_missed_games():
    info = resolve_role([], "Test QB", "HOU", "QB", missed_games=2)
    assert info.returning and any("returning_from_absence" in n for n in info.notes)


# ── expected opportunities ─────────────────────────────────────────────────

def test_backup_to_starter_uses_starter_volume():
    hist = _history(RELIEF_ATTEMPTS, RELIEF_YDS)
    info = resolve_role([], "Test QB", "HOU", "QB", batch_role="named_starter")
    exp = expected_opportunities(hist, info, "passing_yards", starter_prior=34.0)
    assert exp.source == "role_starter_prior"
    assert exp.value == pytest.approx(34.0)
    assert exp.note and "backup_to_starter" in exp.note


def test_returning_starter_keeps_own_volume_not_reduced():
    hist = _history([34] * 8, [250] * 8)
    info = resolve_role([], "Test QB", "HOU", "QB",
                        batch_role="named_starter", missed_games=1)
    exp = expected_opportunities(hist, info, "passing_yards", starter_prior=34.0)
    assert exp.source == "role_starter"
    assert exp.value == pytest.approx(34.0)
    assert exp.returning


def test_unknown_role_marks_uncertain():
    hist = _history(RELIEF_ATTEMPTS, RELIEF_YDS)
    exp = expected_opportunities(hist, resolve_role([], "Test QB", "HOU", "QB"), "passing_yards")
    assert exp.uncertain


def test_starter_volume_prior_reads_frame():
    rows = [_row(w, attempts=30 + w, passing_yards=250) for w in range(1, 9)]
    prior, n = starter_volume_prior(_frame(rows), "passing_yards")
    assert prior is not None and prior >= 15
    assert n >= 3


# ── model integration ──────────────────────────────────────────────────────

def test_project_uses_starter_volume_for_promoted_backup():
    hist = _history(RELIEF_ATTEMPTS, RELIEF_YDS)
    info = resolve_role([], "Test QB", "HOU", "QB", batch_role="named_starter")
    base = project(hist, {"factor": 1.0}, {"factor": 1.0})
    promoted = project(hist, {"factor": 1.0}, {"factor": 1.0},
                       role_info=info, starter_volume_prior=34.0)
    # Opportunity-first: starter volume lifts the projection materially.
    assert promoted.projection > base.projection
    assert promoted.expected_volume_source == "role_starter_prior"
    assert any("backup_to_starter" in w for w in promoted.warnings)


def test_project_abstains_when_out():
    hist = _history([34] * 8, [250] * 8)
    info = resolve_role([], "Test QB", "HOU", "QB", batch_status="out")
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, role_info=info)
    assert proj.projection is None
    assert proj.refused_reason and proj.refused_reason.startswith("AVAILABILITY_OUT")


def test_project_widens_and_caps_on_role_conflict():
    hist = _history([34] * 8, [250] * 8)
    entries = [RoleEntry(player="Test QB", team="HOU", position="QB",
                         role="backup", effective="2026-10-10")]
    info = resolve_role(entries, "Test QB", "HOU", "QB",
                        batch_role="named_starter", batch_status="active")
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, role_info=info)
    assert proj.confidence in ("low", "medium")
    assert any("role_uncertain" in w for w in proj.warnings)


def test_market_disagreement_is_diagnostic_not_a_target():
    hist = _history([34] * 8, [250] * 8)
    line = 150.0  # far below the model's ~250
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, market_line=line)
    without_line = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert proj.projection == pytest.approx(without_line.projection)
    assert any("market_disagreement" in w for w in proj.warnings)
