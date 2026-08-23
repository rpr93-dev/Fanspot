"""Team-code alias map tests — fantasy spellings must resolve to nflverse codes."""

from __future__ import annotations

import pandas as pd
import pytest

from propmodel.teams import TEAM_ALIASES, normalize_team_code, team_codes_in_frame


def test_rams_fantasy_code_normalizes_to_nflverse():
    """The dashboard sends LAR; nflverse weekly rows say LA. This mismatch used
    to silently neutralize every Rams matchup factor."""
    assert normalize_team_code("LAR") == "LA"


@pytest.mark.parametrize("fantasy,nflverse", sorted(TEAM_ALIASES.items()))
def test_every_alias_maps(fantasy, nflverse):
    assert normalize_team_code(fantasy) == nflverse


def test_unknown_and_valid_codes_pass_through():
    assert normalize_team_code("HOU") == "HOU"
    assert normalize_team_code("lv") == "LV"   # case-insensitive
    assert normalize_team_code("") == ""
    assert normalize_team_code("ZZZ") == "ZZZ"  # unknown codes unchanged


def test_known_codes_from_frame_win_over_alias_map():
    """If a frame legitimately uses a fantasy-style code, keep matching it."""
    assert normalize_team_code("LAR", known={"LAR", "HOU"}) == "LAR"
    assert normalize_team_code("LAR", known={"LA", "HOU"}) == "LA"
    assert normalize_team_code("JAX", known={"JAC"}) == "JAC"


def test_team_codes_in_frame_reads_all_team_columns():
    df = pd.DataFrame([
        {"recent_team": "HOU", "opponent_team": "LV"},
        {"recent_team": "la", "opponent_team": None},
    ])
    assert team_codes_in_frame(df) == {"HOU", "LV", "LA"}
