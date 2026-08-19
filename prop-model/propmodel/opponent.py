"""STAGE 2 — Opponent adjustment.

Computes how an upcoming opponent has performed against a stat/position over a
recent window, normalized against the league average over the same period.

Example: for ``receiving_yards``, HOU's defense allowed 160 yds/game to opposing
receivers over their last 5 games while the league allowed 140 → ratio 1.14, i.e.
a receiver facing HOU gets a +14% matchup boost.

Data
----
The same nflverse weekly file as STAGE 1. For every team-week we sum the stat
produced by the *opposing* team's players at the stat's positions — that sum is
the defense's "allowed" number for that week. Only players who can actually
produce the stat are counted (a QB's rushing yards never counts toward
"receiving yards allowed"), enforced by the stat's ``positions``.

Statistical choices
-------------------
- *Window*: the last ``window`` team games (default 5) per defense. A matchup
  read should reflect recent form, not the whole season — and STAGE 4 can align
  it with the player's own history window by passing the same value.
- *Normalization*: ratio = team_allowed_per_game / league_allowed_per_game over
  the same window (per team-*game*, not per-team mean, so teams with byes aren't
  weighted oddly). A ratio of 1.0 = exactly league-average defense.
- *Small-sample protection*: a defense with fewer than ``min_games`` games in
  the window gets a neutral 1.0 ratio + a ``low_sample`` flag instead of a noisy
  estimate. Downstream stages may clamp or shrink the ratio further.
- *No leakage*: ``as_of`` (default: today) filters out team games after the
  projection date, so a game already played this week never leaks in.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Callable, Iterable

import pandas as pd

from .data_pipeline import (
    COL_GAMEDAY,
    COL_OPPONENT,
    COL_POSITION,
    COL_SEASON,
    COL_WEEK,
    _fetch_weekly_nflverse,
    _stat_value,
    default_seasons,
)
from .stats import StatSpec, get_stat

logger = logging.getLogger(__name__)


def _allowed_per_team_week(weekly: pd.DataFrame, stat: StatSpec) -> pd.DataFrame:
    """Sum the stat allowed by each defense per team-week.

    Returns one row per (defense, season, week) with ``allowed`` = total stat
    produced by the opposing players at the stat's positions that week.
    """
    if COL_POSITION in weekly.columns:
        rows = weekly[weekly[COL_POSITION].isin(stat.positions)]
    else:
        rows = weekly

    vals = rows.apply(lambda r: _stat_value(r, stat), axis=1)
    out = rows[[COL_OPPONENT, COL_SEASON, COL_WEEK, COL_GAMEDAY]].copy()
    out["allowed"] = vals.fillna(0.0)
    out = out[out[COL_OPPONENT].notna()]

    tw = (
        out.groupby([COL_OPPONENT, COL_SEASON, COL_WEEK], as_index=False)
        .agg(allowed=("allowed", "sum"), gameday=(COL_GAMEDAY, "max"))
    )
    tw.columns = ["team", COL_SEASON, COL_WEEK, "allowed", COL_GAMEDAY]
    return tw


def defense_allowed(
    stat: str | StatSpec,
    seasons: Iterable[int] | None = None,
    window: int = 5,
    min_games: int = 3,
    as_of: str | date | None = None,
    teams: Iterable[str] | None = None,
    fetcher: Callable[[Iterable[int]], pd.DataFrame] | None = None,
) -> pd.DataFrame:
    """Per-defense normalized "allowed" rates for a stat over a recent window.

    Returns a DataFrame with one row per team::

        team, games, allowed_per_game, std, league_avg, ratio, low_sample

    ``ratio`` is the matchup factor — multiply a player's baseline projection by
    it (STAGE 4) to get the opponent-adjusted line. Teams with insufficient data
    carry ``ratio == 1.0`` and ``low_sample == True``.
    """
    stat = get_stat(stat)
    if seasons is None:
        seasons = default_seasons()
    seasons = [int(s) for s in seasons]
    if as_of is None:
        as_of = date.today()

    weekly = (fetcher or _fetch_weekly_nflverse)(seasons)
    if weekly is None or len(weekly) == 0 or COL_OPPONENT not in weekly.columns:
        return _empty_rates()

    tw = _allowed_per_team_week(weekly, stat)
    if tw.empty:
        return _empty_rates()

    if COL_GAMEDAY in tw.columns:
        tw[COL_GAMEDAY] = pd.to_datetime(tw[COL_GAMEDAY], errors="coerce")
        cutoff = pd.Timestamp(as_of)
        tw = tw[tw[COL_GAMEDAY].isna() | (tw[COL_GAMEDAY] <= cutoff)]

    tw.sort_values([COL_SEASON, COL_WEEK], kind="stable", inplace=True)

    # Last `window` team games per defense.
    recent = tw.groupby("team", sort=False).tail(window)

    team_agg = (
        recent.groupby("team", sort=False)
        .agg(games=("allowed", "count"), allowed_per_game=("allowed", "mean"), std=("allowed", "std"))
        .reset_index()
    )

    # League average is per team-*game* over the same window, so defenses with
    # byes (fewer games) don't skew it.
    league_avg = float(recent["allowed"].mean()) if not recent.empty else 0.0

    team_agg["league_avg"] = round(league_avg, 2)
    team_agg["low_sample"] = team_agg["games"] < min_games
    team_agg["ratio"] = team_agg.apply(
        lambda r: 1.0
        if r["low_sample"] or league_avg <= 0
        else r["allowed_per_game"] / league_avg,
        axis=1,
    )
    team_agg["ratio"] = team_agg["ratio"].round(3)

    if teams is not None:
        wanted = {str(t).upper() for t in teams}
        team_agg = team_agg[team_agg["team"].isin(wanted)]

    return team_agg.reset_index(drop=True)


def opponent_factor(opponent_team: str, rates: pd.DataFrame) -> dict:
    """Look up the normalized matchup factor for one defense.

    Returns ``{"team", "factor", "games", "low_sample"}``; an unknown team yields
    a neutral ``factor == 1.0`` so callers never crash on a lookup miss.
    """
    team = str(opponent_team).upper()
    row = rates[rates["team"] == team]
    if row.empty:
        logger.warning("No defense rates for %s — using neutral factor 1.0", team)
        return {"team": team, "factor": 1.0, "games": 0, "low_sample": True}
    r = row.iloc[0]
    return {
        "team": team,
        "factor": float(r["ratio"]),
        "games": int(r["games"]),
        "low_sample": bool(r["low_sample"]),
    }


def _empty_rates() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "team", "games", "allowed_per_game", "std",
            "league_avg", "ratio", "low_sample",
        ]
    )
