"""Player name → nflfastR player_id resolution from the weekly frame."""

from __future__ import annotations

import re

import pandas as pd


def normalize_name(name: str) -> str:
    """Lowercase, drop punctuation (keep letters/digits/spaces), collapse spaces."""
    cleaned = re.sub(r"[^a-z0-9 ]", "", name.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def normalized_names(weekly: pd.DataFrame) -> pd.Series:
    """Normalized candidate name for every row of the weekly frame.

    nflverse stats_player files abbreviate player_name ("C.Stroud") but keep
    the full name in player_display_name — prefer the full name for matching.
    Building this once per run (see :func:`resolve_player_id`'s ``name_index``)
    avoids regex-normalizing ~57k names on every resolution.
    """
    if "player_display_name" in weekly.columns:
        name_col = "player_display_name"
    else:
        name_col = "player_name"
    return weekly[name_col].map(lambda v: normalize_name(v) if isinstance(v, str) else "")


def resolve_player_id(
    weekly: pd.DataFrame,
    player_name: str,
    team: str | None = None,
    name_index: pd.Series | None = None,
) -> str | None:
    """Find the nflfastR player_id for ``player_name`` (optionally on ``team``).

    Matches normalized display names, then prefers rows on the requested team
    when one is given (handles players whose name recurs across teams).
    Crucially, a *name-only* match is allowed: players who changed teams in
    the offseason (e.g. Kirk Cousins ATL→LV) still resolve, because their
    history lives under their old team's rows. Returns the player id with the
    most recent game when multiple ids match (career splits across versions).
    Returns None when the player isn't in the frame at all (e.g. a rookie
    with no NFL games yet).

    ``name_index`` optionally supplies :func:`normalized_names` output reused
    across calls; results are identical to computing it per call.
    """
    if "player_id" not in weekly.columns or "player_name" not in weekly.columns:
        return None
    wanted = normalize_name(player_name)
    if name_index is None:
        name_index = normalized_names(weekly)

    rows = weekly[name_index == wanted]
    if rows.empty:
        return None
    team_col = "recent_team" if "recent_team" in weekly.columns else "team"
    if team:
        team = str(team).upper()
        team_rows = rows[rows[team_col].astype(str).str.upper() == team]
        if not team_rows.empty:
            rows = team_rows
    ids = rows["player_id"].astype(str).unique()
    if len(ids) == 1:
        return ids[0]
    # Multiple ids for the same name (career splits across data versions):
    # prefer the id with the latest season/week.
    order_cols = [c for c in ("season", "week") if c in rows.columns]
    if order_cols:
        rows = rows.sort_values(order_cols)
    return str(rows["player_id"].astype(str).iloc[-1])
