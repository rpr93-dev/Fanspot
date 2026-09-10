"""Scrape real player prop lines from sportsbooks using Playwright."""

import asyncio
import json
import re
from playwright.async_api import async_playwright

async def scrape_fanduel_props():
    """Scrape FanDuel NFL player props."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            # FanDuel player props page
            await page.goto('https://sports.fanduel.com/nfl/odds/player-props', timeout=30000)
            await page.wait_for_timeout(8000)
            
            # Extract the page content
            content = await page.evaluate('() => document.body.innerText')
            
            # Look for player prop data patterns
            lines = content.split('\n')
            
            # Find all numbers that look like prop lines
            prop_data = []
            for i, line in enumerate(lines):
                line = line.strip()
                # Pattern: player name + stat type + line
                if any(k in line.lower() for k in ['over ', 'under ', ' o/', ' u/', 'rec yards', 'rush yards', 'pass yards', 'receptions', 'touchdown']):
                    prop_data.append(line[:200])
            
            print(f"FanDuel: Found {len(prop_data)} prop lines")
            
            # Save raw content
            with open('/tmp/fanduel_raw.txt', 'w') as f:
                f.write(content)
            
            # Print key lines
            for line in prop_data[:30]:
                print(f"  {line}")
            
            return prop_data
            
        except Exception as e:
            print(f"FanDuel error: {e}")
            return []
        finally:
            await browser.close()


async def scrape_betmgm_props():
    """Scrape BetMGM player props."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            await page.goto('https://www.betmgm.com/en/sports/football-usa/nfl/odds/player-props', timeout=30000)
            await page.wait_for_timeout(8000)
            
            content = await page.evaluate('() => document.body.innerText')
            with open('/tmp/betmgm_raw.txt', 'w') as f:
                f.write(content)
            
            # Extract prop patterns
            lines = content.split('\n')
            prop_data = []
            
            for line in lines:
                line = line.strip()
                if any(k in line.lower() for k in ['player prop', 'receiving', 'rushing', 'passing', 'yards']):
                    prop_data.append(line[:200])
            
            print(f"\nBetMGM: Found {len(prop_data)} prop lines")
            for line in prop_data[:20]:
                print(f"  {line}")
            
            return prop_data
            
        except Exception as e:
            print(f"BetMGM error: {e}")
            return []
        finally:
            await browser.close()


async def scrape_draftkings_props():
    """Scrape DraftKings player props."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            # Try the player props page
            await page.goto('https://www.draftkings.com/sports/football/nfl/odds/player-props', timeout=30000)
            await page.wait_for_timeout(8000)
            
            content = await page.evaluate('() => document.body.innerText')
            with open('/tmp/draftkings_raw.txt', 'w') as f:
                f.write(content)
            
            # Extract player prop data
            lines = content.split('\n')
            prop_data = []
            
            for line in lines:
                line = line.strip()
                if any(k in line.lower() for k in ['rec', 'rush', 'pass', 'yards', 'td', 'ppr']):
                    prop_data.append(line[:200])
            
            print(f"\nDraftKings: Found {len(prop_data)} prop lines")
            for line in prop_data[:20]:
                print(f"  {line}")
            
            return prop_data
            
        except Exception as e:
            print(f"DraftKings error: {e}")
            return []
        finally:
            await browser.close()


async def scrape_from_api():
    """Try to get player props from a JSON API."""
    print("\n=== Trying Sports Data APIs ===\n")
    
    import requests
    
    # The Odds API (free, but needs key)
    api_urls = [
        {
            'url': 'https://api.the-odds-api.com/api/4/sports/americanfootball_nfl/odds/',
            'params': {'apiKey': 'demo', 'regions': 'us', 'markets': 'spreads'},
            'name': 'The Odds API'
        },
    ]
    
    for api in api_urls:
        try:
            print(f"Trying {api['name']}...")
            resp = requests.get(api['url'], params=api['params'], timeout=10)
            print(f"  Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"  Response size: {len(data)} odds groups")
                
                # Look for Patriots game
                for game in data:
                    if 'patriot' in game['description'].lower() or 'seahawk' in game['description'].lower():
                        print(f"\n  Patriots Game: {game['description']}")
                        for book in game['markets']:
                            if book['key'] == 'spreads':
                                for outcome in book['outcomes']:
                                    print(f"    {outcome['name']}: {outcome['point']} @ {outcome['odds']}")
                
                with open('/tmp/odds_api_response.json', 'w') as f:
                    json.dump(data, f, indent=2)
                break
        except Exception as e:
            print(f"  Error: {e}")


async def get_patriots_player_props():
    """Get specific player props for Patriots players."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("\n=== Patriots Player Props (Week 1) ===\n")
        
        try:
            # Try to get props directly from ESPN's player props
            await page.goto('https://www.espn.com/nfl/playerprops', timeout=30000)
            await page.wait_for_timeout(6000)
            
            content = await page.evaluate('() => document.body.innerText')
            print(f"ESPN Player Props loaded: {len(content)} chars")
            
            # Look for specific player mentions and lines
            lines = content.split('\n')
            
            # Player names to look for (from our model data)
            target_players = ['maye', 'diggs', 'henderson', 'henry', 'douglas', 'boutte']
            
            player_props = []
            for i, line in enumerate(lines):
                line_lower = line.lower()
                if any(p in line_lower for p in target_players):
                    # Get context (previous line, this line, next line)
                    context = []
                    for j in range(max(0, i-2), min(len(lines), i+3)):
                        context.append(lines[j].strip())
                    player_props.append(' | '.join(context))
            
            if player_props:
                print(f"Found {len(player_props)} lines with player props:")
                for prop in player_props:
                    print(f"  {prop}")
            else:
                print("No specific player prop data found")
            
            with open('/tmp/espn_playerprops.txt', 'w') as f:
                f.write(content)
            
        except Exception as e:
            print(f"ESPN player props error: {e}")
        finally:
            await browser.close()


async def main():
    print("=" * 80)
    print("SCRAPING REAL PLAYER PROP LINES")
    print("=" * 80)
    
    await scrape_fanduel_props()
    await scrape_betmgm_props()
    await scrape_draftkings_props()
    await get_patriots_player_props()
    await scrape_from_api()


if __name__ == "__main__":
    asyncio.run(main())
