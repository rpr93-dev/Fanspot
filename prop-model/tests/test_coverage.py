"""Coverage-gap tests (repair item 3).

- verified stable-ID aliases for book spellings (Cameron/Cam Skattebo,
  Chigoziem/Chig Okonkwo) without loosening namesake protection;
- explicit UNSUPPORTED_MARKET refusal vs a supported cross-position market;
- rookie/thin-history prior path is wired and tagged for separate reporting.
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from propmodel.data_pipeline import fetch_player_history
from propmodel.model import ModelWeights, position_guard_reason, project
from propmodel.players import KNOWN_PLAYER_ALIASES, resolve_player_id
from propmodel.stats import get_stat


def _weekly(rows):
    return pd.DataFrame(rows, columns=[
        "player_id", "player_name", "player_display_name", "position",
        "recent_team", "opponent_team", "season", "week", "gameday",
        "game_id", "games", "rushing_yards", "carries",
    ])


def _rows(pid, name, pos, team, n=8, carries=6, rush=30):
    base = date(2025, 9, 8)
    return [
        {
            "player_id": pid, "player_name": name, "player_display_name": name,
            "position": pos, "recent_team": team, "opponent_team": "TEN",
            "season": 2025, "week": w,
            "gameday": (base + timedelta(days=7 * (w - 1))).isoformat(),
            "game_id": f"2025_{w:02d}_{team}_TEN", "games": 1,
            "rushing_yards": rush, "carries": carries,
        }
        for w in range(1, n + 1)
    ]


# ── verified stable-ID aliases ─────────────────────────────────────────────

def test_alias_table_pins_verified_ids():
    assert KNOWN_PLAYER_ALIASES["cameron skattebo"] == "00-0040715"
    assert KNOWN_PLAYER_ALIASES["chigoziem okonkwo"] == "00-0037809"


def test_cameron_skattebo_book_spelling_resolves_to_feed_id():
    weekly = _weekly(_rows("00-0040715", "Cam Skattebo", "RB", "NYG"))
    # Book spelling differs from the feed's "Cam"; the alias pins the id.
    assert resolve_player_id(weekly, "Cameron Skattebo", "NYG", positions=("RB",)) == "00-0040715"


def test_chigoziem_okonkwo_book_spelling_resolves():
    weekly = _weekly(_rows("00-0037809", "Chig Okonkwo", "TE", "TEN", carries=0, rush=0))
    assert resolve_player_id(weekly, "Chigoziem Okonkwo", "TEN") == "00-0037809"
    # Team still pins the resolution — a wrong team hint must not silently
    # borrow another team's player.
    other = _weekly(_rows("00-0037809", "Chig Okonkwo", "TE", "TEN", carries=0, rush=0))
    assert resolve_player_id(other, "Chigoziem Okonkwo", "TEN") == "00-0037809"


def test_alias_pins_the_verified_id_not_a_last_name_sake():
    # A *different* player with the same last name must not steal the alias.
    weekly = _weekly(
        _rows("00-0037809", "Chig Okonkwo", "TE", "TEN", carries=0, rush=0)
        + _rows("00-999999", "Josh Okonkwo", "RB", "TEN")
    )
    assert resolve_player_id(weekly, "Chigoziem Okonkwo", "TEN") == "00-0037809"


def test_ambiguous_namesakes_still_refused():
    weekly = _weekly(
        _rows("00-000001", "Chris Jones", "TE", "KC", carries=0, rush=0)
        + _rows("00-000002", "Cameron Jones", "TE", "DAL", carries=0, rush=0)
    )
    assert resolve_player_id(weekly, "C. Jones") is None
    assert resolve_player_id(weekly, "C. Jones", "DAL") == "00-000002"


# ── position / market support ──────────────────────────────────────────────

def test_wr_rushing_refused_explicitly_without_usage():
    weekly = _weekly(_rows("00-000077", "Test WR", "WR", "HOU", carries=0, rush=0))
    hist = fetch_player_history("00-000077", "rushing_yards", seasons=[2025], fetcher=lambda s: weekly)
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert proj.projection is None
    assert proj.refused_reason and "UNSUPPORTED_MARKET" in proj.refused_reason


def test_wr_rushing_supported_when_model_can_evaluate():
    weekly = _weekly(_rows("00-000077", "Test WR", "WR", "HOU", carries=2, rush=14))
    hist = fetch_player_history("00-000077", "rushing_yards", seasons=[2025], fetcher=lambda s: weekly)
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert proj.refused_reason is None
    assert proj.projection is not None and proj.projection > 0


def test_position_guard_helper_messages():
    rush = get_stat("rushing_yards")
    assert position_guard_reason("WR", rush) is not None
    assert "UNSUPPORTED_MARKET" in position_guard_reason("WR", rush)
    assert position_guard_reason("RB", rush) is None


# ── rookie / thin-history prior is wired and tagged ────────────────────────

def test_prior_projection_tags_prior_source():
    from propmodel.cli import _prior_projection

    proj = _prior_projection("Rookie QB", "passing_yards", 210.0, None,
                             {"factor": 1.0}, {"factor": 1.0}, ModelWeights())
    assert proj.projection is not None
    assert proj.confidence == "low"
    assert proj.inputs.get("prior_source") == "ESPN prior"
