"""
Player prop scraper service — Docker container that scrapes real betting lines
from sportsbook sites (BetMGM, DraftKings, FanDuel, etc.) and exposes them via
a REST API.

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
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from playwright.async_api import Browser, async_playwright

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Player Prop Scraper", version="1.0.0")

# In-memory storage for scraped data
_scraper_results: Dict[str, Any] = {}
_last_scrape_time: Optional[datetime] = None
_scrape_in_progress: bool = False

# Target sportsbooks to scrape via Playwright (best-effort: these books
# bot-block datacenter IPs, so expect per-book errors without residential egress)
SPORTSBOOKS = ["betmgm", "draftkings", "fanduel", "caesars"]

# The Odds API — server-to-server JSON, no bot wall. Used as the primary
# source when ODDS_API_KEY is set (same key as the Next.js /api/props route).
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "").strip()
ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
ODDS_PROP_MARKETS = (
    "player_pass_yds,player_pass_tds,player_rush_yds,"
    "player_rush_attempts,player_reception_yds,player_receptions,player_anytime_td"
)
ODDS_MARKET_TO_STAT = {
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
}

# ESPN abbr -> full name for matching Odds API events (home_team/away_team).
NFL_TEAMS = {
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
}

# Player prop stat patterns (what we're looking for)
PROP_PATTERNS = [
    r"(\w+\.\s*\w+)\s+(?:receiving|rushing|passing|rec|rush|pass)?\s*(?:yards|yds|yd)?\s*(?:over|under|o/u|o|u)?\s*\d+",
    r"(\w+\.\s*\w+)\s+\d+\s+(?:over|under|pts|yds|rec)",
]


def normalize_stat_name(stat: str) -> str:
    """Normalize stat names to a standard format."""
    stat_lower = stat.lower().strip()
    replacements = {
        "receiving_yards": "rec_yds",
        "rushing_yards": "rush_yds",
        "passing_yards": "pass_yds",
        "receptions": "receptions",
        "touchdowns": "tds",
        "passing_tds": "pass_tds",
        "rushing_tds": "rush_tds",
        "receiving_tds": "rec_tds",
        "rushing_attempts": "rush_att",
        "passing_attempts": "pass_att",
        "yards_per_carry": "yds/carry",
        "yards_per_reception": "yds/rec",
    }
    for key, value in replacements.items():
        if key in stat_lower:
            return value
    return stat_lower


SPORTSBOOK_URLS = {
    "betmgm": "https://www.betmgm.com/en/sports/football-usa/nfl/odds/player-props",
    "draftkings": "https://www.draftkings.com/sports/football/nfl/odds/player-props",
    "fanduel": "https://sports.fanduel.com/nfl/odds/player-props",
    "caesars": "https://www.caesars.com/sports/football/nfl/odds/player-props",
}

SPORTSBOOK_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def scrape_sportsbook(browser: Browser, sportsbook: str, team: str, opponent: str, game_date: str) -> tuple[list, Optional[str]]:
    """
    Render a sportsbook's player-props page in headless Chromium and extract
    player props from the rendered DOM text. The books are JS SPAs behind bot
    defences, so plain HTTP fetches return empty shells — hence Playwright.
    Returns (props, error).
    """
    url = SPORTSBOOK_URLS.get(sportsbook)
    if not url:
        return [], f"no URL configured for {sportsbook}"

    context = await browser.new_context(
        user_agent=SPORTSBOOK_UA,
        viewport={"width": 1366, "height": 900},
        locale="en-US",
    )
    try:
        page = await context.new_page()
        await page.goto(url, timeout=45_000, wait_until="domcontentloaded")
        await page.wait_for_timeout(4_000)
        html = await page.content()
        props = extract_player_props(html, team, opponent, sportsbook)
        if not props:
            return [], "page rendered but no prop text matched (bot wall or empty slate)"
        return props, None
    except Exception as e:
        err = str(e).split("\n")[0][:160]
        logger.error(f"Error scraping {sportsbook}: {err}")
        return [], err
    finally:
        await context.close()


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

ACTION_STAT_KEYWORDS = [
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
]

_action_books_cache: Optional[Dict[str, str]] = None


def _action_get(path: str) -> Any:
    import urllib.request
    req = urllib.request.Request(ACTION_API + path, headers={"User-Agent": ACTION_UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _action_stat_key(market_type: str) -> str:
    t = market_type.lower()
    for kw, stat in ACTION_STAT_KEYWORDS:
        if kw in t:
            return stat
    tail = t.split("core_bet_type_")[-1]
    return re.sub(r"^\d+_", "", tail) or t


def fetch_action_props(team: str, opponent: str, game_date: str) -> Dict[str, Any]:
    """Full player-prop slate via Action Network's free web API."""
    global _action_books_cache
    want = {team.upper(), opponent.upper()}

    board = _action_get("/web/v1/scoreboard/nfl?period=game")
    games = board.get("games", []) if isinstance(board, dict) else []
    cands = []
    for g in games:
        abbrs = {t.get("abbr", "").upper() for t in g.get("teams", [])}
        if abbrs == want:
            cands.append(g)
    if not cands:
        raise RuntimeError(f"no Action Network game for {team} vs {opponent}")
    day = game_date if len(game_date) == 8 else re.sub(r"\D", "", game_date)[:8]
    game = next((g for g in cands if str(g.get("start_time", ""))[:10].replace("-", "") == day), cands[0])
    game_id = game["id"]
    team_map = {t["id"]: t.get("abbr", "").upper() for t in game.get("teams", [])}

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
        stat = _action_stat_key(market_type)
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
        results[bk] = {"props": props, "count": len(props),
                       "timestamp": now, "source": "action-network"}
    if not results:
        raise RuntimeError("Action Network returned no player markets for this game")
    return results


