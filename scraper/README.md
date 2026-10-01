# Player Prop Scraper Docker Service

Serves DraftKings player prop lines (via Action Network's free web API, with The Odds API as an optional second source) and exposes them via a REST API. Results persist to disk and keep a per-game hourly refresh history.

## Quick Start

```bash
# Build and start the scraper
cd scraper
docker-compose up --build -d

# Check health
curl http://localhost:8765/health

# Trigger a scrape
curl -X POST http://localhost:8765/scrape \
  -H "Content-Type: application/json" \
  -d '{"team":"NE","opponent":"SEA","game_date":"20260913"}'
```

## Integration

The scraper integrates with the Fanspot Next.js app via the `/api/scraper` route:

- `POST /api/scraper/scrape` — Trigger a scrape (called from NextGamePanel)
- `GET /api/scraper/results` — Get latest scraped results

The Next.js app will automatically call the scraper when you click "Scrape Lines" on a game card.

## Scraper Endpoints

- `POST /scrape` — Scrape a single game
- `POST /scrape/multiple` — Scrape multiple games concurrently
- `GET /results` — Get all scraped results
- `GET /health` — Health check

## Sportsbooks

DraftKings only (`DK NJ` via Action Network, `draftkings` via The Odds API).
Every other book is dropped at the source so the hourly refresh and the model
grade track one consistent board. (Per-book page rendering via Playwright was
removed — the books bot-block datacenter IPs, so it never returned lines.)

## Environment Variables

- `SCRAPER_URL` — URL of the scraper service (default: http://localhost:8765)

## Files

- `scraper_api.py` — FastAPI scraper service
- `Dockerfile` — Container definition
- `docker-compose.yml` — Docker Compose configuration
- `requirements.txt` — Python dependencies
