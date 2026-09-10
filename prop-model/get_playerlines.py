"""Get real player prop lines using ESPN's internal APIs."""

import json
import requests
import re
from typing import List, Dict, Any

def get_espn_player_props():
    """Extract player prop data from ESPN's internal APIs."""
    print("=== ESPN Player Prop APIs ===\n")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.espn.com/nfl/odds'
    }
    
    # ESPN uses these internal endpoints for odds
    endpoints = [
        'https://site.api.espn.com/apis/site/v2/sports/nfl/schedule',
        'https://sports.core.api.espn.com/apis/v2/sports/nfl/schedule',
    ]
    
    all_data = {}
    
    for url in endpoints:
        try:
            print(f"Trying: {url.split('/')[-3]}")
            resp = requests.get(url, headers=headers, timeout=10)
            print(f"  Status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                all_data[url.split('/')[-3]] = data
                
                # Extract game odds
                if 'sports' in data:
                    for sport in data['sports']:
                        if 'leagues' in sport:
                            for league in sport['leagues']:
                                if 'calendar' in league:
                                    events = league['calendar']
                                    print(f"  Found {len(events)} events")
                                    
                                    # Look for NE games
                                    for event in events:
                                        for comp in event.get('competitions', []):
                                            for c in comp.get('competitors', []):
                                                if c.get('team', {}).get('abbreviation') == 'NE':
                                                    print(f"\n  NE Game: {event.get('date', '')[:10]}")
                                                    print(f"  Name: {event.get('name', '')}")
                                                    
                                                    # Get odds
                                                    odds = comp.get('odds', [])
                                                    for odd in odds:
                                                        print(f"  Odds: {json.dumps(odd, indent=4)}")
                                                    break
                break
            else:
                print(f"  Response: {resp.text[:200]}")
        except Exception as e:
            print(f"  Error: {e}")
    
    return all_data


def get_from_odds_api():
    """Try The Odds API with a free key."""
    print("\n=== The Odds API ===\n")
    
    # Try with a demo/free key pattern
    api_key = '0a0e1c3c0e0a0a0a0a0a0a0a0a0a0a0a'  # Placeholder
    
    try:
        resp = requests.get(
            'https://api.the-odds-api.com/api/4/sports/americanfootball_nfl/odds/',
            params={
                'apiKey': api_key,
                'regions': 'us',
                'markets': 'spreads,totals',
                'oddsFormat': 'decimal'
            },
            timeout=10
        )
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response: {len(data)} games")
            
            # Look for Patriots games
            for game in data:
                if 'patriot' in game['description'].lower():
                    print(f"\nPatriots Game: {game['description']}")
                    print(f"  Time: {game['commence_time']}")
                    
                    for market in game['markets']:
                        print(f"\n  {market['key']}:")
                        for outcome in market['outcomes']:
                            print(f"    {outcome['name']}: {outcome['point']} @ {outcome['odds']}")
            
            with open('/tmp/odds_api_data.json', 'w') as f:
                json.dump(data, f, indent=2)
            
            return data
    except Exception as e:
        print(f"Error: {e}")
    
    return []


def try_sportsdata_io():
    """Try SportsData.io free API."""
    print("\n=== SportsData.io ===\n")
    
    try:
        # Try with demo key
        resp = requests.get(
            'https://api.sportsdata.io/v3/nfl/projections/json/PlayerProjectionsByGame/2026/REG',
            headers={'Ocp-Apim-Subscription-Key': 'demo'},
            timeout=10
        )
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response size: {len(data)} items")
            with open('/tmp/sportsdata_response.json', 'w') as f:
                json.dump(data, f, indent=2)
            return data
    except Exception as e:
        print(f"Error: {e}")
    
    return []


async def scrape_with_playwright():
    """Use Playwright to get player props from accessible sites."""
    from playwright.async_api import async_playwright
    
    print("\n=== Playwright Sportsbook Scraping ===\n")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Try multiple sites
        urls = [
            'https://www.sportspicker.com/nfl/odds',
            'https://www.vegasinsider.com/nfl/odds/',
            'https://www.vegasstatsonline.com/nfl/lines/',
        ]
        
        for url in urls:
            try:
                print(f"Trying: {url.split('/')[-2]}")
                await page.goto(url, timeout=20000, wait_until='domcontentloaded')
                await page.wait_for_timeout(5000)
                
                content = await page.evaluate('() => document.body.innerText')
                print(f"  Loaded: {len(content)} chars")
                
                # Look for line patterns
                if content:
                    # Extract numbers that look like lines (e.g., "-3.5", "44.5")
                    lines = re.findall(r'[+-]?\d+\.?\d*', content)
                    if lines:
                        print(f"  Found {len(lines)} numbers")
                        # Filter to likely lines
                        likely_lines = [l for l in lines if abs(float(l)) < 100 and float(l) != 0][:20]
                        print(f"  Likely lines: {likely_lines}")
                    
                    # Check for Patriots mention
                    if 'patriot' in content.lower():
                        print(f"  ✓ Contains Patriots data")
                        with open(f'/tmp/{url.split("/")[-2]}_raw.txt', 'w') as f:
                            f.write(content)
                
            except Exception as e:
                print(f"  Error: {e}")
        
        await browser.close()


if __name__ == "__main__":
    import asyncio
    
    data = get_espn_player_props()
    if data:
        with open('/tmp/espn_api_data.json', 'w') as f:
            json.dump(data, f, indent=2)
    
    asyncio.run(scrape_with_playwright())
