"""Player name → nflfastR player_id resolution from the weekly frame."""

from __future__ import annotations

import re
from collections.abc import Iterable

import pandas as pd

# Generational suffixes are dropped so "Marvin Harrison Jr." (books/ESPN)
# matches "Marvin Harrison" (some feeds) and vice versa.
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str) -> str:
    """Lowercase, drop punctuation and generational suffixes, collapse spaces."""
    cleaned = re.sub(r"[^a-z0-9 ]", "", name.lower())
    tokens = [t for t in cleaned.split() if t not in _SUFFIXES]
    return " ".join(tokens)


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


def _last_token(name: str) -> str:
    parts = normalize_name(name).split()
    return parts[-1] if parts else ""


def resolve_player_id(
    weekly: pd.DataFrame,
    player_name: str,
    team: str | None = None,
    name_index: pd.Series | None = None,
    player_id: str | None = None,
    positions: Iterable[str] | None = None,
) -> str | None:
    """Find the nflfastR player_id for ``player_name`` (optionally on ``team``).

    Resolution order, built so a namesake never inherits someone else's
    history:

    1. ``player_id`` (gsis or ESPN athlete id, whichever the frame uses) when
       it exists in the frame *and* the last name agrees — an explicit id
       beats any name heuristic.
    2. Exact normalized display name. With ``positions`` (the stat's valid
       positions), rows at other positions are dropped when any remain — an
       edge rusher namesake can't answer a rushing-yards prop.
    3. Rows on the requested team win when they exist. Several ids on the
       same team and name are one player across data versions → latest id.
    4. Name-only fallback (offseason team change, e.g. Kirk Cousins ATL→LV)
       is allowed only when it is unambiguous: if two or more distinct ids
       played in the most recent season among the candidates, these are
       different active players and we refuse (None) rather than guess.

    Returns None when the player isn't in the frame (e.g. a rookie) or the
    match is ambiguous. ``name_index`` optionally supplies
    :func:`normalized_names` output reused across calls.
    """
    if "player_id" not in weekly.columns or "player_name" not in weekly.columns:
        return None

    if player_id:
        pid = str(player_id)
        id_rows = weekly[weekly["player_id"].astype(str) == pid]
        if not id_rows.empty:
            name_col = "player_display_name" if "player_display_name" in weekly.columns else "player_name"
            frame_last = {_last_token(v) for v in id_rows[name_col] if isinstance(v, str)}
            if _last_token(player_name) in frame_last:
                return pid

    wanted = normalize_name(player_name)
    if not wanted:
        return None
    if name_index is None:
        name_index = normalized_names(weekly)

    rows = weekly[name_index == wanted]
    if rows.empty:
        return None

    if positions and "position" in rows.columns:
        allowed = {str(p).upper() for p in positions}
        pos_rows = rows[rows["position"].astype(str).str.upper().isin(allowed)]
        if not pos_rows.empty:
            rows = pos_rows

    order_cols = [c for c in ("season", "week") if c in rows.columns]
    team_col = "recent_team" if "recent_team" in weekly.columns else "team"
    if team and team_col in rows.columns:
        team_rows = rows[rows[team_col].astype(str).str.upper() == str(team).upper()]
        if not team_rows.empty:
            ids = team_rows["player_id"].astype(str).unique()
            if len(ids) == 1:
                return ids[0]
            # Same name, same team, several ids: one player split across
            # data versions. Prefer the id with the latest game.
            if order_cols:
                team_rows = team_rows.sort_values(order_cols)
            return str(team_rows["player_id"].astype(str).iloc[-1])

    ids = rows["player_id"].astype(str).unique()
    if len(ids) == 1:
        return ids[0]
    if "season" not in rows.columns:
        return None
    latest = rows["season"].max()
    active_ids = rows.loc[rows["season"] == latest, "player_id"].astype(str).unique()
    if len(active_ids) != 1:
        return None
    return str(active_ids[0])
