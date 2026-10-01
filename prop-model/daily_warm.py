"""Daily warm for the prop pipeline (cron-safe, read-only, all sports).

Runs every morning and keeps the model inputs live without touching the
ledger (pre snapshots stay write-once, locked on real user visits with lines):
  1. One prop-model CLI pull -> refreshes the shared nflverse weekly disk
     cache (prop-model/cache, 24h TTL) used by every /api/prop-model run.
  2. /api/props per imminent game -> warms the unified-DB / roster caches.
  3. /api/scraper per imminent game -> pulls live DraftKings lines into the
     scraper service so Props-tab snapshots capture real lines.

Imminent = kickoff within the next --hours (default 96). Skips final games.
NFL comes from /api/schedule-week; NBA/NHL/MLB from ESPN's public scoreboard
feed (one call per day in the window).
Usage: .venv/bin/python daily_warm.py [--hours 96] [--base http://localhost:3000]
"""
import argparse
import datetime as dt
import json
import sys
import urllib.request

MARKETS = ("passing_yards", "tds")

SCOREBOARD_SPORTS = {
    "NBA": "basketball/nba",
    "NHL": "hockey/nhl",
    "MLB": "baseball/mlb",
}


def get(base, path, timeout=90):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.load(r)


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "Fanspot-daily-warm/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def post(base, path, body, timeout=180):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=96)
    ap.add_argument("--base", default="http://localhost:3000")
    args = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    horizon = now + dt.timedelta(hours=args.hours)
    print(f"[warm] {now.isoformat()} window -> {horizon.isoformat()}", flush=True)

    games = []
    seen = set()

    def consider(event_id, kick, away, home, date, sport, kickoff):
        if not (now - dt.timedelta(hours=3) <= kick <= horizon):
            return
        if not away or not home:
            return
        key = (sport, str(event_id))
        if key in seen:
            return
        seen.add(key)
        games.append({
            "eventId": str(event_id),
            "date": date,
            "away": away, "home": home,
            "sport": sport,
            "kickoff": kickoff,
        })

    try:
        board = get(args.base, "/api/schedule-week?sport=NFL", timeout=60)
    except Exception as e:
        print(f"[warm] schedule-week failed: {e}", flush=True)
        board = None
    if board:
        cur_week = board.get("week")
        boards = [board]
        # Sweep the next two weeks too: imminent games (e.g. Friday) often belong
        # to the following slate, which the current-week feed doesn't include.
        if isinstance(cur_week, int):
            for w in (cur_week + 1, cur_week + 2):
                try:
                    boards.append(get(args.base, f"/api/schedule-week?sport=NFL&week={w}", timeout=60))
                except Exception as e:
                    print(f"[warm] schedule-week week={w} failed: {e}", flush=True)
        for board in boards:
            for e in board.get("events", []) or []:
                try:
                    kick = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                comps = (e.get("competitions") or [{}])[0].get("competitors") or []
                abbr = {c.get("homeAway"): (c.get("team") or {}).get("abbreviation") for c in comps}
                state = ((e.get("status") or {}).get("type") or {}).get("name", "")
                if "FINAL" in str(state).upper():
                    continue
                consider(e["id"], kick, abbr.get("away"), abbr.get("home"),
                         e["date"][:10].replace("-", ""), "NFL", e["date"])

    days = args.hours // 24 + 1
    for sport, espn_path in SCOREBOARD_SPORTS.items():
        for d in range(days + 1):
            day = (now + dt.timedelta(days=d)).strftime("%Y%m%d")
            try:
                sb = get_json(f"https://site.api.espn.com/apis/site/v2/sports/{espn_path}/scoreboard?dates={day}",
                              timeout=30)
            except Exception as e:
                print(f"[warm] {sport} scoreboard {day} failed: {e}", flush=True)
                continue
            for e in sb.get("events", []) or []:
                try:
                    kick = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
                except (KeyError, ValueError):
                    continue
                comps = (e.get("competitions") or [{}])[0].get("competitors") or []
                abbr = {c.get("homeAway"): (c.get("team") or {}).get("abbreviation") for c in comps}
                state = ((e.get("status") or {}).get("type") or {}).get("name", "")
                if "FINAL" in str(state).upper():
                    continue
                consider(e["id"], kick, abbr.get("away"), abbr.get("home"),
                         e["date"][:10].replace("-", ""), sport, e["date"])
    print(f"[warm] {len(games)} imminent games", flush=True)

    ok = fail = 0
    for g in games:
        tag = f"{g['sport']} {g['away']}@{g['home']} {g['date']}"
        try:
            props = get(
                args.base,
                f"/api/props?sport={g['sport']}&team={g['away']}&opponent={g['home']}"
                f"&date={g['date']}&eventId={g['eventId']}",
                timeout=120,
            )
            n = len(props.get("projections") or [])
            print(f"[warm] props {tag}: {n} lines", flush=True)
        except Exception as e:
            print(f"[warm] props {tag} FAILED: {e}", flush=True)
            fail += 1
            continue
        try:
            sc = post(
                args.base, "/api/scraper",
                {"team": g["away"], "opponent": g["home"],
                 "gameDate": g["date"], "sport": g["sport"].lower(),
                 "gameTime": g.get("kickoff")},
                timeout=180,
            )
            res = (sc.get("results") or {}).get("results") or {}
            books = {b: (d or {}).get("count", 0) for b, d in res.items()}
            print(f"[warm] scrape {tag}: {books}", flush=True)
            ok += 1
        except Exception as e:
            print(f"[warm] scrape {tag} FAILED: {e}", flush=True)
            fail += 1
    print(f"[warm] done: {ok} scraped, {fail} failed", flush=True)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
