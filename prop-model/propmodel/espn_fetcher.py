"""ESPN historical data fetcher — builds an nflverse-compatible weekly frame from ESPN.

Uses only ESPN's public scoreboard + summary endpoints (no key), so the
prop-model can be trained and scored on the *same* stats the dashboard shows.

Source of truth for the model stays the nflverse weekly file when it is
available, but this module gives a second, dashboard-native history for
walk-forward training and for the offseason when nflverse lags behind ESPN's
live box scores.

Schema emitted matches ``data_pipeline.normalize_weekly``'s expectation:
    player_id, player_name, position, recent_team, opponent_team,
    season, week, gameday, game_id, games,
    passing_yards, passing_tds, rushing_yards, rushing_tds,
    receiving_yards, receptions, receiving_tds, ...

Cached per-event JSON under ``cache/espn_events/<season>/<eventId>.json``
so a full 3-season backfill (~800 game summaries) costs ~800 fetches once,
then is instant.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"

# ESPN category -> nflverse column mapping (keys are ESPN's ``keys`` entries)
# Indices are positions in the ``stats`` array for that category.
_CAT_MAP = {
    "passing": {
        "passing_yards": ("passingYards", 1),
        "passing_tds": ("passingTouchdowns", 3),
    },
    "rushing": {
        "rushing_yards": ("rushingYards", 1),
        "rushing_tds": ("rushingTouchdowns", 3),
        "rushing_attempts": ("rushingAttempts", 0),
    },
    "receiving": {
        "receiving_yards": ("receivingYards", 1),
        "receptions": ("receptions", 0),
        "receiving_tds": ("receivingTouchdowns", 3),
    },
}

# Infer position when ESPN doesn't return it (QB/RB/WR/TE guard).
def _infer_position(categories: list[str], has_passing: bool) -> str:
    if has_passing:
        return "QB"
    if "receiving" in categories:
        # TE vs WR indistinguishable without roster — call it WR and let the
        # model's position guard treat TE-receiving as valid (WR overlaps TE's
        # receiving stats, and TE is a subset of WR in stats.py).
        return "WR"
    if "rushing" in categories:
        return "RB"
    return "?"


def _parse_summary(summary: dict, fallback_week: int | None = None, fallback_season: int | None = None) -> list[dict]:
    """One summary JSON -> list of per-player per-game rows."""
    header = summary.get("header", {}).get("competitions", [{}])[0]
    competitors = header.get("competitors", [])
    if len(competitors) < 2:
        return []
    # team abbreviation -> opponent abbreviation
    team_to_opp = {}
    for c in competitors:
        abbr = (c.get("team", {}).get("abbreviation") or "").upper()
        opp = next((x for x in competitors if x != c), None)
        opp_abbr = (opp.get("team", {}).get("abbreviation") or "").upper() if opp else ""
        if abbr:
            team_to_opp[abbr] = opp_abbr

    # week/season/date from header, with scoreboard fallback
    season = None
    try:
        season = int(summary.get("header", {}).get("season", {}).get("year") or header.get("season", {}).get("year") or 0)
    except Exception:
        pass
    if not season and fallback_season:
        season = int(fallback_season)
    # scoreboard also carries season; fallback to event date year
    event_date = header.get("date") or summary.get("header", {}).get("date")
    if not season and event_date:
        try:
            season = int(str(event_date)[:4])
        except Exception:
            season = 0
    week = None
    try:
        week = int(header.get("week", {}).get("number") or 0)
    except Exception:
        week = 0
    if not week and fallback_week:
        week = int(fallback_week)
    game_id = str(header.get("id") or summary.get("header", {}).get("id") or "")
    gameday = event_date

    rows: dict[tuple[str, str], dict] = {}  # (player_id, team_abbr) -> row

    for team_block in summary.get("boxscore", {}).get("players", []):
        team_abbr = (team_block.get("team", {}).get("abbreviation") or "").upper()
        opp_abbr = team_to_opp.get(team_abbr, "")
        for cat in team_block.get("statistics", []):
            cat_name = (cat.get("name") or "").lower()
            if cat_name not in ("passing", "rushing", "receiving"):
                continue
            keys = cat.get("keys", [])
            for ath in cat.get("athletes", []):
                pid = str(ath.get("athlete", {}).get("id", ""))
                if not pid:
                    continue
                name = ath.get("athlete", {}).get("displayName") or ath.get("athlete", {}).get("shortName") or pid
                stats_arr = ath.get("stats", [])
                # Build a key -> value map for this athlete in this category
                kv: dict[str, str] = {}
                for i, k in enumerate(keys):
                    if i < len(stats_arr):
                        kv[k] = str(stats_arr[i])
                # Merge into per-player row (a QB appears in passing+rushing)
                key = (pid, team_abbr)
                if key not in rows:
                    rows[key] = {
                        "player_id": pid,
                        "player_name": name,
                        "position": None,  # filled below
                        "recent_team": team_abbr,
                        "opponent_team": opp_abbr,
                        "season": season,
                        "week": week,
                        "gameday": gameday,
                        "game_id": game_id,
                        "games": 1,
                        "passing_yards": None,
                        "passing_tds": None,
                        "rushing_yards": None,
                        "rushing_tds": None,
                        "rushing_attempts": None,
                        "receiving_yards": None,
                        "receptions": None,
                        "receiving_tds": None,
                        "_cats": set(),
                        "_has_passing": False,
                    }
                row = rows[key]
                row["_cats"].add(cat_name)
                if cat_name == "passing":
                    row["_has_passing"] = True
                    try:
                        row["passing_yards"] = float(kv.get("passingYards", "").replace(",", "")) if kv.get("passingYards") not in (None, "", "-") else row["passing_yards"]
                    except Exception:
                        pass
                    try:
                        row["passing_tds"] = float(kv.get("passingTouchdowns", "")) if kv.get("passingTouchdowns") not in (None, "", "-") else row["passing_tds"]
                    except Exception:
                        pass
                elif cat_name == "rushing":
                    try:
                        row["rushing_yards"] = float(kv.get("rushingYards", "").replace(",", "")) if kv.get("rushingYards") not in (None, "", "-") else row["rushing_yards"]
                    except Exception:
                        pass
                    try:
                        row["rushing_tds"] = float(kv.get("rushingTouchdowns", "")) if kv.get("rushingTouchdowns") not in (None, "", "-") else row["rushing_tds"]
                    except Exception:
                        pass
                    try:
                        row["rushing_attempts"] = float(kv.get("rushingAttempts", "")) if kv.get("rushingAttempts") not in (None, "", "-") else row["rushing_attempts"]
                    except Exception:
                        pass
                elif cat_name == "receiving":
                    try:
                        row["receiving_yards"] = float(kv.get("receivingYards", "").replace(",", "")) if kv.get("receivingYards") not in (None, "", "-") else row["receiving_yards"]
                    except Exception:
                        pass
                    try:
                        row["receptions"] = float(kv.get("receptions", "")) if kv.get("receptions") not in (None, "", "-") else row["receptions"]
                    except Exception:
                        pass
                    try:
                        row["receiving_tds"] = float(kv.get("receivingTouchdowns", "")) if kv.get("receivingTouchdowns") not in (None, "", "-") else row["receiving_tds"]
                    except Exception:
                        pass

    out = []
    for r in rows.values():
        cats = list(r.pop("_cats"))
        has_passing = r.pop("_has_passing")
        r["position"] = _infer_position(cats, has_passing)
        # Drop helper-heavy empties: a player with no usable stat is still a row
        # but the pipeline will filter by _stat_value.
        out.append(r)
    return out


def _fetch_scoreboard_dates(dates: str, timeout: int = 20) -> list[dict]:
    url = f"{SCOREBOARD}?dates={dates}&limit=1000"
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    return data.get("events", []) or []


def fetch_weekly_espn(
    seasons: Iterable[int],
    cache_dir: str | Path = "cache",
    force_refresh: bool = False,
    sleep_s: float = 0.15,
    max_events: int | None = None,
) -> pd.DataFrame:
    """Build a weekly frame from ESPN box scores for ``seasons``.

    Each season fetches the regular season (weeks 1-18) via the scoreboard's
    ``dates`` range plus postseason fallback. Events are cached per-event so
    re-runs are instant. Returns a DataFrame with the same columns
    ``data_pipeline.normalize_weekly`` expects, plus the stat columns.
    """
    cache_path = Path(cache_dir) / "espn_events"
    cache_path.mkdir(parents=True, exist_ok=True)
    seasons = [int(s) for s in seasons]
    all_rows: list[dict] = []

    for season in seasons:
        # NFL season Y spans Sep of Y to Feb of Y+1: regular season Sep-Jan,
        # postseason Jan-Feb. Scoreboard accepts a dates range.
        dates = f"{season}0901-{season + 1}0201"
        logger.info("ESPN scoreboard %s (%s)", season, dates)
        try:
            events = _fetch_scoreboard_dates(dates)
        except Exception as e:
            logger.warning("ESPN scoreboard %s failed: %s", season, e)
            continue
        # Filter to regular season (type 2) — postseason is type 3; preseason 1.
        # For training we want regular season only.
        reg_events = [e for e in events if (e.get("season", {}).get("type") == 2) or (e.get("seasonType", {}).get("type") == 2)]
        if not reg_events:
            # Fallback: if season type missing, keep all events with a valid header week
            reg_events = events
        if max_events:
            reg_events = reg_events[:max_events]

        for ev in reg_events:
            event_id = str(ev.get("id", ""))
            if not event_id:
                continue
            cache_file = cache_path / str(season) / f"{event_id}.json"
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            summary = None
            if cache_file.exists() and not force_refresh:
                try:
                    summary = json.loads(cache_file.read_text())
                except Exception:
                    summary = None
            if summary is None:
                try:
                    resp = requests.get(f"{SUMMARY}?event={event_id}", timeout=20)
                    if resp.status_code == 404:
                        logger.warning("ESPN summary 404 for %s", event_id)
                        continue
                    resp.raise_for_status()
                    summary = resp.json()
                    cache_file.write_text(json.dumps(summary))
                    time.sleep(sleep_s)
                except Exception as e:
                    logger.warning("ESPN summary %s failed: %s", event_id, e)
                    continue
            try:
                # scoreboard week/season as fallback when summary header omits it
                sb_week = ev.get("week", {}).get("number") if isinstance(ev.get("week"), dict) else None
                sb_season = ev.get("season", {}).get("year") if isinstance(ev.get("season"), dict) else None
                rows = _parse_summary(summary, fallback_week=sb_week, fallback_season=sb_season)
                # Ensure season/week are filled even if header missed
                for r in rows:
                    if not r.get("season"):
                        r["season"] = season
                    if not r.get("week"):
                        r["week"] = sb_week or 1
                all_rows.extend(rows)
            except Exception as e:
                logger.warning("Parse failed for %s: %s", event_id, e)

    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    # Normalize dtypes like nflverse: gameday as string, games int
    if "gameday" in df.columns:
        df["gameday"] = pd.to_datetime(df["gameday"], errors="coerce").dt.strftime("%Y-%m-%d")
    # Ensure required columns exist for the pipeline
    for col in ("player_id", "player_name", "position", "recent_team", "opponent_team", "season", "week", "game_id", "games"):
        if col not in df.columns:
            df[col] = None
    # Fill missing stat columns with None so _stat_value treats them as absent
    for col in ("passing_yards", "passing_tds", "rushing_yards", "rushing_tds", "receiving_yards", "receptions", "receiving_tds"):
        if col not in df.columns:
            df[col] = None
    return df


def fetch_weekly_espn_cached(
    seasons: Iterable[int],
    cache_dir: str | Path = "cache",
    dataframe_cache: str | Path | None = None,
) -> pd.DataFrame:
    """Cached DataFrame wrapper (parquet) so training doesn't re-parse JSON."""
    seasons = sorted(int(s) for s in seasons)
    cache_dir = Path(cache_dir)
    if dataframe_cache is None:
        dataframe_cache = cache_dir / f"espn_weekly_{min(seasons)}_{max(seasons)}.parquet"
    else:
        dataframe_cache = Path(dataframe_cache)
    if dataframe_cache.exists():
        try:
            return pd.read_parquet(dataframe_cache)
        except Exception:
            pass
    df = fetch_weekly_espn(seasons, cache_dir=cache_dir)
    if not df.empty:
        try:
            dataframe_cache.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(dataframe_cache, index=False)
        except Exception as e:
            logger.warning("Could not cache ESPN parquet: %s", e)
    return df
