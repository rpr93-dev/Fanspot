"""STAGE 3 tests — game-script (Vegas pace/volume) adjustment."""

from __future__ import annotations

import pytest

from propmodel.game_script import (
    GameLines,
    StaticLineProvider,
    script_adjustment,
    script_factor_for_team,
)


def test_favorite_gets_boost_underdog_cut():
    # Total 47.5, HOU favored by 6.5 → HOU implied (47.5+6.5)/2 = 27 → ~1.23
    # LV implied (47.5-6.5)/2 = 20.5 → ~0.93
    lines = GameLines(total=47.5, spread=6.5, favorite="HOU")
    assert script_factor_for_team(lines, "HOU") == pytest.approx(27.0 / 22.0)
    assert script_factor_for_team(lines, "LV") == pytest.approx(20.5 / 22.0)
    assert script_factor_for_team(lines, "HOU") > 1.0
    assert script_factor_for_team(lines, "LV") < 1.0


def test_pickem_splits_total():
    lines = GameLines(total=44.0, spread=0.0, favorite=None)
    assert script_factor_for_team(lines, "HOU") == pytest.approx(1.0)
    assert script_factor_for_team(lines, "LV") == pytest.approx(1.0)


def test_missing_lines_neutral():
    adj = script_adjustment("HOU", "LV", None)
    assert adj["available"] is False
    assert adj["factor"] == 1.0


def test_script_adjustment_shape():
    lines = GameLines(total=40.5, spread=1.5, favorite="HOU")
    adj = script_adjustment("HOU", "LV", lines)
    assert adj["available"] is True
    assert adj["total"] == 40.5
    assert adj["implied_total"] == pytest.approx(21.0)
    assert adj["factor"] == pytest.approx(21.0 / 22.0)


def test_factor_clamped_at_extremes():
    lines = GameLines(total=70.0, spread=20.0, favorite="HOU")  # implied 45 → 2.05
    assert script_factor_for_team(lines, "HOU") == 1.4
    lines2 = GameLines(total=20.0, spread=2.0, favorite="HOU")  # implied 11 → 0.5 → clamp 0.6
    assert script_factor_for_team(lines2, "HOU") == 0.6


def test_static_provider_lookup():
    provider = StaticLineProvider({"HOU": GameLines(40.5, 1.5, "HOU")})
    lines = provider.fetch("HOU", "LV")
    assert lines is not None and lines.total == 40.5
    # Unknown teams → None (caller falls back to neutral).
    assert provider.fetch("SEA", "ARI") is None
