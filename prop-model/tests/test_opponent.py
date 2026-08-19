"""STAGE 2 tests — synthetic nflverse weekly frames, no network."""

from __future__ import annotations

import pandas as pd
import pytest

from propmodel.opponent import defense_allowed, opponent_factor


def player_row(player_id: str, name: str, pos: str, team: str, opp: str, week: int,
               season: int = 2025, gameday: str | None = None, **stats) -> dict:
    row = {
        "player_id": player_id, "player_name": name, "position": pos,
        "recent_team": team, "opponent_team": opp,
        "season": season, "week": week,
        "gameday": gameday or f"2025-09-{10 + week:02d}",
        "game_id": f"{season}_{week:02d}_{team}_{opp}",
        "games": 1,
        "passing_yards": None, "passing_tds": None,
        "rushing_yards": None, "rushing_tds": None,
        "receiving_yards": None, "receptions": None, "receiving_tds": None,
    }
    row.update(stats)
    return row


def wr(team: str, opp: str, week: int, rec_yds: float, rec: int = 5, **kw) -> dict:
    return player_row(f"00-{team}{week}1", f"{team} WR", "WR", team, opp, week,
                      receiving_yards=rec_yds, receptions=rec, **kw)


def _frame(rows: list[dict]) -> pd.DataFrame:
    cols = [
        "player_id", "player_name", "position", "recent_team", "opponent_team",
        "season", "week", "gameday", "game_id", "games",
        "passing_yards", "passing_tds",
        "rushing_yards", "rushing_tds",
        "receiving_yards", "receptions", "receiving_tds",
    ]
    return pd.DataFrame(rows, columns=cols)


def test_ratio_normalized_against_league_average():
    """HOU allows 150 rec-yds/game, LV allows 100, league avg 125 → 1.2 and 0.8."""
    rows = [
        wr("A", "HOU", 1, 140), wr("C", "HOU", 2, 160),   # HOU avg 150
        wr("B", "LV", 1, 90), wr("D", "LV", 2, 110),      # LV avg 100
    ]
    # Each defense has only 2 games here, so relax min_games to exercise the ratio.
    rates = defense_allowed("receiving_yards", seasons=[2025], min_games=2, fetcher=lambda s: _frame(rows))
    hou = rates[rates["team"] == "HOU"].iloc[0]
    lv = rates[rates["team"] == "LV"].iloc[0]
    assert hou["allowed_per_game"] == pytest.approx(150)
    assert lv["allowed_per_game"] == pytest.approx(100)
    assert hou["league_avg"] == pytest.approx(125)
    assert hou["ratio"] == pytest.approx(1.2)
    assert lv["ratio"] == pytest.approx(0.8)


def test_low_sample_gets_neutral_ratio():
    rows = [wr("A", "HOU", 1, 140)]  # only 1 game vs HOU
    rates = defense_allowed("receiving_yards", seasons=[2025], min_games=3, fetcher=lambda s: _frame(rows))
    hou = rates[rates["team"] == "HOU"].iloc[0]
    assert hou["low_sample"]
    assert hou["ratio"] == 1.0


def test_position_filter_excludes_other_position_stats():
    """A QB's rushing yards must not count toward receiving yards allowed."""
    rows = [
        wr("A", "HOU", 1, 120),
        player_row("00-Q1", "A QB", "QB", "A", "HOU", 1, rushing_yards=99),
    ]
    rates = defense_allowed("receiving_yards", seasons=[2025], fetcher=lambda s: _frame(rows))
    hou = rates[rates["team"] == "HOU"].iloc[0]
    assert hou["allowed_per_game"] == pytest.approx(120)
    # But rushing yards allowed DOES pick up the QB's rushing:
    rush_rates = defense_allowed("rushing_yards", seasons=[2025], fetcher=lambda s: _frame(rows))
    hou_rush = rush_rates[rush_rates["team"] == "HOU"].iloc[0]
    assert hou_rush["allowed_per_game"] == pytest.approx(99)


def test_window_uses_only_last_n_team_games():
    rows = [wr("A", "HOU", w, 300 if w <= 2 else 100) for w in range(1, 7)]
    rates = defense_allowed("receiving_yards", seasons=[2025], window=4, fetcher=lambda s: _frame(rows))
    hou = rates[rates["team"] == "HOU"].iloc[0]
    assert hou["games"] == 4
    assert hou["allowed_per_game"] == pytest.approx(100)


def test_as_of_filters_future_games():
    rows = [
        wr("A", "HOU", 1, 100, gameday="2025-09-11"),
        wr("B", "HOU", 2, 200, gameday="2025-09-18"),
    ]
    rates = defense_allowed(
        "receiving_yards", seasons=[2025], as_of="2025-09-15",
        fetcher=lambda s: _frame(rows),
    )
    hou = rates[rates["team"] == "HOU"].iloc[0]
    assert hou["games"] == 1
    assert hou["allowed_per_game"] == pytest.approx(100)


def test_opponent_factor_missing_team_is_neutral():
    rates = defense_allowed("receiving_yards", seasons=[2025], fetcher=lambda s: _frame([]))
    f = opponent_factor("XXX", rates)
    assert f["factor"] == 1.0
    assert f["low_sample"] is True


def test_td_allowed_sums_td_columns():
    """A defense's TD-allowed = opposing QBs' passing TDs + RBs' rushing TDs etc."""
    rows = [
        player_row("00-Q1", "A QB", "QB", "A", "HOU", 1, passing_tds=2, rushing_tds=1),
        player_row("00-R1", "A RB", "RB", "A", "HOU", 1, rushing_tds=1, receiving_tds=1),
    ]
    rates = defense_allowed("tds", seasons=[2025], fetcher=lambda s: _frame(rows))
    hou = rates[rates["team"] == "HOU"].iloc[0]
    assert hou["allowed_per_game"] == pytest.approx(5)  # 2 pass + 1 rush (QB) + 1 rush + 1 rec (RB)


def test_teams_filter_restricts_output():
    rows = [wr("A", "HOU", 1, 120), wr("B", "LV", 1, 80)]
    rates = defense_allowed("receiving_yards", seasons=[2025], teams=["LV"], fetcher=lambda s: _frame(rows))
    assert rates["team"].tolist() == ["LV"]
