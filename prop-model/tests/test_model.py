"""STAGE 4 tests — weighted projection + confidence range (synthetic data)."""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pytest

from propmodel.data_pipeline import fetch_player_history
from propmodel.model import (
    ModelWeights,
    effective_sample_size,
    project,
    recency_weights,
)

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


def test_missing_lines_do_not_lower_confidence():
    """Line absence is a normal posture (offseason / keyless runs), not lower
    model certainty: it must be reported as a note, never gate the tiers."""
    hist = _history([200.0] * 10)
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": False})
    assert proj.confidence == "high"
    assert proj.note and "no Vegas lines" in proj.note

    # With lines present, no such note.
    with_lines = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.1, "available": True})
    assert not (with_lines.note and "Vegas" in with_lines.note)


def test_position_mismatch_refuses():
    """A CB with recorded (zero) receiving rows is an impossible request:
    refuse it loudly instead of projecting a confident 0.0."""
    from tests.test_data_pipeline import _weekly
    rows = []
    for w in range(1, 9):
        r = {
            "player_id": "00-000777", "player_name": "Test CB", "position": "CB",
            "recent_team": "HOU", "opponent_team": "TEN",
            "season": 2025, "week": w, "gameday": f"2025-09-{10 + w:02d}",
            "game_id": f"2025_{w:02d}_HOU_TEN", "games": 1,
            "passing_yards": None, "passing_tds": None,
            "rushing_yards": None, "rushing_tds": None,
            "receiving_yards": 0.0, "receptions": 0.0, "receiving_tds": None,
        }
        rows.append(r)
    hist = fetch_player_history("00-000777", "receiving_yards", seasons=[2025],
                                fetcher=lambda s: _weekly(rows))
    assert hist.ok  # the data itself looks fine — zeros are recorded plays
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert proj.projection is None
    assert proj.refused_reason and "POSITION_MISMATCH" in proj.refused_reason
    assert "CB" in proj.refused_reason


def test_absence_notes_surface_in_note_column():
    """Missed weeks inside the window and calendar gaps are absence-honesty
    signals; they belong where users can see them."""
    from datetime import date, timedelta

    from tests.test_data_pipeline import _weekly  # reuse the frame builder

    start = date(2025, 9, 8)

    def row(week: int, idx: int, played: bool):
        return {
            "player_id": QB_ID, "player_name": "Test QB", "position": "QB",
            "recent_team": "HOU", "opponent_team": "TEN",
            "season": 2025, "week": week,
            "gameday": (start + timedelta(days=7 * idx)).isoformat(),
            "game_id": f"2025_{week:02d}_HOU_TEN",
            "games": 1 if played else 0,
            "passing_yards": 200.0 if played else None,
            "passing_tds": 1 if played else None,
            "rushing_yards": None, "rushing_tds": None,
            "receiving_yards": None, "receptions": None, "receiving_tds": None,
        }

    # Week 3 is a roster week without a game (injury/scratch): the window
    # covers weeks 1-5 but only 4 were played.
    rows = [row(1, 0, True), row(2, 1, True), row(3, 2, False), row(4, 3, True), row(5, 4, True)]
    hist = fetch_player_history(QB_ID, "tds", seasons=[2025], min_games=4,
                                fetcher=lambda s: _weekly(rows))
    assert any(f.code == "MISSED_GAMES" for f in hist.flags)
    assert any(f.code == "CALENDAR_GAP" for f in hist.flags)
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert proj.note
    assert "missed week" in proj.note
    assert "gap days" in proj.note


def test_refuses_insufficient_history():
    hist = _history([200.0, 210.0])
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.projection is None
    assert proj.confidence == "low"
    assert proj.refused_reason is not None


def test_count_stat_uses_poisson_std():
    """TDs are small counts — the interval core is Poisson √mean, inflated by
    the baseline estimation factor sqrt(1 + 1/ESS), scaled by the count
    calibration multiplier, with the low end clamped at zero."""
    hist = _history([1.0, 2.0, 1.0, 2.0], stat="tds")
    w = ModelWeights()
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    ess = effective_sample_size(recency_weights(hist.n_games, w.halflife))
    pred_sd = math.sqrt(proj.baseline) * math.sqrt(1.0 + 1.0 / ess) * w.sd_mult_count
    expected_low = max(0.0, proj.projection - pred_sd)
    assert proj.low == pytest.approx(expected_low, abs=0.01)
    assert proj.high == pytest.approx(proj.projection + pred_sd, abs=0.01)


def test_thin_history_shrinks_toward_position_prior():
    """A short sample leans toward the position prior instead of trusting a
    tiny raw mean; prior_strength=0 recovers the unshrunk behavior."""
    hist = _history([300.0, 290.0, 310.0])
    x = np.asarray([300.0, 290.0, 310.0])
    raw_mean = float(np.average(x, weights=recency_weights(len(x), halflife=4.0)))
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0},
                   position_prior=200.0, weights=ModelWeights(prior_strength=3.0))
    assert proj.baseline < raw_mean          # pulled toward the prior
    assert proj.baseline > 200.0             # but not all the way
    no_shrink = project(hist, {"factor": 1.0}, {"factor": 1.0},
                        position_prior=200.0, weights=ModelWeights(prior_strength=0.0))
    assert no_shrink.baseline == pytest.approx(raw_mean)


def test_prior_pull_weakens_as_history_grows():
    """The same values over a longer window are pulled less toward the prior —
    shrinkage must fade out as real evidence accumulates."""
    thin = _history([300.0, 290.0, 310.0])
    full = _history([300.0] * 8)
    raw_thin = float(np.average(np.asarray([300.0, 290.0, 310.0]),
                                weights=recency_weights(3, halflife=4.0)))
    raw_full = float(np.average(np.asarray([300.0] * 8),
                                weights=recency_weights(8, halflife=4.0)))
    p_thin = project(thin, {"factor": 1.0}, {"factor": 1.0}, position_prior=200.0)
    p_full = project(full, {"factor": 1.0}, {"factor": 1.0}, position_prior=200.0)
    pull_thin = raw_thin - p_thin.baseline
    pull_full = raw_full - p_full.baseline
    assert pull_thin > pull_full > 0


def test_short_windows_get_wider_intervals():
    """Same per-game spread, fewer games → wider range: the interval must
    reflect that the baseline itself is estimated less precisely."""
    long_hist = _history([170.0, 230.0] * 4)   # 8 games alternating ±30
    short_hist = _history([230.0, 170.0, 230.0])  # 3 games, same spread
    p_long = project(long_hist, {"factor": 1.0}, {"factor": 1.0})
    p_short = project(short_hist, {"factor": 1.0}, {"factor": 1.0})
    rel_long = (p_long.high - p_long.low) / p_long.projection
    rel_short = (p_short.high - p_short.low) / p_short.projection
    assert rel_short > rel_long


def test_low_clamped_at_zero():
    hist = _history([5.0, 6.0, 7.0])
    proj = project(hist, {"factor": 0.6, "low_sample": False}, {"factor": 0.6, "available": True})
    assert proj.low is not None and proj.low >= 0.0


def test_float_factors_accepted():
    hist = _history([200.0] * 10)
    proj = project(hist, 1.2, 1.1)
    assert proj.projection == pytest.approx(200.0 * 1.2 * 1.1)
