"""STAGE 1 — Player stat history pipeline.

Pulls the last N games of a player's stat from nflverse weekly player stats
(``nfl_data_py.import_weekly``) and validates the result before any modeling.

Data model (nflverse weekly file)
---------------------------------
One row per player-week for every player who was on an active roster:

    player_id       nflfastR player id (string, e.g. "00-0033873")
    player_name     display name
    position        "QB" / "RB" / "WR" / "TE" / ...
    recent_team     the player's team that week
    opponent_team   the team they faced that week
    season, week    week resets each season; postseason weeks are 19+
    gameday         game date (ISO)
    games           1 = played, 0 = inactive / healthy scratch
    <stat columns>  passing_yards, rushing_yards, receiving_yards, receptions,
                    passing_tds, rushing_tds, receiving_tds (NaN when not recorded)

Design choices
--------------
- "Last N games" means the N most recent weeks the player *played* (``games >= 1``).
  Weeks they were on the roster but did not play (injury/scratch) are kept and
  reported as gaps, never silently dropped — a projection over 8 games that really
  spans 12 weeks because of injuries is a weaker input than one spanning 8.
- A player with fewer than ``min_games`` (default 3) of history gets an
  INSUFFICIENT_HISTORY *error* flag: any projection built on it is untrustworthy
  and downstream stages should refuse or mark it low-confidence.
- The fetcher is injectable so tests run on synthetic frames without network or a
  live nfl_data_py install.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Iterable

import pandas as pd

from .stats import StatSpec, get_stat

logger = logging.getLogger(__name__)

# nflverse weekly schema column names (read defensively below in case a future
# nfl_data_py release renames something).
COL_PLAYER_ID = "player_id"
COL_PLAYER_NAME = "player_name"
COL_POSITION = "position"
COL_TEAM = "recent_team"
COL_OPPONENT = "opponent_team"
COL_SEASON = "season"
COL_WEEK = "week"
COL_GAMEDAY = "gameday"
COL_GAMES = "games"
COL_GAME_ID = "game_id"


@dataclass
class QualityFlag:
    code: str
    severity: str  # "info" | "warn" | "error"
    message: str


@dataclass
class PlayerHistory:
    """Validated stat history for one player + stat, ready for the model stages."""

    stat: StatSpec
    player_id: str
    player_name: str
    position: str
    team: str
    n_requested: int
    games: pd.DataFrame  # played games: season, week, game_id, date, opponent, value
    missed_games: pd.DataFrame  # roster weeks without a game (injury/scratch)
    flags: list[QualityFlag] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """False when the history is unusable (any error-severity flag)."""
        return not any(f.severity == "error" for f in self.flags)

    @property
    def n_games(self) -> int:
        return len(self.games)

    def to_dict(self) -> dict:
        """Serializable summary for piping into a dashboard."""
        return {
            "player_id": self.player_id,
            "player_name": self.player_name,
            "position": self.position,
            "team": self.team,
            "stat": self.stat.key,
            "stat_label": self.stat.label,
            "unit": self.stat.unit,
            "n_requested": self.n_requested,
            "n_games": self.n_games,
            "first_game": _iso(self.games["date"].iloc[0]) if self.n_games else None,
            "last_game": _iso(self.games["date"].iloc[-1]) if self.n_games else None,
            "missed_weeks": len(self.missed_games),
            "values": self.games["value"].round(1).tolist() if self.n_games else [],
            "ok": self.ok,
            "flags": [
                {"code": f.code, "severity": f.severity, "message": f.message}
                for f in self.flags
            ],
        }

    def report(self) -> str:
        lines = [
            f"{self.player_name} ({self.position}, {self.team}) — {self.stat.label}",
            f"  games: {self.n_games}/{self.n_requested} requested",
            f"  span:  {_iso(self.games['date'].iloc[0]) if self.n_games else '—'} → "
            f"{_iso(self.games['date'].iloc[-1]) if self.n_games else '—'}",
            f"  missed weeks (injury/scratch): {len(self.missed_games)}",
        ]
        for f in self.flags:
            lines.append(f"  [{f.severity.upper()}] {f.code}: {f.message}")
        return "\n".join(lines)


def _iso(value) -> str | None:
    if value is None or pd.isna(value):
        return None
    return str(pd.Timestamp(value).date())


def default_seasons() -> list[int]:
    """Seasons to pull by default: the previous + current calendar year.

    Covers both mid-season runs (current year has games) and offseason runs (the
    previous year is the last completed season).
    """
    this_year = date.today().year
    return [this_year - 1, this_year]


def _fetch_weekly_nflverse(seasons: Iterable[int]) -> pd.DataFrame:
    """Default fetcher: nflverse weekly player stats via nfl_data_py.

    Imported lazily so the package imports (and tests run) without nfl_data_py
    installed. Only the columns the pipeline needs are requested when the installed
    version supports it — the full weekly file is large.
    """
    import nfl_data_py as nfl

    years = [int(s) for s in seasons]
    logger.info("Fetching nflverse weekly stats for seasons %s", years)
    cols = [
        COL_PLAYER_ID, COL_PLAYER_NAME, COL_POSITION, COL_TEAM, COL_OPPONENT,
        COL_SEASON, COL_WEEK, COL_GAMEDAY, COL_GAMES, COL_GAME_ID,
        "passing_yards", "passing_tds",
        "rushing_yards", "rushing_tds",
        "receiving_yards", "receptions", "receiving_tds",
    ]
    try:
        return nfl.import_weekly(years=years, columns=cols)
    except TypeError:
        # Older nfl_data_py has no `columns` argument — pull everything and select.
        return nfl.import_weekly(years=years)[cols]


def _stat_value(row: pd.Series, stat: StatSpec) -> float | None:
    """Extract the stat value for one game row.

    Continuous stats read a single column (NaN → None = not recorded). Count stats
    (TDs) sum across their columns, skipping NaN — a player never accumulates in a
    category they don't line up in, so missing columns legitimately read as zero.
    """
    values = [
        float(v)
        for c in stat.columns
        for v in [row.get(c)]
        if v is not None and not pd.isna(v)
    ]
    if not values:
        return None
    return sum(values) if stat.kind == "count" else values[0]


def _played(row: pd.Series, stat: StatSpec) -> bool:
    """Whether the player played this week.

    Prefer the nflverse ``games`` column (1 = played, 0 = inactive/scratch); fall
    back to "the stat was recorded" if the column is missing in the fetched frame.
    """
    if COL_GAMES in row.index and not pd.isna(row.get(COL_GAMES)):
        return float(row[COL_GAMES]) >= 1
    return _stat_value(row, stat) is not None


def fetch_player_history(
    player_id: str,
    stat: str | StatSpec,
    n_games: int = 8,
    seasons: Iterable[int] | None = None,
    max_age_days: int = 21,
    min_games: int = 3,
    fetcher: Callable[[Iterable[int]], pd.DataFrame] | None = None,
) -> PlayerHistory:
    """Fetch + validate the last ``n_games`` played games for ``player_id``'s stat.

    Parameters
    ----------
    player_id : nflfastR player id (string).
    stat : stat key (e.g. ``"passing_yards"``) or :class:`StatSpec`.
    n_games : how many played games to keep (default 8).
    seasons : seasons to pull, e.g. ``[2025, 2026]``. Defaults to the previous and
        current calendar year (covers both mid-season and offseason runs).
    max_age_days : games older than this many days trigger a STALE flag.
    min_games : fewer played games than this is INSUFFICIENT_HISTORY (error).
    fetcher : injectable ``(seasons) -> weekly DataFrame`` for tests/offline runs.

    Returns
    -------
    :class:`PlayerHistory` with a validated ``games`` frame plus quality flags.
    """
    stat = get_stat(stat)

    if seasons is None:
        seasons = default_seasons()
    seasons = [int(s) for s in seasons]
    if not seasons:
        raise ValueError("At least one season is required")

    empty = pd.DataFrame(columns=["season", "week", "game_id", "date", "opponent", "value"])

    def _empty_history(reason: str) -> PlayerHistory:
        return PlayerHistory(
            stat=stat, player_id=player_id, player_name=player_id, position="?",
            team="?", n_requested=n_games, games=empty.copy(), missed_games=empty.copy(),
            flags=[QualityFlag("NO_DATA", "error", reason)],
        )

    weekly = (fetcher or _fetch_weekly_nflverse)(seasons)
    if weekly is None or len(weekly) == 0:
        return _empty_history("Weekly data empty (no seasons returned)")
    if COL_PLAYER_ID not in weekly.columns:
        return _empty_history("Weekly data missing player_id column — wrong source?")

    pid = str(player_id)
    rows = weekly[weekly[COL_PLAYER_ID].astype(str) == pid].copy()
    if rows.empty:
        return _empty_history(f"No rows for player_id {pid} in seasons {seasons}")

    # Dedupe + order: weeks reset every season, so sort by season then week.
    dedup_cols = [c for c in (COL_SEASON, COL_WEEK, COL_GAME_ID) if c in rows.columns]
    if dedup_cols:
        rows = rows.drop_duplicates(subset=dedup_cols, keep="first")
    rows.sort_values([COL_SEASON, COL_WEEK], kind="stable", inplace=True)

    if COL_GAMEDAY in rows.columns:
        rows[COL_GAMEDAY] = pd.to_datetime(rows[COL_GAMEDAY], errors="coerce")

    def _name(col: str, fallback: str, last: bool = False) -> str:
        series = rows[col].dropna()
        if series.empty:
            return fallback
        return str(series.iloc[-1] if last else series.iloc[0])

    player_name = _name(COL_PLAYER_NAME, pid)
    position = _name(COL_POSITION, "?")
    team = _name(COL_TEAM, "?", last=True)

    played_mask = rows.apply(lambda r: _played(r, stat), axis=1)
    played = rows[played_mask]
    dnp = rows[~played_mask]

    history = played.tail(n_games)

    # Missed weeks that fall *inside* the history window (the span the "last N
    # games" actually covers) are the ones that matter for confidence.
    if not history.empty:
        first_dt = history[COL_GAMEDAY].min()
        last_dt = history[COL_GAMEDAY].max()
        if dnp.empty:
            missed = dnp
        else:
            missed = dnp[(dnp[COL_GAMEDAY] >= first_dt) & (dnp[COL_GAMEDAY] <= last_dt)]
    else:
        missed = dnp

    def _game_record(r: pd.Series) -> dict:
        value = _stat_value(r, stat)
        return {
            "season": int(r[COL_SEASON]),
            "week": int(r[COL_WEEK]),
            "game_id": r.get(COL_GAME_ID),
            "date": r.get(COL_GAMEDAY),
            "opponent": r.get(COL_OPPONENT),
            "value": value if value is not None else 0.0,
        }

    games_df = (
        pd.DataFrame([_game_record(r) for _, r in history.iterrows()])
        if not history.empty
        else empty.copy()
    )

    missed_df = (
        pd.DataFrame([{**_game_record(r), "reason": "dnp"} for _, r in missed.iterrows()])
        if not missed.empty
        else empty.copy()
    )

    flags: list[QualityFlag] = []
    if len(history) < min_games:
        flags.append(QualityFlag(
            "INSUFFICIENT_HISTORY", "error",
            f"Only {len(history)} played games (< {min_games} required)",
        ))
    elif len(history) < n_games:
        flags.append(QualityFlag(
            "FEWER_GAMES", "info",
            f"Only {len(history)} played games available (requested {n_games})",
        ))
    if len(history) == 0:
        flags.append(QualityFlag(
            "NO_PLAYED_GAMES", "error",
            f"Player has no played games in seasons {seasons}",
        ))

    if not history.empty:
        last_date = pd.Timestamp(history[COL_GAMEDAY].max()).date()
        age_days = (date.today() - last_date).days
        if age_days > max_age_days:
            # Offseason gaps (> ~90 days) are expected and informational; a long
            # gap *during* the season usually means injury and is worth warning on.
            severity = "info" if age_days > 90 else "warn"
            flags.append(QualityFlag(
                "STALE", severity,
                f"Most recent game {age_days} days ago (> {max_age_days})",
            ))

    if not missed.empty:
        flags.append(QualityFlag(
            "MISSED_GAMES", "warn",
            f"{len(missed)} roster week(s) without a game inside the history window (injury/scratch)",
        ))

    if not history.empty and history.apply(lambda r: _stat_value(r, stat) is None, axis=1).any():
        flags.append(QualityFlag(
            "INCOMPLETE_STAT", "warn",
            "Some played weeks are missing a recorded stat value",
        ))

    return PlayerHistory(
        stat=stat, player_id=pid, player_name=player_name, position=position,
        team=team, n_requested=n_games, games=games_df, missed_games=missed_df,
        flags=flags,
    )
