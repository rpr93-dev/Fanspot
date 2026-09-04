"""STAGE 3 — Game-script adjustment (Vegas total/spread as a pace & volume factor).

The Vegas total and spread for the upcoming game are the market's best read on
game context. We turn them into a per-team volume multiplier that stacks on top
of the opponent adjustment from STAGE 2.

Assumption (plain language)
---------------------------
More total points → more plays run → more volume for every skill player on the
field. A team expected to score more (the favorite, or either side of a
high-total game) gets more possessions and red-zone work, so its players'
volume stats (yards, receptions, TDs) scale with its implied team score.

Formula
-------
    implied_team_total = (total + margin) / 2        margin = +spread if favorite
                       = (total - spread) / 2        margin = -spread if underdog
    script_factor      = implied_team_total / LEAGUE_AVG_TEAM_TOTAL

``spread`` is the favorite's margin (positive). A team implied at 27 in a league
averaging 22 gets factor ~1.23; a team implied at 18 gets ~0.82. The factor is
clamped (0.6-1.4) so a wild line can't produce absurd projections.

The line source is pluggable (``LineProvider`` protocol) so The Odds API can be
dropped in later without touching the model. When no line is available the
factor is neutral 1.0 with ``available=False``.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from dataclasses import dataclass
from typing import Protocol

logger = logging.getLogger(__name__)

# League-average NFL team scoring (points per team per game) — the baseline a
# "typical" game total implies. Shared conceptually with the dashboard's own
# matchup adjustment so both sides of the app tell the same story.
LEAGUE_AVG_TEAM_TOTAL = 22.0

SCRIPT_FACTOR_MIN = 0.75
SCRIPT_FACTOR_MAX = 1.25

# Stat-specific game script multipliers:
# Different stats respond differently to game context.
# A +10 spread increases passing volume more than rushing volume.
STAT_SCRIPT_WEIGHTS: dict[str, float] = {
    "passing_yards": 1.0,       # full game-script effect on passing
    "passing_tds": 1.0,
    "receiving_yards": 0.9,     # slightly less than passing (recipients vary)
    "receptions": 0.8,          # volume stat, less sensitive to game state
    "rushing_yards": 0.6,       # heavy underdogs run less, heavy favorites run more
    "rushing_tds": 0.5,
    "receiving_tds": 0.7,       # somewhat sensitive to scoring context
    "tds": 0.7,
}


@dataclass(frozen=True)
class GameLines:
    total: float
    spread: float  # favorite's margin, positive; 0 = pick'em
    favorite: str | None = None  # 3-letter team code of the favorite, None = pick'em


class LineProvider(Protocol):
    def fetch(self, home: str, away: str) -> GameLines | None: ...


def script_factor_for_team(
    lines: GameLines, team: str, stat_key: str = "",
) -> float:
    """Pace/volume multiplier for one team given the game's lines.

    The favorite's implied total is (total + spread) / 2; the underdog's is
    (total - spread) / 2. ``team`` is a 3-letter code; pick'em splits the total.

    When ``stat_key`` is provided, the factor is modulated by stat-specific
    game-script sensitivity (passing responds more to game state than rushing).
    """
    is_fav = lines.favorite is not None and lines.favorite.upper() == str(team).upper()
    margin = lines.spread if is_fav else -lines.spread
    implied = (lines.total + margin) / 2
    raw_factor = max(SCRIPT_FACTOR_MIN, min(SCRIPT_FACTOR_MAX, implied / LEAGUE_AVG_TEAM_TOTAL))

    # Stat-specific modulation: pull toward 1.0 for stats that are less
    # sensitive to game state (rushing on a big favorite, etc.)
    if stat_key:
        weight = STAT_SCRIPT_WEIGHTS.get(stat_key, 1.0)
        # Blend: weight * raw_factor + (1 - weight) * 1.0
        return max(SCRIPT_FACTOR_MIN, min(SCRIPT_FACTOR_MAX, weight * raw_factor + (1.0 - weight)))

    return raw_factor


def script_adjustment(
    team: str,
    opponent: str,
    lines: GameLines | None,
    stat_key: str = "",
) -> dict:
    """Structured game-script adjustment for ``team`` facing ``opponent``.

    Returns ``{"available", "factor", "total", "spread", "implied_total"}`` with
    a neutral ``factor == 1.0`` when no lines are available (callers can log it
    as low-confidence rather than crash).

    When ``stat_key`` is provided, the factor is modulated by stat-specific
    game-script sensitivity.
    """
    if lines is None:
        return {
            "available": False,
            "factor": 1.0,
            "total": None,
            "spread": None,
            "implied_total": None,
        }
    return {
        "available": True,
        "factor": script_factor_for_team(lines, team, stat_key=stat_key),
        "total": float(lines.total),
        "spread": float(lines.spread),
        "implied_total": round((lines.total + (lines.spread if lines.favorite and lines.favorite.upper() == str(team).upper() else -lines.spread)) / 2, 1),
    }


class StaticLineProvider:
    """Lines from a static mapping — for offline runs, config, and tests.

    The mapping is keyed by the team code you project (the caller knows its
    upcoming opponent), e.g. ``{"HOU": GameLines(40.5, 1.5, "HOU")}``.
    """

    def __init__(self, lines: dict[str, GameLines] | None = None):
        self._lines = {str(k).upper(): v for k, v in (lines or {}).items()}

    def fetch(self, home: str, away: str) -> GameLines | None:
        return self._lines.get(str(home).upper()) or self._lines.get(str(away).upper())


class OddsApiLineProvider:
    """Fetches the game total/spread from The Odds API.

    Only active when ``ODDS_API_KEY`` is set; otherwise ``fetch`` returns None
    and the model runs with a neutral game-script factor. Uses only the stdlib
    so the package stays dependency-light. (Market-line *edge* comparison is a
    separate concern — STAGE 6 leaves the edge columns empty for now.)
    """

    _BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds"

    def __init__(self, api_key: str | None = None, timeout: float = 10.0):
        self._api_key = api_key if api_key is not None else os.environ.get("ODDS_API_KEY")
        self._timeout = timeout

    def fetch(self, home: str, away: str) -> GameLines | None:
        if not self._api_key:
            return None
        url = f"{self._BASE}/?apiKey={self._api_key}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal"
        try:
            with urllib.request.urlopen(url, timeout=self._timeout) as resp:
                events = json.loads(resp.read().decode("utf-8"))
        except Exception as e:  # network error, bad key, timeout
            logger.warning("Odds API line fetch failed: %s", e)
            return None
        for evt in events:
            home_name, away_name = evt.get("home_team", ""), evt.get("away_team", "")
            # nflverse codes vs Odds API full names — match on a contained token.
            if not (home.upper() in home_name.upper() or home.upper() in away_name.upper()):
                continue
            for bm in evt.get("bookmakers", []):
                markets = {m.get("key"): m for m in bm.get("markets", [])}
                total = _price(markets.get("totals"), "Over")
                spread = _price(markets.get("spreads"), home_name)
                if total is not None and spread is not None:
                    fav = home if spread < 0 else away
                    return GameLines(total=total, spread=abs(spread), favorite=fav)
        return None


def _price(market: dict | None, side_name: str) -> float | None:
    """Pull the point value from an Odds API market outcome matching ``side_name``."""
    if not market:
        return None
    for o in market.get("outcomes", []):
        if side_name.lower() in str(o.get("name", "")).lower():
            try:
                return float(o.get("point"))
            except (TypeError, ValueError):
                return None
    return None
