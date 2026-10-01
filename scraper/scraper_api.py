"""
Player prop scraper service — Docker container that serves DraftKings player
prop lines (via Action Network's free web API) and exposes them via a REST API.

Endpoints:
  POST /scrape       — Trigger a scrape for a specific game
  GET  /results       — Get latest scraped results
  GET  /health        — Health check
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Player Prop Scraper", version="1.0.0")

# In-memory storage for scraped data
_scraper_results: Dict[str, Any] = {}
_last_scrape_time: Optional[datetime] = None
_scrape_in_progress: bool = False

# Disk persistence + per-game refresh history. The container previously kept
# everything in memory, so each restart wiped the lines and the hourly
# pre-game refreshes had nothing to accumulate against. Snapshots persist as
# JSON under SCRAPER_DATA_DIR (mount a volume there to survive restarts);
# history keeps one lightweight entry per refresh (timestamp + counts) plus
# the full latest payload, capped so a long pre-game week can't grow the file.
DATA_DIR = os.environ.get("SCRAPER_DATA_DIR", "/app/data")
RESULTS_FILE = os.path.join(DATA_DIR, "results.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
MAX_HISTORY_PER_GAME = 200
_scraper_history: Dict[str, list] = {}


def _game_key(team: str, opponent: str, game_date: str, sport: str = "NFL") -> str:
    return f"{(sport or 'NFL').upper()}_{team.upper()}_{opponent.upper()}_{game_date}"


def _load_persisted() -> None:
    global _scraper_results, _last_scrape_time, _scraper_history
    try:
        if os.path.exists(RESULTS_FILE):
            with open(RESULTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                _scraper_results = data.get("results", {})
                last = data.get("last_scrape")
                _last_scrape_time = datetime.fromisoformat(last) if last else None
                logger.info(f"Loaded {len(_scraper_results)} persisted scrape results")
    except Exception as e:
        logger.warning(f"Persisted results load failed: {str(e)[:120]}")
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                _scraper_history = {k: v for k, v in data.items() if isinstance(v, list)}
                logger.info(f"Loaded history for {len(_scraper_history)} games")
    except Exception as e:
        logger.warning(f"Persisted history load failed: {str(e)[:120]}")


def _save_persisted() -> None:
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = RESULTS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"results": _scraper_results,
                       "last_scrape": _last_scrape_time.isoformat() if _last_scrape_time else None}, f)
        os.replace(tmp, RESULTS_FILE)
        tmp = HISTORY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_scraper_history, f)
        os.replace(tmp, HISTORY_FILE)
    except Exception as e:
        logger.warning(f"Persisted save failed: {str(e)[:120]}")


def _record_history(team: str, opponent: str, game_date: str,
                    entry: Dict[str, Any], sport: str = "NFL") -> None:
    """Append one lightweight refresh record for a game (capped)."""
    key = _game_key(team, opponent, game_date, sport)
    hist = _scraper_history.get(key) or []
    results = entry.get("results") or {}
    hist.append({
        "scrape_time": entry.get("scrape_time"),
        "total_props": entry.get("total_props", 0),
        "books": {b: (d or {}).get("count", 0) for b, d in results.items()},
    })
    if len(hist) > MAX_HISTORY_PER_GAME:
        hist = hist[-MAX_HISTORY_PER_GAME:]
    _scraper_history[key] = hist


_load_persisted()

# DraftKings is the only book served. Action Network labels its book "DK NJ"
# (via /web/v1/books); The Odds API labels it "draftkings". Everything else
# (Consensus aggregates, FanDuel, BetMGM, …) is dropped at the source so the
# hourly refresh and the panel grade against one consistent board.
DK_BOOK_RE = re.compile(r"draftkings|(^|\s)dk(\s|$)", re.IGNORECASE)

# The Odds API — server-to-server JSON, no bot wall. Used as the primary
# source when ODDS_API_KEY is set (same key as the Next.js /api/props route).
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "").strip()

# Per-league config. `action` is the Action Network scoreboard league path,
# `odds_sport` the Odds API sport key, `abbr_aliases` maps non-standard ESPN
# abbreviations to the board's canonical ones (NBA is the main offender).
LEAGUES: Dict[str, Dict[str, Any]] = {
    "NFL": {
        "action": "nfl",
        "odds_sport": "americanfootball_nfl",
        "odds_markets": (
            "player_pass_yds,player_pass_tds,player_rush_yds,"
            "player_rush_attempts,player_reception_yds,player_receptions,player_anytime_td"
        ),
        "odds_stat_map": {
            "player_pass_yds": "passing_yards",
            "player_pass_tds": "passing_tds",
            "player_pass_attempts": "passing_attempts",
            "player_pass_completions": "passing_yards",
            "player_pass_interceptions": "passing_yards",
            "player_rush_yds": "rushing_yards",
            "player_rush_attempts": "rushing_yards",
            "player_rush_tds": "tds",
            "player_reception_yds": "receiving_yards",
            "player_receptions": "receptions",
            "player_reception_tds": "tds",
            "player_anytime_td": "tds",
        },
        "action_keywords": [
            ("receiving_yards", "receiving_yards"),
            ("rushing_yards", "rushing_yards"),
            ("passing_yards", "passing_yards"),
            ("pass_yards", "passing_yards"),
            ("receptions", "receptions"),
            ("pass_completions", "completions"),
            ("completions", "completions"),
            ("passing_tds", "passing_tds"),
            ("pass_tds", "passing_tds"),
            ("rushing_tds", "tds"),
            ("receiving_tds", "tds"),
            ("anytime_touchdown", "tds"),
            ("anytime_td", "tds"),
            ("passing_attempts", "passing_attempts"),
            ("rushing_attempts", "rushing_attempts"),
            ("interceptions", "interceptions"),
            ("sacks", "sacks"),
        ],
        "abbr_aliases": {},
        "teams": {
            "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
            "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
            "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
            "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
            "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
            "KC": "Kansas City Chiefs", "LV": "Las Vegas Raiders", "LAC": "Los Angeles Chargers",
            "LAR": "Los Angeles Rams", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
            "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
            "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
            "SF": "San Francisco 49ers", "SEA": "Seattle Seahawks", "TB": "Tampa Bay Buccaneers",
            "TEN": "Tennessee Titans", "WSH": "Washington Commanders",
        },
    },
    "NBA": {
        "action": "nba",
        "odds_sport": "basketball_nba",
        "odds_markets": "player_points,player_rebounds,player_assists,player_threes",
        "odds_stat_map": {
            "player_points": "points",
            "player_rebounds": "rebounds",
            "player_assists": "assists",
            "player_threes": "threes",
        },
        # Combos/milestones first: they contain clean-stat substrings
        # ("points" inside "points_rebounds_assists") but are separate markets
        # the projections never model, so they must not map to clean stats.
        "action_keywords": [
            ("points_rebounds_assists", "points_rebounds_assists"),
            ("points_rebounds", "points_rebounds"),
            ("points_assists", "points_assists"),
            ("rebounds_assists", "rebounds_assists"),
            ("steals_blocks", "steals_blocks"),
            ("triple-double", "triple_double"),
            ("triple_double", "triple_double"),
            ("double-double", "double_double"),
            ("double_double", "double_double"),
            ("milestones", "milestones"),
            ("to_record", "to_record"),
            ("first_basket", "first_basket"),
            ("first_fg", "first_fg"),
            ("points", "points"),
            ("rebounds", "rebounds"),
            ("rebs", "rebounds"),
            ("assists", "assists"),
            ("3fgm", "threes"),
            ("steals", "steals"),
            ("blocks", "blocks"),
            ("turnovers", "turnovers"),
            ("3fga", "fg_attempts"),
            ("ftm", "ft_made"),
            ("fta", "ft_attempts"),
        ],
        "abbr_aliases": {"NY": "NYK", "GS": "GSW", "SA": "SAS", "NO": "NOP"},
        "teams": {
            "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
            "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
            "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
            "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
            "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
            "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
            "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
            "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
            "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
            "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
        },
    },
    "NHL": {
        "action": "nhl",
        "odds_sport": "icehockey_nhl",
        "odds_markets": "player_points,player_shots_on_goal,player_goals,player_total_saves",
        "odds_stat_map": {
            "player_points": "points",
            "player_shots_on_goal": "shots",
            "player_goals": "goals",
            "player_total_saves": "saves",
        },
        "action_keywords": [
            ("milestones", "milestones"),
            ("to_record", "to_record"),
            ("to_score", "to_score"),
            ("powerplay_points", "powerplay_points"),
            ("first_goal", "first_goal"),
            ("last_goal", "last_goal"),
            ("anytime_goal", "anytime_goal"),
            ("goal_scorer", "goal_scorer"),
            ("shots_on_goal", "shots"),
            ("goaltender_saves", "saves"),
            ("points", "points"),
            ("goals", "goals"),
            ("assists", "assists"),
            ("blocks", "blocks"),
        ],
        "abbr_aliases": {},
        "teams": {
            "ANA": "Anaheim Ducks", "BOS": "Boston Bruins", "BUF": "Buffalo Sabres",
            "CAR": "Carolina Hurricanes", "CBJ": "Columbus Blue Jackets", "CGY": "Calgary Flames",
            "CHI": "Chicago Blackhawks", "COL": "Colorado Avalanche", "DAL": "Dallas Stars",
            "DET": "Detroit Red Wings", "EDM": "Edmonton Oilers", "FLA": "Florida Panthers",
            "LA": "Los Angeles Kings", "MIN": "Minnesota Wild", "MTL": "Montreal Canadiens",
            "NJ": "New Jersey Devils", "NSH": "Nashville Predators", "NYI": "New York Islanders",
            "NYR": "New York Rangers", "OTT": "Ottawa Senators", "PHI": "Philadelphia Flyers",
            "PIT": "Pittsburgh Penguins", "SJ": "San Jose Sharks", "SEA": "Seattle Kraken",
            "STL": "St. Louis Blues", "TB": "Tampa Bay Lightning", "TOR": "Toronto Maple Leafs",
            "VAN": "Vancouver Canucks", "VGK": "Vegas Golden Knights", "WSH": "Washington Capitals",
            "WPG": "Winnipeg Jets", "UTA": "Utah Mammoth",
        },
    },
    "MLB": {
        "action": "mlb",
        "odds_sport": "baseball_mlb",
        "odds_markets": "batter_hits,batter_total_bases,batter_rbis,batter_home_runs,pitcher_strikeouts",
        "odds_stat_map": {
            "batter_hits": "hits",
            "batter_total_bases": "total_bases",
            "batter_rbis": "rbis",
            "batter_home_runs": "home_runs",
            "pitcher_strikeouts": "strikeouts",
        },
        # Hitter Ks vs pitcher Ks and hits-allowed vs hits are different
        # markets sharing substrings — order keeps them distinct.
        "action_keywords": [
            ("milestones", "milestones"),
            ("to_record", "to_record"),
            ("to_hit", "to_hit"),
            ("hits_runs_rbis", "hits_runs_rbis"),
            ("hits_allowed", "hits_allowed"),
            ("hitter_strikeouts", "hitter_strikeouts"),
            ("hitter_walks", "hitter_walks"),
            ("total_bases", "total_bases"),
            ("strikeouts", "strikeouts"),
            ("hits", "hits"),
            ("runs_scored", "runs_scored"),
            ("stolen_bases", "stolen_bases"),
            ("pitching_outs", "outs"),
            ("earned_runs", "earned_runs"),
            ("walks", "walks"),
            ("singles", "singles"),
            ("doubles", "doubles"),
            ("triples", "triples"),
            ("rbi", "rbis"),
            ("hr", "home_runs"),
        ],
        "abbr_aliases": {"CHW": "CWS", "ATH": "SAC"},
        "teams": {
            "ARI": "Arizona Diamondbacks", "ATL": "Atlanta Braves", "BAL": "Baltimore Orioles",
            "BOS": "Boston Red Sox", "CHC": "Chicago Cubs", "CWS": "Chicago White Sox",
            "CIN": "Cincinnati Reds", "CLE": "Cleveland Guardians", "COL": "Colorado Rockies",
            "DET": "Detroit Tigers", "HOU": "Houston Astros", "KC": "Kansas City Royals",
            "LAA": "Los Angeles Angels", "LAD": "Los Angeles Dodgers", "MIA": "Miami Marlins",
            "MIL": "Milwaukee Brewers", "MIN": "Minnesota Twins", "NYY": "New York Yankees",
            "NYM": "New York Mets", "SAC": "Sacramento Athletics", "PHI": "Philadelphia Phillies",
            "PIT": "Pittsburgh Pirates", "SD": "San Diego Padres", "SEA": "Seattle Mariners",
            "SF": "San Francisco Giants", "STL": "St. Louis Cardinals", "TB": "Tampa Bay Rays",
            "TEX": "Texas Rangers", "TOR": "Toronto Blue Jays", "WSH": "Washington Nationals",
        },
    },
}


def league_of(sport: str) -> Dict[str, Any]:
    """Resolve a sport string to its league config (default NFL)."""
    return LEAGUES.get((sport or "NFL").upper(), LEAGUES["NFL"])


def canon_abbr(abbr: str, league: Dict[str, Any]) -> str:
    """Canonical board abbreviation (folds ESPN variants like NY -> NYK)."""
    up = (abbr or "").upper()
    return league.get("abbr_aliases", {}).get(up, up)

def _parse_odds_line(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# Action Network — free, no key, datacenter-friendly. The web API backing their
# props tab: scoreboard resolves the game id, then the v2 props endpoint
# returns the full player-prop slate with per-book over/under lines.
ACTION_API = "https://api.actionnetwork.com"
ACTION_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
ACTION_STATE = "NJ"

_action_books_cache: Optional[Dict[str, str]] = None


def _action_get(path: str) -> Any:
    import urllib.request
    req = urllib.request.Request(ACTION_API + path, headers={"User-Agent": ACTION_UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _action_stat_key(market_type: str, league: Dict[str, Any]) -> str:
    t = market_type.lower()
    for kw, stat in league.get("action_keywords", []):
        if kw in t:
            return stat
    tail = t.split("core_bet_type_")[-1]
    return re.sub(r"^\d+_", "", tail) or t


def fetch_action_props(team: str, opponent: str, game_date: str,
                       sport: str = "NFL", game_time: Optional[str] = None) -> Dict[str, Any]:
    """DraftKings player-prop slate via Action Network's free web API."""
    global _action_books_cache
    league = league_of(sport)
    want = {canon_abbr(team, league), canon_abbr(opponent, league)}

    board = _action_get(f"/web/v1/scoreboard/{league['action']}?period=game")
    games = board.get("games", []) if isinstance(board, dict) else []
    cands = []
    for g in games:
        abbrs = {canon_abbr(t.get("abbr", ""), league) for t in g.get("teams", [])}
        if abbrs == want:
            cands.append(g)
    if not cands:
        raise RuntimeError(f"no Action Network game for {team} vs {opponent}")
    day = game_date if len(game_date) == 8 else re.sub(r"\D", "", game_date)[:8]
    same_day = [g for g in cands if str(g.get("start_time", ""))[:10].replace("-", "") == day]
    pool = same_day or cands
    if len(pool) > 1 and game_time:
        # Same-teams doubleheaders (MLB): pick the slate closest to first pitch.
        try:
            from datetime import datetime as _dt
            want_dt = _dt.fromisoformat(str(game_time).replace("Z", "+00:00"))
            pool = sorted(pool, key=lambda g: abs(
                (_dt.fromisoformat(str(g.get("start_time", "")).replace("Z", "+00:00")) - want_dt).total_seconds()))
        except (ValueError, TypeError):
            pass
    game = next((g for g in pool if str(g.get("start_time", ""))[:10].replace("-", "") == day), pool[0])
    game_id = game["id"]
    team_map = {t["id"]: canon_abbr(t.get("abbr", ""), league) for t in game.get("teams", [])}

    if _action_books_cache is None:
        try:
            books_raw = _action_get("/web/v1/books")
            books_list = books_raw if isinstance(books_raw, list) else books_raw.get("books", [])
            _action_books_cache = {str(b["id"]): b.get("display_name") or f"book_{b['id']}" for b in books_list}
        except Exception as e:
            logger.warning(f"Action books map failed: {str(e)[:100]}")
            _action_books_cache = {}
    book_name = lambda bid: (_action_books_cache or {}).get(str(bid), f"book_{bid}")

    data = _action_get(f"/web/v2/games/{game_id}/props?stateCode={ACTION_STATE}")
    players_raw = data.get("players", [])
    if isinstance(players_raw, dict):
        players = {}
        for k, p in players_raw.items():
            try:
                players[int(k)] = p
            except (TypeError, ValueError):
                pass
            try:
                players[int(p.get("id", -1))] = p
            except (TypeError, ValueError):
                pass
    else:
        players = {}
        for p in players_raw or []:
            try:
                players[int(p.get("id"))] = p
            except (TypeError, ValueError):
                continue
    label_by_type = {m.get("type", ""): m.get("name", "") for m in data.get("prop_order", [])}

    now = datetime.now().isoformat()
    books: Dict[str, list] = {}
    for market_type, markets in (data.get("player_props", {}) or {}).items():
        label = label_by_type.get(market_type, market_type)
        stat = _action_stat_key(market_type, league)
        for m in markets or []:
            for bid, outcomes in (m.get("lines", {}) or {}).items():
                grouped: Dict[str, dict] = {}
                for o in outcomes or []:
                    if o.get("line_status") not in (None, "normal"):
                        continue
                    line = _parse_odds_line(o.get("value"))
                    if line is None:
                        continue
                    g = grouped.setdefault(f"{o.get('player_id')}::{line}",
                                           {"over": None, "under": None})
                    if o.get("side") == "over":
                        g["over"] = o.get("odds")
                    elif o.get("side") == "under":
                        g["under"] = o.get("odds")
                for key, prices in grouped.items():
                    pid_s, _, line_s = key.partition("::")
                    try:
                        pid = int(pid_s)
                    except (TypeError, ValueError):
                        continue
                    pl = players.get(pid, {})
                    pname = pl.get("full_name") or pl.get("abbr") or f"player_{pid}"
                    books.setdefault(book_name(bid), []).append({
                        "player": pname,
                        "stat": stat,
                        "market": label,
                        "line": float(line_s),
                        "over": prices["over"],
                        "under": prices["under"],
                        "sportsbook": book_name(bid),
                        "team": team_map.get(pl.get("team_id"), team),
                        "timestamp": now,
                    })

    results = {}
    for bk, props in books.items():
        # DraftKings only — every other book is dropped at the source.
        if not DK_BOOK_RE.search(bk):
            continue
        results[bk] = {"props": props, "count": len(props),
                       "timestamp": now, "source": "action-network"}
    if not results:
        raise RuntimeError("Action Network returned no DraftKings lines for this game")
    return results


