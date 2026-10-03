"""ESPN NBA box-score fetcher -> one row per player per game.

ESPN's NBA scoreboard rejects ``dates=A-B`` ranges (400 "Failed to get events
endpoint"), so the season index is built one day at a time on a thread pool,
then each final game's ``summary`` is fetched once and cached *trimmed* (header
essentials + box score + closing line; the full payload carries ~400 KB of
play-by-play we never read) under::

    <cache_dir>/nba/espn_events/<season>/<eventId>.json
    <cache_dir>/nba/espn_events/<season>/_index.json      # season event list
    <cache_dir>/nba/frame_<season>.pkl                    # parsed frame memo

Everything lives under ``<cache_dir>/nba/`` so the NFL tooling that globs
``cache/*.pkl`` (walk-forward gate, warm-up detection) never sees NBA files.

``season`` is ESPN's season year = the year the season *ends* (2026 = 2025-26).
A finished season's index and events are cached permanently; the current
season's index is refreshed after :data:`INDEX_TTL_S`. Network failures are
tolerated: a failed day/event is logged and skipped, never fatal, so a partial
pull still yields a usable (if thinner) frame.

Parsed frames are additionally memoized per season as a pickle keyed by the
event-set fingerprint, so a projection run never re-parses 1,300 JSON files.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd

from .teams import CANONICAL, normalize_nba_team

logger = logging.getLogger(__name__)

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary"

# Season types kept for modeling: regular season, postseason, play-in.
# Preseason (1) and All-Star (4, plus All-Star exhibitions ESPN files as type 2
# with non-NBA teams like STARS/STRIPES) are dropped.
MODEL_SEASON_TYPES = (2, 3, 5)
INDEX_TTL_S = 6 * 3600
NBA_DIR = "nba"
EVENTS_DIR = "nba/espn_events"

# Player-game frame schema (column order is stable for tests/consumers).
FRAME_COLUMNS = [
    "game_id", "season", "season_type", "game_date", "team", "opponent", "home",
    "player_id", "player_name", "position", "starter", "dnp", "dnp_reason",
    "minutes", "pts", "reb", "oreb", "dreb", "ast", "fg3m", "fg3a",
    "fga", "fta", "tov", "stl", "blk",
]
STAT_FIELDS = ("pts", "reb", "oreb", "dreb", "ast", "fg3m", "fg3a", "fga", "fta", "tov", "stl", "blk")


# ── helpers ─────────────────────────────────────────────────────────────────

def season_for_date(d: date) -> int:
    """ESPN season year for a calendar date (Aug-Dec belong to next year's season)."""
    return d.year + 1 if d.month >= 8 else d.year


def default_nba_seasons(as_of: date | None = None) -> list[int]:
    """The current season plus the two before it (e.g. 2025, 2026, 2027 in Oct 2026)."""
    cur = season_for_date(as_of or date.today())
    return [cur - 2, cur - 1, cur]


def _season_days(season: int, today: date | None = None) -> list[date]:
    """Every calendar day that can hold a modeled game in ``season`` (up to today)."""
    start = date(season - 1, 10, 1)
    end = date(season, 6, 30)
    today = today or date.today()
    end = min(end, today)
    if end < start:
        return []
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _season_finished(season: int, today: date | None = None) -> bool:
    return (today or date.today()) > date(season, 7, 1)


def _local_game_date(iso_utc: str | None) -> str | None:
    """ESPN dates are UTC; shift 6h so late-night ET tips stay on their US date."""
    if not iso_utc:
        return None
    try:
        dt = datetime.strptime(str(iso_utc)[:16], "%Y-%m-%dT%H:%M")
    except ValueError:
        try:
            return str(iso_utc)[:10]
        except Exception:
            return None
    return (dt - timedelta(hours=6)).date().isoformat()


def _num(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in ("", "-", "--", "—"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _made_att(v) -> tuple[float | None, float | None]:
    """'6-13' -> (6, 13)."""
    s = str(v or "").strip()
    if "-" not in s:
        return None, None
    a, _, b = s.partition("-")
    return _num(a), _num(b)


def _minutes(v) -> float | None:
    """'34' or '34:12' -> minutes as float."""
    s = str(v or "").strip()
    if ":" in s:
        mm, _, ss = s.partition(":")
        m, sec = _num(mm), _num(ss)
        if m is None:
            return None
        return m + (sec or 0) / 60.0
    return _num(s)


# ── parsing ─────────────────────────────────────────────────────────────────

def trim_summary(summary: dict) -> dict:
    """Keep only what the parser reads (header, box score, closing line)."""
    header = summary.get("header", {}) or {}
    comps = header.get("competitions") or [{}]
    comp = comps[0] if comps else {}
    t_header = {
        "id": header.get("id"),
        "season": header.get("season"),
        "competitions": [{
            "id": comp.get("id"),
            "date": comp.get("date"),
            "status": {"type": (comp.get("status") or {}).get("type")},
            "competitors": [
                {
                    "homeAway": c.get("homeAway"),
                    "score": c.get("score"),
                    "team": {"abbreviation": (c.get("team") or {}).get("abbreviation")},
                }
                for c in comp.get("competitors", []) or []
            ],
        }],
    }
    players = []
    for tb in (summary.get("boxscore") or {}).get("players", []) or []:
        stats = []
        for cat in tb.get("statistics", []) or []:
            stats.append({
                "names": cat.get("names") or cat.get("labels"),
                "keys": cat.get("keys"),
                "athletes": [
                    {
                        "athlete": {
                            "id": (a.get("athlete") or {}).get("id"),
                            "displayName": (a.get("athlete") or {}).get("displayName"),
                            "position": {"abbreviation": ((a.get("athlete") or {}).get("position") or {}).get("abbreviation")},
                        },
                        "starter": a.get("starter"),
                        "didNotPlay": a.get("didNotPlay"),
                        "reason": a.get("reason"),
                        "stats": a.get("stats"),
                    }
                    for a in cat.get("athletes", []) or []
                ],
            })
        players.append({"team": {"abbreviation": (tb.get("team") or {}).get("abbreviation")}, "statistics": stats})
    line = None
    pc = summary.get("pickcenter") or []
    if pc:
        p0 = pc[0] or {}
        line = {"spread": p0.get("spread"), "overUnder": p0.get("overUnder"), "details": p0.get("details")}
    return {"header": t_header, "boxscore": {"players": players}, "line": line}


def parse_summary(summary: dict, season_type: int | None = None) -> list[dict]:
    """One (trimmed or full) ESPN NBA summary -> per-player rows (FRAME_COLUMNS).

    DNP players are kept (``dnp=True``, minutes 0, stats None) — they are the
    rotation-role signal; the rate model excludes them.
    """
    header = summary.get("header", {}) or {}
    comp = (header.get("competitions") or [{}])[0] or {}
    competitors = comp.get("competitors", []) or []
    if len(competitors) < 2:
        return []
    home_of: dict[str, bool] = {}
    abbrs = []
    for c in competitors:
        ab = normalize_nba_team((c.get("team") or {}).get("abbreviation"))
        abbrs.append(ab)
        home_of[ab] = c.get("homeAway") == "home"
    if any(a not in CANONICAL for a in abbrs):
        return []  # All-Star / exhibition vs non-NBA teams
    opp_of = {abbrs[0]: abbrs[1], abbrs[1]: abbrs[0]}

    try:
        season = int((header.get("season") or {}).get("year") or 0) or None
    except (TypeError, ValueError):
        season = None
    if season_type is None:
        try:
            season_type = int((header.get("season") or {}).get("type") or 0) or None
        except (TypeError, ValueError):
            season_type = None
    game_id = str(header.get("id") or comp.get("id") or "")
    game_date = _local_game_date(comp.get("date"))

    rows: list[dict] = []
    for tb in (summary.get("boxscore") or {}).get("players", []) or []:
        team = normalize_nba_team((tb.get("team") or {}).get("abbreviation"))
        if team not in opp_of:
            continue
        for cat in tb.get("statistics", []) or []:
            names = [str(n).upper() for n in (cat.get("names") or cat.get("labels") or [])]
            idx = {n: i for i, n in enumerate(names)}
            for a in cat.get("athletes", []) or []:
                ath = a.get("athlete") or {}
                pid = str(ath.get("id") or "")
                if not pid:
                    continue
                stats = a.get("stats") or []
                dnp = bool(a.get("didNotPlay")) or not stats

                def get(label: str):
                    i = idx.get(label)
                    return stats[i] if i is not None and i < len(stats) else None

                minutes = 0.0 if dnp else _minutes(get("MIN"))
                fg3m, fg3a = _made_att(get("3PT"))
                _, fga = _made_att(get("FG"))
                _, fta = _made_att(get("FT"))
                row = {
                    "game_id": game_id,
                    "season": season,
                    "season_type": season_type,
                    "game_date": game_date,
                    "team": team,
                    "opponent": opp_of[team],
                    "home": home_of.get(team, False),
                    "player_id": pid,
                    "player_name": ath.get("displayName") or ath.get("shortName") or pid,
                    "position": ((ath.get("position") or {}).get("abbreviation") or "") or None,
                    "starter": bool(a.get("starter")),
                    "dnp": dnp,
                    "dnp_reason": (a.get("reason") or None) if dnp else None,
                    "minutes": minutes if minutes is not None else (0.0 if dnp else None),
                    "pts": None if dnp else _num(get("PTS")),
                    "reb": None if dnp else _num(get("REB")),
                    "oreb": None if dnp else _num(get("OREB")),
                    "dreb": None if dnp else _num(get("DREB")),
                    "ast": None if dnp else _num(get("AST")),
                    "fg3m": None if dnp else fg3m,
                    "fg3a": None if dnp else fg3a,
                    "fga": None if dnp else fga,
                    "fta": None if dnp else fta,
                    "tov": None if dnp else _num(get("TO")),
                    "stl": None if dnp else _num(get("STL")),
                    "blk": None if dnp else _num(get("BLK")),
                }
                # A played row with 0 minutes and no stats is effectively a DNP.
                if not dnp and (row["minutes"] or 0) <= 0 and not any(row[k] for k in STAT_FIELDS):
                    row["dnp"] = True
                    row["minutes"] = 0.0
                rows.append(row)
    return rows


def frame_from_rows(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=FRAME_COLUMNS)
    if df.empty:
        return df
    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    for c in ("minutes",) + STAT_FIELDS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["starter"] = df["starter"].astype(bool)
    df["dnp"] = df["dnp"].astype(bool)
    df["home"] = df["home"].astype(bool)
    df["player_id"] = df["player_id"].astype(str)
    return df


# ── network + cache ─────────────────────────────────────────────────────────

def _get_json(url: str, timeout: float = 20.0, retries: int = 2) -> dict | None:
    import requests

    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as e:  # noqa: BLE001 — tolerate network failures
            if attempt >= retries:
                logger.warning("ESPN NBA fetch failed %s: %s", url, e)
                return None
            time.sleep(0.5 * (attempt + 1))
    return None


def _day_events(d: date) -> list[dict] | None:
    data = _get_json(f"{SCOREBOARD}?dates={d.strftime('%Y%m%d')}")
    if data is None:
        return None
    out = []
    for e in data.get("events", []) or []:
        st = (e.get("season") or {}).get("type")
        status = (((e.get("status") or {}).get("type")) or {})
        out.append({
            "id": str(e.get("id") or ""),
            "date": e.get("date"),
            "season_type": st,
            "completed": bool(status.get("completed")),
        })
    return out


def _read_json(path: Path) -> dict | list | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj), encoding="utf-8")
    tmp.replace(path)


def season_index(season: int, cache_dir: str | Path, workers: int = 8, force: bool = False,
                 today: date | None = None) -> list[dict]:
    """All modeled events of ``season`` (id, date, season_type, completed)."""
    sdir = Path(cache_dir) / EVENTS_DIR / str(season)
    ipath = sdir / "_index.json"
    finished = _season_finished(season, today)
    cached = _read_json(ipath) if ipath.exists() and not force else None
    if isinstance(cached, dict) and isinstance(cached.get("events"), list):
        age = time.time() - float(cached.get("fetched_at") or 0)
        if (cached.get("finished") and cached.get("complete")) or age < INDEX_TTL_S:
            return cached["events"]

    days = _season_days(season, today)
    if not days:
        return []
    events: dict[str, dict] = {}
    failed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(_day_events, days):
            if res is None:
                failed += 1
                continue
            for e in res:
                if e["id"] and e["season_type"] in MODEL_SEASON_TYPES:
                    events[e["id"]] = e
    ev_list = sorted(events.values(), key=lambda e: (str(e.get("date")), e["id"]))
    if failed:
        logger.warning("NBA season %s: %d/%d scoreboard days failed", season, failed, len(days))
    if ev_list or not failed:
        _write_json(ipath, {
            "season": season, "fetched_at": time.time(), "finished": finished,
            "complete": failed == 0, "events": ev_list,
        })
    elif isinstance(cached, dict):
        return cached.get("events") or []
    return ev_list


def _load_event(season: int, ev: dict, sdir: Path, force: bool) -> list[dict] | None:
    path = sdir / f"{ev['id']}.json"
    summary = _read_json(path) if path.exists() and not force else None
    if summary is None:
        if not ev.get("completed"):
            return None
        full = _get_json(f"{SUMMARY}?event={ev['id']}")
        if full is None:
            return None
        summary = trim_summary(full)
        status = ((((summary.get("header") or {}).get("competitions") or [{}])[0].get("status") or {}).get("type") or {})
        if status.get("completed"):
            _write_json(path, summary)
    try:
        return parse_summary(summary, season_type=ev.get("season_type"))
    except Exception as e:  # noqa: BLE001
        logger.warning("NBA parse failed for %s: %s", ev.get("id"), e)
        return None


def fetch_nba_season(season: int, cache_dir: str | Path = "cache", workers: int = 8,
                     force: bool = False, today: date | None = None) -> pd.DataFrame:
    """Player-game frame for one ESPN season year (cached)."""
    cache_dir = Path(cache_dir)
    events = season_index(season, cache_dir, workers=workers, force=force, today=today)
    completed = [e for e in events if e.get("completed")]
    if not completed:
        return frame_from_rows([])
    sdir = cache_dir / EVENTS_DIR / str(season)
    fp = hashlib.sha1(",".join(sorted(e["id"] for e in completed)).encode()).hexdigest()[:16]
    ppath = cache_dir / NBA_DIR / f"frame_{season}.pkl"
    if ppath.exists() and not force:
        try:
            blob = pd.read_pickle(ppath)
            if isinstance(blob, dict) and blob.get("fingerprint") == fp:
                return blob["frame"]
        except Exception:
            pass
    rows: list[dict] = []
    missing = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(lambda e: _load_event(season, e, sdir, force), completed):
            if res is None:
                missing += 1
                continue
            rows.extend(res)
    if missing:
        logger.warning("NBA season %s: %d/%d events unavailable", season, missing, len(completed))
    df = frame_from_rows(rows)
    if not df.empty and missing == 0:
        try:
            ppath.parent.mkdir(parents=True, exist_ok=True)
            pd.to_pickle({"fingerprint": fp, "frame": df}, ppath)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not cache NBA frame: %s", e)
    return df


def load_nba_frame(seasons: Iterable[int], cache_dir: str | Path = "cache", workers: int = 8,
                   force: bool = False) -> pd.DataFrame:
    """Concatenate per-season frames (each already normalized by frame_from_rows)."""
    frames = []
    for s in sorted({int(x) for x in seasons}):
        logger.info("Loading ESPN NBA season %s", s)
        df = fetch_nba_season(s, cache_dir=cache_dir, workers=workers, force=force)
        if not df.empty:
            frames.append(df)
    if not frames:
        return frame_from_rows([])
    out = pd.concat(frames, ignore_index=True)
    return out.drop_duplicates(subset=["game_id", "player_id"], keep="last").reset_index(drop=True)
