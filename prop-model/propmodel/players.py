"""Player name → nflfastR player_id resolution from the weekly frame."""

from __future__ import annotations

import re

import pandas as pd


def normalize_name(name: str) -> str:
    """Lowercase, drop punctuation (keep letters/digits/spaces), collapse spaces."""
    cleaned = re.sub(r"[^a-z0-9 ]", "", name.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def resolve_player_id(
    weekly: pd.DataFrame,
    player_name: str,
    team: str,
) -> str | None:
    """Find the nflfastR player_id for ``player_name`` on ``team``.

    Matches normalized display names and the 3-letter team code, then picks the
    player id with the most recent game (handles names that recur across
    seasons). Returns None when the player isn't in the frame.
    """
    if "player_id" not in weekly.columns or "player_name" not in weekly.columns:
        return None
    wanted = normalize_name(player_name)
    team = str(team).upper()
    rows = weekly[
        (weekly["player_name"].astype(str).map(normalize_name) == wanted)
        & (weekly.get("recent_team", pd.Series(dtype=str)).astype(str).str.upper() == team)
    ]
    if rows.empty:
        return None
    ids = rows["player_id"].astype(str).unique()
    if len(ids) == 1:
        return ids[0]
    # Multiple ids for the same name+team (career splits across data versions):
    # prefer the id with the latest season/week.
    order_cols = [c for c in ("season", "week") if c in rows.columns]
    if order_cols:
        rows = rows.sort_values(order_cols)
    return str(rows["player_id"].astype(str).iloc[-1])
