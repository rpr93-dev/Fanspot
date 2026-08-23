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
    """Seasons to pull by default: the last 4 calendar years.

    Covers both mid-season runs (current year has games) and offseason runs
    (the previous year is the last completed season), and gives thin-history
    players (backups, rookies who barely played, players with injury gaps)
    enough games to clear the ``min_games`` bar.
    """
    this_year = date.today().year
    return [this_year - 3, this_year - 2, this_year - 1, this_year]


def normalize_weekly(weekly: pd.DataFrame) -> pd.DataFrame:
    """Make a weekly frame match the schema the pipeline expects.

    Accepts both the nflfastR ``weekly`` schema (``recent_team``, ``gameday``,
    ``games``) and the nflverse ``stats_player`` files (``team``, no game dates).
    When dates are absent, a ``gameday`` is synthesized from season/week
    (kickoff ≈ Sep 8, one game per week) so staleness checks and the missed-game
    window keep working.
    """
    df = weekly.copy()
    if "recent_team" not in df.columns and "team" in df.columns:
        df["recent_team"] = df["team"]
    if "gameday" not in df.columns and {"season", "week"}.issubset(df.columns):
        season = pd.to_numeric(df["season"], errors="coerce").fillna(1970).astype(int)
        week = pd.to_numeric(df["week"], errors="coerce").fillna(1).astype(int)
        start = pd.to_datetime(season.astype(str) + "-09-08", errors="coerce")
        df["gameday"] = start + pd.to_timedelta((week - 1) * 7, unit="D")
    return df


def weekly_is_usable(weekly: pd.DataFrame | None) -> bool:
    """Cheap check for :func:`cached_fetcher`'s ``validator`` hook.

    True when a cached/fetched weekly frame has the columns the pipeline
    actually needs and at least one row — i.e. it can't silently project
    nobody. Schema *errors* still raise via :func:`validate_weekly`; this
    predicate only decides whether an existing cache entry is worth keeping.
    """
    if weekly is None or not isinstance(weekly, pd.DataFrame) or len(weekly) == 0:
        return False
    try:
        _require_weekly_columns(weekly.columns, source="cached weekly data")
    except ValueError:
        return False
    return True


def _require_weekly_columns(cols, source: str) -> None:
    """Raise ValueError naming every required column group missing from ``cols``."""
    have = set(cols)
    groups: list[tuple[str, tuple[str, ...]]] = [
        ("player_id", (COL_PLAYER_ID,)),
        ("player_name or player_display_name", (COL_PLAYER_NAME, "player_display_name")),
        ("recent_team or team", (COL_TEAM, "team")),
        ("season", (COL_SEASON,)),
        ("week", (COL_WEEK,)),
    ]
    missing = [f"{any_of}" for any_of, options in groups if not (set(options) & have)]
    if missing:
        raise ValueError(
            f"{source} is missing required column(s): {', '.join(missing)} — "
            f"got columns [{', '.join(sorted(have))}]"
        )


def validate_weekly(weekly: pd.DataFrame | None, source: str = "weekly data") -> pd.DataFrame:
    """Fail loudly when a weekly frame can't feed the pipeline.

    A wrong-schema file (someone hands the CLI a different export) or an empty
    pull must stop the run with the cause named — otherwise every player
    resolves to nothing and the tool emits plausible-looking "player not
    found" refusals instead of the truth (the *data* is broken). Returns the
    frame unchanged when it is usable.
    """
    if weekly is None or len(weekly) == 0:
        raise ValueError(f"{source} is empty (0 rows)")
    _require_weekly_columns(weekly.columns, source=source)
    return weekly


