"""Extract real player prop lines from ESPN and ActionNetwork using Playwright."""

import asyncio
import json
import re
from playwright.async_api import async_playwright

async def scrape_espn_odds():
    """Extract data from ESPN NFL odds page."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("=== ESPN NFL Odds ===\n")
        
        try:
            await page.goto('https://www.espn.com/nfl/odds', timeout=30000)
            await page.wait_for_timeout(5000)
            
            content = await page.evaluate('() => document.body.innerText')
            print(f"Page loaded: {len(content)} chars")
            
            # Save full content for analysis
            with open('/tmp/espn_odds_full.txt', 'w') as f:
                f.write(content)
            
            # Extract key information
            lines = content.split('\n')
            
            # Look for team names, scores, odds
            key_lines = []
            for i, line in enumerate(lines):
                line = line.strip()
                if len(line) > 10 and any(k in line.lower() for k in ['patriots', 'ne ', 'odds', 'spread', 'total', 'over', 'under', 'fan', 'draft', 'bet']):
                    key_lines.append(line[:200])
            
            print(f"\nKey lines found: {len(key_lines)}")
            for line in key_lines[:50]:
                print(f"  {line}")
                
            # Try to extract from JavaScript variables
            js_data = await page.evaluate('''() => {
                const scripts = document.querySelectorAll('script');
                const data = [];
                scripts.forEach(s => {
                    if (s.textContent.includes('odds') || s.textContent.includes('spread') || s.textContent.includes('total')) {
                        data.push(s.textContent.substring(0, 1000));
                    }
                });
                return data;
            }''')
            
            if js_data:
                print(f"\nFound {len(js_data)} JS blocks with odds data")
                for block in js_data[:2]:
                    print(f"\n{block[:500]}")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()


async def scrape_actionnetwork():
    """Extract data from ActionNetwork."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("\n=== ActionNetwork NFL ===\n")
        
        try:
            await page.goto('https://www.actionnetwork.com/nfl/odds', timeout=30000)
            await page.wait_for_timeout(6000)
            
            content = await page.evaluate('() => document.body.innerText')
            print(f"Page loaded: {len(content)} chars")
            
            with open('/tmp/actionnetwork_full.txt', 'w') as f:
                f.write(content)
            
            # Look for player props, lines, odds patterns
            lines = content.split('\n')
            
            # Pattern for player props: Player name + stat + line
            prop_pattern = re.compile(r'(\w+\.\w+|\w+)\s+(?:receiving|rushing|passing|rec|rush|pass)?\s*(?:yards|yds|yd)?\s*(?:over|under|o/u|o|u)?\s*\d+', re.IGNORECASE)
            
            props_found = []
            for line in lines:
                match = prop_pattern.search(line)
                if match:
                    props_found.append(line.strip()[:150])
            
            print(f"\nProp patterns found: {len(props_found)}")
            for prop in props_found[:30]:
                print(f"  {prop}")
                
            # Also look for team lines
            team_pattern = re.compile(r'(?:NE|NYJ|MIA|BUF|Patriots|Jets|Dolphins|Bills)\s*(?:@|vs)\s*(?:NE|NYJ|MIA|BUF|Patriots|Jets|Dolphins|Bills)', re.IGNORECASE)
            
            teams_found = []
            for line in lines:
                match = team_pattern.search(line)
                if match:
                    teams_found.append(line.strip()[:200])
            
            if teams_found:
                print(f"\nTeam matchups found: {len(teams_found)}")
                for t in teams_found[:10]:
                    print(f"  {t}")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()


async def scrape_specific_player_props():
    """Try to get specific player prop pages."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("\n=== Specific Player Props ===\n")
        
        # Try DraftKings player prop pages directly
        player_urls = [
            "https://www.draftkings.com/sports/football/nfl/odds/player-props/dmac-1001",  # Drake Maye
            "https://www.draftkings.com/sports/football/nfl/odds/player-props/sam-diggs-1001",  # Stefon Diggs
        ]
        
        for url in player_urls:
            try:
                print(f"Trying: {url}")
                await page.goto(url, timeout=20000, wait_until='domcontentloaded')
                await page.wait_for_timeout(4000)
                
                content = await page.evaluate('() => document.body.innerText')
                print(f"  Loaded: {len(content)} chars")
                
                if len(content) > 100:
                    # Extract any numbers that look like lines
                    import re
                    numbers = re.findall(r'\b\d+\.\d+\b', content)
                    if numbers:
                        print(f"  Numbers found: {set(numbers)}")
                    
                    # Look for prop keywords
                    keywords = ['over', 'under', 'yards', 'td', 'rec', 'pass']
                    for k in keywords:
                        matches = [l.strip() for l in content.split('\n') if k.lower() in l.lower()][:3]
                        if matches:
                            print(f"  {k.upper()}: {matches[0][:100]}")
            
            except Exception as e:
                print(f"  Error: {e}")
        
        await browser.close()


async def main():
    await scrape_espn_odds()
    await scrape_actionnetwork()
    await scrape_specific_player_props()

if __name__ == "__main__":
    asyncio.run(main())
