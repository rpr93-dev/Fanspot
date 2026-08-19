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
    team: str | None = None,
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
    """
    if "player_id" not in weekly.columns or "player_name" not in weekly.columns:
        return None
    wanted = normalize_name(player_name)

    def _norm(v):
        return normalize_name(v) if isinstance(v, str) else ""

    # nflverse stats_player files abbreviate player_name ("C.Stroud") but keep
    # the full name in player_display_name — prefer the full name for matching.
    name_col = "player_display_name" if "player_display_name" in weekly.columns else "player_name"
    team_col = "recent_team" if "recent_team" in weekly.columns else "team"
    rows = weekly[weekly[name_col].map(_norm) == wanted]
    if rows.empty:
        return None
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