def _fetch_weekly_nflverse(seasons: Iterable[int]) -> pd.DataFrame:
    """Default fetcher: nflverse weekly player stats.

    Prefers ``nfl_data_py`` when it is importable (its ``import_weekly`` /
    ``import_weekly_data``). On Python >= 3.13 that package can't install
    (it pins pandas<2/numpy<2, which have no wheels there), so we fall back to
    downloading the *same* nflverse weekly CSV files directly — identical source
    data, just without the wrapper. Either path yields the weekly schema the
    pipeline expects (player_id, recent_team, opponent_team, gameday, games,
    per-stat columns).
    """
    years = [int(s) for s in seasons]
    logger.info("Fetching nflverse weekly stats for seasons %s", years)

    try:
        import nfl_data_py as nfl
    except ImportError:
        nfl = None
    if nfl is not None:
        fn = getattr(nfl, "import_weekly", None) or getattr(nfl, "import_weekly_data", None)
        if fn is not None:
            try:
                return fn(years=years)
            except TypeError:
                return fn(years)
            except Exception as e:  # version/API mismatch — fall through to direct
                logger.warning("nfl_data_py fetch failed (%s); falling back to direct download", e)

    import io

    try:
        import requests
    except ImportError as e:
        # The direct-download fallback is the only path on Python >= 3.13
        # (nfl_data_py can't install there), so a missing requests must be a
        # named, actionable error — not a bare ModuleNotFoundError from deep
        # inside the fetch.
        raise RuntimeError(
            "Live weekly fetch needs nfl_data_py or the 'requests' package "
            "(neither is installed). Install deps: pip install -r requirements.txt"
        ) from e

    frames = []
    for season in years:
        # nflverse publishes weekly player stats under the `player_stats`
        # release (parquet). Same schema as the CSV wrapper — one row per
        # player-week.
        url = f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.parquet"
        logger.info("Downloading %s", url)
        resp = requests.get(url, timeout=120)
        if resp.status_code == 404:
            logger.warning("No weekly file for %s (season not started?) — skipping", season)
            continue
        resp.raise_for_status()
        frames.append(pd.read_parquet(io.BytesIO(resp.content)))
    if not frames:
        raise RuntimeError("No nflverse weekly data downloaded for seasons %s" % years)
    return pd.concat(frames, ignore_index=True)


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

    weekly = normalize_weekly((fetcher or _fetch_weekly_nflverse)(seasons))
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
            "value": value,
        }

    records = [_game_record(r) for _, r in history.iterrows()]
    # A played week with *no recorded value* must never silently enter the
    # model as a 0.0 — that fabricates a dud game out of a data gap. Count
    # stats legitimately read missing columns as zero (a player never
    # accumulates in a category they don't line up in); continuous stats get
    # the week excluded loudly via an INCOMPLETE_STAT flag.
    if stat.kind == "count":
        for rec in records:
            if rec["value"] is None:
                rec["value"] = 0.0
        kept_records = records
    else:
        kept_records = [rec for rec in records if rec["value"] is not None]

    games_df = (
        pd.DataFrame(kept_records, columns=["season", "week", "game_id", "date", "opponent", "value"])
        if kept_records
        else empty.copy()
    )
    n_modeled = len(games_df)
    n_unrecorded = len(records) - len(kept_records)

    missed_df = (
        pd.DataFrame([{**_game_record(r), "reason": "dnp"} for _, r in missed.iterrows()])
        if not missed.empty
        else empty.copy()
    )

    flags: list[QualityFlag] = []
    if n_modeled < min_games:
        reason = f"Only {n_modeled} played games with a recorded {stat.key} value (< {min_games} required)"
        flags.append(QualityFlag("INSUFFICIENT_HISTORY", "error", reason))
    elif n_modeled < n_games:
        flags.append(QualityFlag(
            "FEWER_GAMES", "info",
            f"Only {n_modeled} played games available (requested {n_games})",
        ))
    if n_modeled == 0:
        flags.append(QualityFlag(
            "NO_PLAYED_GAMES", "error",
            f"Player has no played games with a recorded {stat.key} value in seasons {seasons}",
        ))

    if n_unrecorded:
        flags.append(QualityFlag(
            "INCOMPLETE_STAT", "warn",
            f"{n_unrecorded} played week(s) had no recorded {stat.key} value "
            "and were excluded from the model input (not counted as zeros)",
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

    return PlayerHistory(
        stat=stat, player_id=pid, player_name=player_name, position=position,
        team=team, n_requested=n_games, games=games_df, missed_games=missed_df,
        flags=flags,
    )
