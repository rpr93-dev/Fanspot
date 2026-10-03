"""NBA player resolution: ESPN athlete id first, else exact normalized name + team.

Never guesses a namesake: a name matching several distinct athlete ids that
the team can't disambiguate is refused as ambiguous, and a name with no exact
normalized match is refused as not found (no fuzzy / last-name fallback).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import pandas as pd

from .teams import normalize_nba_team

SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})


def normalize_name(name: str | None) -> str:
    """'Nikola Jokić' -> 'nikola jokic'; 'Jaren Jackson Jr.' -> 'jaren jackson';
    'Shai Gilgeous-Alexander' -> 'shai gilgeous alexander'; "D'Angelo" -> 'dangelo'.
    """
    s = unicodedata.normalize("NFKD", str(name or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = s.replace("'", "").replace("’", "").replace(".", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    toks = [t for t in s.split() if t]
    while len(toks) > 1 and toks[-1] in SUFFIXES:
        toks.pop()
    return " ".join(toks)


@dataclass
class Resolution:
    player_id: str | None
    refused_reason: str | None = None
    warning: str | None = None
    last_team: str | None = None


class NameIndex:
    """Normalized-name -> {player_id: last team seen, last date} built once per run."""

    def __init__(self, frame: pd.DataFrame):
        self.by_name: dict[str, set[str]] = {}
        self.teams_of: dict[str, set[str]] = {}
        self.last_team: dict[str, str] = {}
        self.ids: set[str] = set()
        if frame is None or frame.empty:
            return
        f = frame[["player_id", "player_name", "team", "game_date"]].copy()
        f = f.sort_values("game_date", kind="stable")
        for pid, name in f.drop_duplicates(["player_id", "player_name"])[["player_id", "player_name"]].itertuples(index=False):
            self.by_name.setdefault(normalize_name(name), set()).add(str(pid))
        for pid, team in f.drop_duplicates(["player_id", "team"])[["player_id", "team"]].itertuples(index=False):
            self.teams_of.setdefault(str(pid), set()).add(str(team))
        last = f.drop_duplicates("player_id", keep="last")
        self.last_team = {str(p): str(t) for p, t in zip(last["player_id"], last["team"])}
        self.ids = set(self.last_team)


def resolve_nba_player(index: NameIndex, player: str, team: str | None,
                       player_id: str | int | None = None) -> Resolution:
    """Resolve a target to an ESPN athlete id or refuse with a reason."""
    if player_id not in (None, ""):
        pid = str(player_id).strip()
        if pid in index.ids:
            return Resolution(pid, last_team=index.last_team.get(pid))
        # An explicit id we have no games for: fall through to the name, but
        # a name hit must not silently replace a *different* explicit id.
        name_hits = index.by_name.get(normalize_name(player), set())
        if name_hits and pid not in name_hits:
            return Resolution(None, refused_reason=f"player_id {pid} has no NBA box-score history (name '{player}' maps to other id(s)) — not guessing")
        if not name_hits:
            return Resolution(None, refused_reason=f"Player '{player}' (id {pid}) not found in NBA box scores")

    key = normalize_name(player)
    cands = set(index.by_name.get(key, set()))
    if not cands:
        return Resolution(None, refused_reason=f"Player '{player}' not found in NBA box scores")
    want = normalize_nba_team(team)
    if len(cands) == 1:
        pid = next(iter(cands))
        last = index.last_team.get(pid)
        warn = None
        if want and want not in index.teams_of.get(pid, set()):
            warn = f"team_mismatch: no games with {want}; last seen with {last} (offseason move?)"
        return Resolution(pid, warning=warn, last_team=last)
    # Several athletes share the normalized name: the team must decide.
    on_team = {p for p in cands if want and index.last_team.get(p) == want}
    if len(on_team) != 1:
        on_team = {p for p in cands if want and want in index.teams_of.get(p, set())}
    if len(on_team) == 1:
        pid = next(iter(on_team))
        return Resolution(pid, last_team=index.last_team.get(pid))
    return Resolution(
        None,
        refused_reason=f"ambiguous: '{player}' matches {len(cands)} NBA players ({', '.join(sorted(cands))}); pass player_id",
    )