async def fetch_odds_api_props(team: str, opponent: str, game_date: str,
                               sport: str = "NFL") -> Dict[str, Any]:
    """DraftKings player prop lines from The Odds API (requires ODDS_API_KEY)."""
    import urllib.request
    import urllib.parse

    league = league_of(sport)
    odds_base = f"https://api.the-odds-api.com/v4/sports/{league['odds_sport']}"
    stat_map = league.get("odds_stat_map", {})

    def get_json(url: str) -> Any:
        req = urllib.request.Request(url, headers={"User-Agent": "Fanspot-scraper/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())

    team_full = league.get("teams", {}).get(canon_abbr(team, league), team)
    opp_full = league.get("teams", {}).get(canon_abbr(opponent, league), opponent)
    day = f"{game_date[:4]}-{game_date[4:6]}-{game_date[6:8]}" if len(game_date) == 8 else game_date

    events = get_json(f"{odds_base}/events?apiKey={ODDS_API_KEY}")
    event_id = None
    for ev in events if isinstance(events, list) else []:
        home, away = ev.get("home_team", ""), ev.get("away_team", "")
        if {home, away} == {team_full, opp_full}:
            event_id = ev.get("id")
            break
        if day and day in str(ev.get("commence_time", "")) and team_full in (home, away):
            event_id = ev.get("id")
    if not event_id:
        raise RuntimeError(f"no Odds API event for {team_full} vs {opp_full} on {day}")

    qs = urllib.parse.urlencode({
        "apiKey": ODDS_API_KEY,
        "regions": "us",
        "markets": league.get("odds_markets", ""),
        "oddsFormat": "american",
    })
    event = get_json(f"{odds_base}/events/{event_id}/odds?{qs}")

    books: Dict[str, list] = {}
    now = datetime.now().isoformat()
    for bm in event.get("bookmakers", []) or []:
        book_key = str(bm.get("key", "unknown"))
        for m in bm.get("markets", []) or []:
            stat = stat_map.get(m.get("key", ""), m.get("key", ""))
            grouped: Dict[str, dict] = {}
            for o in m.get("outcomes", []) or []:
                line = _parse_odds_line(o.get("point"))
                if line is None or not o.get("name"):
                    continue
                g = grouped.setdefault(f"{o['name']}::{line}", {"over": None, "under": None})
                desc = str(o.get("description", "")).lower()
                if "over" in desc:
                    g["over"] = o.get("price")
                elif "under" in desc:
                    g["under"] = o.get("price")
                elif g["over"] is None:
                    g["over"] = o.get("price")
                elif g["under"] is None:
                    g["under"] = o.get("price")
            for name_line, prices in grouped.items():
                name, _, line_s = name_line.partition("::")
                books.setdefault(book_key, []).append({
                    "player": name,
                    "stat": stat,
                    "market": m.get("key", ""),
                    "line": float(line_s),
                    "over": prices["over"],
                    "under": prices["under"],
                    "sportsbook": book_key,
                    "team": team,
                    "timestamp": now,
                })

    results = {}
    for book_key, props in books.items():
        # DraftKings only — every other book is dropped at the source.
        if not DK_BOOK_RE.search(book_key):
            continue
        results[book_key] = {"props": props, "count": len(props),
                             "timestamp": now, "source": "odds-api"}
    if not results:
        raise RuntimeError("Odds API returned no DraftKings lines for this event")
    return results


async def scrape_all_sportsbooks(team: str, opponent: str, game_date: str,
                                  sport: str = "NFL", game_time: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch DraftKings player props for a game.
    Returns a dictionary with the DraftKings result entry.
    """
    global _scrape_in_progress, _last_scrape_time

    if _scrape_in_progress:
        return {"status": "scrape_in_progress", "message": "A scrape is already in progress"}

    _scrape_in_progress = True
    results = {}
    sport = (sport or "NFL").upper()

    try:
        logger.info(f"Starting {sport} scrape for {team} vs {opponent} on {game_date}")

        # Primary: Action Network (free web API, DraftKings lines, no key).
        # Then The Odds API when keyed (DraftKings bookmaker only). The old
        # Playwright per-book page rendering was removed: the books bot-block
        # datacenter IPs, so it never returned lines.
        results = {}
        for source in ("action-network",):
            try:
                results = await asyncio.to_thread(fetch_action_props, team, opponent,
                                                  game_date, sport, game_time)
                logger.info(f"{source} returned {sum(r.get('count', 0) for r in results.values())} props")
                break
            except Exception as e:
                logger.warning(f"{source} failed: {str(e)[:160]}")
                results = {}
        if not results and ODDS_API_KEY:
            try:
                results = await asyncio.to_thread(fetch_odds_api_props, team, opponent,
                                                  game_date, sport)
                logger.info(f"Odds API returned {sum(r.get('count', 0) for r in results.values())} props")
            except Exception as e:
                logger.warning(f"Odds API failed: {str(e)[:160]}")
                results = {}

        if not results:
            raise HTTPException(status_code=502, detail="No DraftKings lines available for this game")

        # Store results under the sport-scoped game key (SPORT_TEAM_OPP_DATE —
        # bare TEAM_OPP_DATE collides across leagues, e.g. NBA/MLB MIA/TOR).
        # The legacy date-keyed copy stays for the ?date= lookup.
        key = _game_key(team, opponent, game_date, sport)
        _scraper_results[key] = {
            "team": team,
            "opponent": opponent,
            "game_date": game_date,
            "sport": sport,
            "results": results,
            "total_props": sum(r.get("count", 0) for r in results.values()),
            "scrape_time": datetime.now().isoformat(),
        }
        _scraper_results[game_date] = _scraper_results[key]
        _record_history(team, opponent, game_date, _scraper_results[key], sport)
        _save_persisted()
        _last_scrape_time = datetime.now()

        logger.info(f"Scrape complete: {_scraper_results[key]['total_props']} total props")
        return _scraper_results[key]
        
    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        raise HTTPException(status_code=500, detail=f"Scrape failed: {str(e)}")
    finally:
        _scrape_in_progress = False


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "last_scrape": _last_scrape_time.isoformat() if _last_scrape_time else None,
        "scrape_in_progress": _scrape_in_progress,
        "sportsbooks": ["draftkings"],
        "odds_api": bool(ODDS_API_KEY),
    }


@app.post("/scrape")
async def trigger_scrape(game: Dict[str, str]):
    """
    Trigger a scrape for a specific game.
    
    Request body:
    {
        "team": "NE",
        "opponent": "SEA",
        "game_date": "20260913",
        "sport": "NFL"
    }
    """
    team = game.get("team", "").upper()
    opponent = game.get("opponent", "").upper()
    game_date = game.get("game_date", "")
    sport = (game.get("sport", "") or "NFL").upper()
    game_time = game.get("game_time")

    if not team or not opponent or not game_date:
        raise HTTPException(
            status_code=400,
            detail="Missing required fields: team, opponent, game_date"
        )
    if sport not in LEAGUES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported sport: {sport} (one of {', '.join(sorted(LEAGUES))})"
        )

    return await scrape_all_sportsbooks(team, opponent, game_date, sport, game_time)


@app.get("/results")
async def get_results(date: Optional[str] = None, game: Optional[str] = None):
    """
    Get scraped results.

    Query params:
    - date: Filter by game date (YYYYMMDD)
    - game: Filter by game key (SPORT_TEAM_OPP_YYYYMMDD, legacy bare
      TEAM_OPP_YYYYMMDD also resolves) — includes the hourly refresh history
      for that game when present.
    """
    if game and game in _scraper_results:
        out = dict(_scraper_results[game])
        if game in _scraper_history:
            out["history"] = _scraper_history[game]
        return out
    if date and date in _scraper_results:
        return _scraper_results[date]
    elif date or game:
        return {"error": f"No results found for {'game ' + game if game else 'date ' + str(date)}"}
    else:
        return {
            "results": _scraper_results,
            "last_scrape": _last_scrape_time.isoformat() if _last_scrape_time else None,
            "total_games": len(_scraper_results),
        }


@app.get("/history")
async def get_history(game: str):
    """Hourly refresh history for one game key (SPORT_TEAM_OPP_YYYYMMDD)."""
    hist = _scraper_history.get(game)
    if hist is None:
        return {"error": f"No history found for game {game}"}
    return {"game": game, "refreshes": len(hist), "history": hist}


@app.post("/scrape/multiple")
async def trigger_scrape_multiple(games: List[Dict[str, str]]):
    """
    Trigger scrapes for multiple games concurrently.
    
    Request body:
    [
        {"team": "NE", "opponent": "SEA", "game_date": "20260913"},
        {"team": "BUF", "opponent": "HOU", "game_date": "20260913", "sport": "NFL"},
        ...
    ]
    """
    if not games:
        raise HTTPException(status_code=400, detail="No games provided")

    tasks = [
        scrape_all_sportsbooks(g.get("team", ""), g.get("opponent", ""), g.get("game_date", ""),
                               g.get("sport", "NFL"), g.get("game_time"))
        for g in games
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    output = {}
    for i, result in enumerate(results):
        game_key = _game_key(games[i].get("team", ""), games[i].get("opponent", ""),
                             games[i].get("game_date", ""), games[i].get("sport", "NFL"))
        if isinstance(result, Exception):
            output[game_key] = {"error": str(result)}
        else:
            output[game_key] = result
    
    return output


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
