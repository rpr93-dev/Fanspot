"""NBA model tests on synthetic box-score frames (no network)."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pandas as pd
import pytest

from propmodel.game_script import GameLines
from propmodel.nba.fetcher import frame_from_rows
from propmodel.nba.model import (
    NBAContext,
    NBAWeights,
    blowout_minutes_factor,
    get_nba_stat,
    nb_prob_over,
    nb_quantiles,
    project_minutes,
    project_nba,
)
from propmodel.nba.runner import project_targets
from propmodel.output import TABLE_COLUMNS, projections_table

START = date(2025, 11, 1)


def _row(gid, d, team, opp, pid, name, pos, minutes, pts, reb, ast, fg3m, starter=True, dnp=False, reason=None, season=2026):
    return dict(
        game_id=gid, season=season, season_type=2, game_date=d.isoformat(), team=team, opponent=opp,
        home=True, player_id=pid, player_name=name, position=pos, starter=starter, dnp=dnp,
        dnp_reason=reason, minutes=0.0 if dnp else minutes,
        pts=None if dnp else pts, reb=None if dnp else reb, oreb=None if dnp else 1.0,
        dreb=None if dnp else reb - 1.0, ast=None if dnp else ast, fg3m=None if dnp else fg3m,
        fg3a=None if dnp else fg3m * 2.5, fga=None if dnp else minutes * 0.5, fta=None if dnp else minutes * 0.15,
        tov=None if dnp else minutes * 0.05, stl=None if dnp else 1.0, blk=None if dnp else 0.5,
    )


def make_frame(n_games: int = 30, step_days: int = 2, star_minutes=None, star_starter=None, star_dnp=None) -> pd.DataFrame:
    """OKC vs a rotation of opponents; each side fields 5 players (enough for
    team possessions). Star 'Test Star' (id 1) scores 0.9 pts/min."""
    rows = []
    opps = ["DEN", "LAL", "BOS"]
    for i in range(n_games):
        d = START + timedelta(days=i * step_days)
        gid = f"g{i}"
        opp = opps[i % 3]
        sm = star_minutes[i] if star_minutes else 34.0
        st = star_starter[i] if star_starter else True
        dnp = bool(star_dnp and star_dnp[i])
        rows.append(_row(gid, d, "OKC", opp, "1", "Test Star", "G", sm, round(sm * 0.9), 5.0, 6.0, 2.0,
                         starter=st, dnp=dnp, reason="COACH'S DECISION" if dnp else None))
        for k in range(2, 6):
            rows.append(_row(gid, d, "OKC", opp, str(k), f"Okc Player{k}", "F", 30.0, 12.0, 6.0, 2.0, 1.0))
        for k in range(10, 15):
            rows.append(_row(gid, d, opp, "OKC", f"{opp}{k}", f"{opp} Player{k}", "F", 34.0, 15.0, 7.0, 3.0, 1.0))
    return frame_from_rows(rows)


def test_minutes_projection_recency_and_role():
    f = make_frame(star_minutes=[20.0] * 20 + [34.0] * 10)
    ctx = NBAContext(f)
    star = ctx.played[ctx.played.player_id == "1"].sort_values("game_date", ascending=False)
    mp = project_minutes(star, star, 2026, NBAWeights())
    # Recency-weighted: much closer to the recent 34 than the 24.7 plain mean.
    assert 30.0 < mp["base"] <= 34.0
    assert mp["role_factor"] == 1.0

    # Bench -> starter promotion in the last 3 games lifts minutes.
    mins = [18.0] * 27 + [33.0] * 3
    starters = [False] * 27 + [True] * 3
    f2 = make_frame(star_minutes=mins, star_starter=starters)
    star2 = NBAContext(f2).played
    star2 = star2[star2.player_id == "1"].sort_values("game_date", ascending=False)
    mp2 = project_minutes(star2, star2, 2026, NBAWeights())
    assert mp2["is_starter"] is True
    assert mp2["role_change"] == "promoted to starter"
    assert mp2["role_factor"] > 1.0
    assert mp2["base"] * mp2["role_factor"] > 27.0


def test_dnps_excluded_from_rate_but_trim_minutes():
    dnp = [False] * 26 + [True, False, True, False]
    f = make_frame(star_dnp=dnp)
    ctx = NBAContext(f)
    rows = ctx.history[ctx.history.player_id == "1"].sort_values("game_date", ascending=False)
    played = rows[~rows.dnp]
    mp = project_minutes(played, rows, 2026, NBAWeights())
    assert mp["base"] == pytest.approx(34.0)  # DNPs not averaged in as zeros
    assert mp["dnp_cd"] == 2
    assert mp["rotation_factor"] == pytest.approx(1 - 0.5 * 0.2)
    p = project_nba(ctx, "1", "Test Star", "points", "OKC", "DEN", event_date=date(2026, 1, 15))
    assert any(w.startswith("rotation_risk") for w in p.warnings)


def test_projection_is_minutes_times_rate():
    f = make_frame()
    ctx = NBAContext(f)
    p = project_nba(ctx, "1", "Test Star", "points", "OKC", "DEN", event_date=date(2026, 1, 15))
    assert p.refused_reason is None
    # ~34 min x ~0.9 pts/min (shrunk slightly toward the 0.4-0.5 league rate).
    assert 25.0 < p.projection < 31.5
    assert p.stat.key == "points"
    assert p.low == p.p10 and p.high == p.p90
    assert p.p10 <= p.p25 <= p.p50 <= p.p75 <= p.p90
    assert p.pred_sd and p.pred_sd > 0


def test_unknown_stat_and_too_few_games():
    with pytest.raises(ValueError):
        get_nba_stat("passing_yards")
    assert get_nba_stat("3pm").key == "threes"
    f = make_frame(n_games=3)
    p = project_nba(NBAContext(f), "1", "Test Star", "points", "OKC", "DEN")
    assert p.projection is None and "only 3" in p.refused_reason


def test_distribution_quantiles_monotonic():
    for mean in (0.4, 1.8, 6.5, 12.0, 28.0, 45.0):
        for phi in (1.0, 1.3, 2.5, 5.0):
            qs = nb_quantiles(mean, phi)
            assert qs == sorted(qs), (mean, phi, qs)
            assert qs[0] >= 0
            assert abs(qs[2] - mean) <= max(2.0, 0.15 * mean)
    # Overdispersion widens the band.
    narrow = nb_quantiles(20.0, 1.0)
    wide = nb_quantiles(20.0, 3.0)
    assert (wide[4] - wide[0]) > (narrow[4] - narrow[0])
    # P(over) is a proper tail probability.
    assert nb_prob_over(20.0, 2.0, 19.5) == pytest.approx(0.5, abs=0.1)
    assert nb_prob_over(20.0, 2.0, 0.5) > nb_prob_over(20.0, 2.0, 30.5)


def test_back_to_back_penalty():
    f = make_frame(step_days=2)
    ctx_rest = NBAContext(f, cutoff=date(2025, 12, 28))
    last_game = ctx_rest.team_games[ctx_rest.team_games.team == "OKC"].game_date.max().date()
    # Event the day after OKC's last game -> b2b; two days after -> rested.
    b2b_event = last_game + timedelta(days=1)
    rest_event = last_game + timedelta(days=2)
    ctx_b2b = NBAContext(f, cutoff=b2b_event - timedelta(days=1))
    ctx_rested = NBAContext(f, cutoff=rest_event - timedelta(days=1))
    pb = project_nba(ctx_b2b, "1", "Test Star", "points", "OKC", "DEN", event_date=b2b_event)
    pr = project_nba(ctx_rested, "1", "Test Star", "points", "OKC", "DEN", event_date=rest_event)
    assert any(w.startswith("back_to_back") for w in pb.warnings)
    assert not any(w.startswith("back_to_back") for w in pr.warnings)
    assert pb.projection == pytest.approx(pr.projection * NBAWeights().b2b_starter, rel=0.02)


def test_preseason_scaling():
    f = make_frame()
    ctx = NBAContext(f)
    ev = date(2026, 10, 20)
    reg = project_nba(ctx, "1", "Test Star", "rebounds", "OKC", "DEN", event_date=ev)
    pre = project_nba(ctx, "1", "Test Star", "rebounds", "OKC", "DEN", event_date=ev, preseason=True)
    assert pre.projection == pytest.approx(reg.projection * 0.65, rel=0.01)
    assert any(w.startswith("preseason") for w in pre.warnings)
    assert "preseason-adjusted" in pre.note
    assert pre.confidence != "high"
    # Preseason never flags b2b even if the frame had a game the day before.
    assert not any(w.startswith("back_to_back") for w in pre.warnings)


def test_blowout_trims_starters_only_beyond_threshold():
    w = NBAWeights()
    assert blowout_minutes_factor(None, True, 34, w) == 1.0
    assert blowout_minutes_factor(GameLines(225, 5.0, "OKC"), True, 34, w) == 1.0
    big = GameLines(225, 15.5, "OKC")
    assert blowout_minutes_factor(big, True, 34, w) < 1.0
    assert blowout_minutes_factor(big, False, 15, w) > 1.0
    assert blowout_minutes_factor(GameLines(225, 40.0, "OKC"), True, 34, w) == pytest.approx(1 - w.blowout_cap)


def test_market_total_drives_points_only():
    f = make_frame()
    ctx = NBAContext(f)
    ev = date(2026, 1, 20)
    # Synthetic OKC scores ~79 ppg, so totals near 160 keep the factor unclamped.
    hi = GameLines(170.0, 2.0, "OKC")
    lo = GameLines(150.0, 2.0, "OKC")
    p_hi = project_nba(ctx, "1", "Test Star", "points", "OKC", "DEN", lines=hi, event_date=ev)
    p_lo = project_nba(ctx, "1", "Test Star", "points", "OKC", "DEN", lines=lo, event_date=ev)
    assert p_hi.projection > p_lo.projection
    a_hi = project_nba(ctx, "1", "Test Star", "assists", "OKC", "DEN", lines=hi, event_date=ev)
    a_lo = project_nba(ctx, "1", "Test Star", "assists", "OKC", "DEN", lines=lo, event_date=ev)
    assert a_hi.projection == pytest.approx(a_lo.projection)


def test_output_schema_matches_table_columns():
    f = make_frame()
    targets = [
        {"player": "Test Star", "stat": s, "team": "OKC", "opponent": "DEN", "player_id": None}
        for s in ("points", "rebounds", "assists", "threes")
    ] + [{"player": "Ghost Player", "stat": "points", "team": "OKC", "opponent": "DEN", "player_id": None},
         {"player": "Test Star", "stat": "steals", "team": "OKC", "opponent": "DEN", "player_id": None}]
    projs, ctx = project_targets(f, targets, {}, date(2026, 1, 20), date(2026, 1, 19), False)
    df = projections_table(projs, data_through=ctx.data_through)
    assert list(df.columns) == TABLE_COLUMNS
    assert list(df["stat"])[:4] == ["points", "rebounds", "assists", "threes"]
    assert df["my_projection"].iloc[:4].notna().all()
    assert "not found" in df["refused_reason"].iloc[4]
    assert "Unknown NBA stat" in df["refused_reason"].iloc[5]
    # JSON round-trip like the API route reads it.
    json.loads(df.astype(object).where(pd.notna(df), None).to_json(orient="records"))
