"""STAGE 4 tests — weighted projection + confidence range (synthetic data)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from propmodel.data_pipeline import fetch_player_history
from propmodel.model import ModelWeights, project, recency_weighted_stats

QB_ID = "00-000042"


def _qb_rows(values: list[float], season: int = 2025, start: date | None = None) -> list[dict]:
    """One played QB game per value, dated weekly ending ~recently (not stale)."""
    start = start or date.today() - timedelta(days=7 * len(values))
    rows = []
    for i, v in enumerate(values):
        gameday = start + timedelta(days=7 * i)
        rows.append({
            "player_id": QB_ID, "player_name": "Test QB", "position": "QB",
            "recent_team": "HOU", "opponent_team": "TEN",
            "season": season, "week": i + 1, "gameday": gameday.isoformat(),
            "game_id": f"{season}_{i + 1:02d}_HOU_TEN", "games": 1,
            "passing_yards": v, "passing_tds": 1 if v > 0 else 0,
            "rushing_yards": None, "rushing_tds": None,
            "receiving_yards": None, "receptions": None, "receiving_tds": None,
        })
    return rows


def _history(values: list[float], stat: str = "passing_yards", **kw):
    from tests.test_data_pipeline import _weekly  # reuse the frame builder
    frame = _weekly(_qb_rows(values))
    return fetch_player_history(QB_ID, stat, seasons=[2025], fetcher=lambda s: frame, **kw)


def test_recency_weighting_prefers_recent_games():
    hist = _history([100.0, 100.0, 200.0])
    mean, _ = recency_weighted_stats([100.0, 100.0, 200.0], halflife=4.0)
    # Simple average would be 133.3; recency-weighted must be higher.
    assert mean > 133.3
    # And with a strong halflife, very recent games dominate.
    mean2, _ = recency_weighted_stats([100.0, 200.0], halflife=1.0)
    assert mean2 > 150.0


def test_projection_multiplies_factors():
    hist = _history([200.0] * 10)
    proj = project(hist, {"factor": 1.2, "low_sample": False}, {"factor": 1.1, "available": True})
    assert proj.projection == pytest.approx(200.0 * 1.2 * 1.1)


def test_weights_soften_adjustments():
    hist = _history([200.0] * 10)
    w = ModelWeights(opponent=0.0, game_script=0.0)
    proj = project(hist, {"factor": 1.2, "low_sample": False}, {"factor": 1.1, "available": True}, weights=w)
    assert proj.projection == pytest.approx(200.0)


def test_confidence_tiers():
    hist_high = _history([200.0] * 10)
    assert project(hist_high, {"factor": 1.1, "low_sample": False}, {"factor": 1.0, "available": True}).confidence == "high"

    hist_med = _history([200.0] * 6)
    assert project(hist_med, {"factor": 1.1, "low_sample": False}, {"factor": 1.0, "available": True}).confidence == "medium"

    # Unreliable opponent factor caps at low.
    assert project(hist_high, {"factor": 1.1, "low_sample": True}, {"factor": 1.0, "available": True}).confidence == "low"


def test_refuses_insufficient_history():
    hist = _history([200.0, 210.0])
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.projection is None
    assert proj.confidence == "low"
    assert proj.refused_reason is not None


def test_count_stat_uses_poisson_std():
    """TDs are small counts — the interval width should be ~2·√mean, not sample std."""
    hist = _history([1.0, 2.0, 1.0, 2.0], stat="tds")
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    mean = proj.baseline
    assert proj.low is not None and proj.high is not None
    width = proj.high - proj.low
    assert width == pytest.approx(2.0 * (mean ** 0.5), rel=0.05)


def test_low_clamped_at_zero():
    hist = _history([5.0, 6.0, 7.0])
    proj = project(hist, {"factor": 0.6, "low_sample": False}, {"factor": 0.6, "available": True})
    assert proj.low is not None and proj.low >= 0.0


def test_float_factors_accepted():
    hist = _history([200.0] * 10)
    proj = project(hist, 1.2, 1.1)
    assert proj.projection == pytest.approx(200.0 * 1.2 * 1.1)