async def fetch_odds_api_props(team: str, opponent: str, game_date: str) -> Dict[str, Any]:
    """Fetch real player prop lines from The Odds API (requires ODDS_API_KEY)."""
    import urllib.request
    import urllib.parse

    def get_json(url: str) -> Any:
        req = urllib.request.Request(url, headers={"User-Agent": "Fanspot-scraper/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())

    team_full = NFL_TEAMS.get(team.upper(), team)
    opp_full = NFL_TEAMS.get(opponent.upper(), opponent)
    day = f"{game_date[:4]}-{game_date[4:6]}-{game_date[6:8]}" if len(game_date) == 8 else game_date

    events = get_json(f"{ODDS_API_BASE}/events?apiKey={ODDS_API_KEY}")
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
        "markets": ODDS_PROP_MARKETS,
        "oddsFormat": "american",
    })
    event = get_json(f"{ODDS_API_BASE}/events/{event_id}/odds?{qs}")

    books: Dict[str, list] = {}
    now = datetime.now().isoformat()
    for bm in event.get("bookmakers", []) or []:
        book_key = str(bm.get("key", "unknown"))
        for m in bm.get("markets", []) or []:
            stat = ODDS_MARKET_TO_STAT.get(m.get("key", ""), m.get("key", ""))
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
        results[book_key] = {"props": props, "count": len(props),
                             "timestamp": now, "source": "odds-api"}
    if not results:
        raise RuntimeError("Odds API returned no player markets for this event")
    return results


def extract_player_props(html: str, team: str, opponent: str, sportsbook: str = "betmgm") -> List[Dict[str, Any]]:
    """
    Extract player props from HTML content.
    Returns a list of player prop dictionaries.
    """
    props = []
    
    # Try multiple regex patterns
    patterns = [
        # Pattern: "Player Name - Stat - Over/Under - Line"
        r'(\w+\.\s*\w+)\s*[-–]\s*(?:receiving|rushing|passing|rec|rush|pass)\s*(?:yards|yds|yd)\s*[-–]\s*(?:over|under|o/u|o|u)\s*(\d+\.?\d*)',
        # Pattern: "Player Name - Stat - Line"
        r'(\w+\.\s*\w+)\s*[-–]\s*(?:receiving|rushing|passing|rec|rush|pass)\s*(?:yards|yds|yd)\s*[-–]\s*(\d+\.?\d*)',
        # Pattern: "Player Name - Stat - TDs"
        r'(\w+\.\s*\w+)\s*[-–]\s*(?:receiving|rushing|passing|rec|rush|pass)\s*(?:yards|yds|yd)\s*[-–]\s*(?:td|touchdown)',
    ]
    
    for pattern in patterns:
        matches = re.finditer(pattern, html, re.IGNORECASE)
        for match in matches:
            player_name = match.group(1).strip()
            stat_value = float(match.group(2))
            
            props.append({
                "player": player_name,
                "stat": "receiving_yards",  # Default, will be refined
                "line": stat_value,
                "sportsbook": sportsbook,
                "team": team,
                "timestamp": datetime.now().isoformat(),
            })
    
    # If no props found with regex, try BeautifulSoup
    if not props:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, 'lxml')
            # Look for player prop cards/tables
            for element in soup.find_all(['div', 'tr', 'td']):
                text = element.get_text()
                if any(kw in text.lower() for kw in ['rec yds', 'rush yds', 'pass yds', 'receptions', 'touchdown']):
                    # Extract player name and line
                    player_match = re.search(r'([\w\.]+\s+[\w\.]+)', text)
                    line_match = re.search(r'(\d+\.?\d*)', text)
                    if player_match and line_match:
                        player_name = player_match.group(1).strip()
                        line_value = float(line_match.group(1))
                        
                        # Determine stat type from context
                        stat = "receiving_yards"
                        if "rush" in text.lower():
                            stat = "rushing_yards"
                        elif "pass" in text.lower():
                            stat = "passing_yards"
                        
                        props.append({
                            "player": player_name,
                            "stat": stat,
                            "line": line_value,
                            "sportsbook": sportsbook,
                            "team": team,
                            "timestamp": datetime.now().isoformat(),
                        })
        except ImportError:
            logger.warning("BeautifulSoup not available")
    
    return props


async def scrape_all_sportsbooks(team: str, opponent: str, game_date: str) -> Dict[str, Any]:
    """
    Scrape player props from all sportsbooks concurrently.
    Returns a dictionary with results from each sportsbook.
    """
    global _scrape_in_progress, _last_scrape_time

    if _scrape_in_progress:
        return {"status": "scrape_in_progress", "message": "A scrape is already in progress"}

    _scrape_in_progress = True
    results = {}

    try:
        logger.info(f"Starting scrape for {team} vs {opponent} on {game_date}")

        # Primary: Action Network (free web API, full slate, per-book lines).
        # Then The Odds API when keyed. Fallback: best-effort Playwright
        # rendering of each book (usually bot-blocked from datacenters).
        results = {}
        for source, fn in (("action-network", fetch_action_props),):
            try:
                results = await asyncio.to_thread(fn, team, opponent, game_date)
                logger.info(f"{source} returned {sum(r.get('count', 0) for r in results.values())} props")
                break
            except Exception as e:
                logger.warning(f"{source} failed: {str(e)[:160]}")
                results = {}
        if not results and ODDS_API_KEY:
            try:
                results = await asyncio.to_thread(fetch_odds_api_props, team, opponent, game_date)
                logger.info(f"Odds API returned {sum(r.get('count', 0) for r in results.values())} props")
            except Exception as e:
                logger.warning(f"Odds API failed, falling back to Playwright: {str(e)[:160]}")
                results = {}

        if not results:
            # One shared browser, one context per book (4 concurrent browsers
            # would blow the 2g container limit).
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True)
                try:
                    tasks = [
                        scrape_sportsbook(browser, sportsbook, team, opponent, game_date)
                        for sportsbook in SPORTSBOOKS
                    ]
                    scraped_results = await asyncio.gather(*tasks, return_exceptions=True)
                finally:
                    await browser.close()

            # Aggregate results
            for i, result in enumerate(scraped_results):
                sportsbook = SPORTSBOOKS[i]
                if isinstance(result, Exception):
                    logger.error(f"Scrape failed for {sportsbook}: {result}")
                    results[sportsbook] = {"error": str(result)[:200], "count": 0}
                else:
                    props, error = result
                    logger.info(f"Scraped {len(props)} props from {sportsbook}")
                    entry = {
                        "props": props,
                        "count": len(props),
                        "timestamp": datetime.now().isoformat(),
                    }
                    if error:
                        entry["error"] = error
                    results[sportsbook] = entry
        
        # Store results
        _scraper_results[game_date] = {
            "team": team,
            "opponent": opponent,
            "game_date": game_date,
            "results": results,
            "total_props": sum(r.get("count", 0) for r in results.values()),
            "scrape_time": datetime.now().isoformat(),
        }
        _last_scrape_time = datetime.now()
        
        logger.info(f"Scrape complete: {_scraper_results[game_date]['total_props']} total props")
        return _scraper_results[game_date]
        
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
        "sportsbooks": SPORTSBOOKS,
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
    
    if not team or not opponent or not game_date:
        raise HTTPException(
            status_code=400,
            detail="Missing required fields: team, opponent, game_date"
        )
    
    return await scrape_all_sportsbooks(team, opponent, game_date)


@app.get("/results")
async def get_results(date: Optional[str] = None):
    """
    Get scraped results.
    
    Query params:
    - date: Filter by game date (YYYYMMDD)
    """
    if date and date in _scraper_results:
        return _scraper_results[date]
    elif date:
        return {"error": f"No results found for date {date}"}
    else:
        return {
            "results": _scraper_results,
            "last_scrape": _last_scrape_time.isoformat() if _last_scrape_time else None,
            "total_games": len(_scraper_results),
        }


@app.post("/scrape/multiple")
async def trigger_scrape_multiple(games: List[Dict[str, str]]):
    """
    Trigger scrapes for multiple games concurrently.
    
    Request body:
    [
        {"team": "NE", "opponent": "SEA", "game_date": "20260913"},
        {"team": "BUF", "opponent": "HOU", "game_date": "20260913"},
        ...
    ]
    """
    if not games:
        raise HTTPException(status_code=400, detail="No games provided")
    
    tasks = [
        scrape_all_sportsbooks(g.get("team", ""), g.get("opponent", ""), g.get("game_date", ""))
        for g in games
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    output = {}
    for i, result in enumerate(results):
        game_key = f"{games[i].get('team', '')}_{games[i].get('opponent', '')}_{games[i].get('game_date', '')}"
        if isinstance(result, Exception):
            output[game_key] = {"error": str(result)}
        else:
            output[game_key] = result
    
    return output


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
