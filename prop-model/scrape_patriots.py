"""Scrape Patriots game info and odds from multiple sources."""

import asyncio
import json
from playwright.async_api import async_playwright

async def scrape_espn_schedule():
    """Get Patriots schedule from ESPN."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            # ESPN NFL schedule
            print("=== ESPN NFL Schedule ===")
            await page.goto("https://www.espn.com/nfl/schedule/", timeout=30000)
            await page.wait_for_load_state('networkidle')
            await page.wait_for_timeout(2000)
            
            # Extract schedule data
            schedule = await page.evaluate('''() => {
                const games = [];
                const rows = document.querySelectorAll('.ScheduleItem, [data-testid="schedule-item"], tr');
                rows.forEach(row => {
                    const text = row.innerText;
                    if (text.includes('NE') || text.includes('Patriots')) {
                        games.push({
                            text: text.substring(0, 200),
                            home: text.includes('Home') || text.includes('vs'),
                        });
                    }
                });
                return games;
            }''')
            
            if schedule:
                for g in schedule[:5]:
                    print(json.dumps(g, indent=2))
            else:
                print("No NE games found in visible schedule")
                
            # Also try to get the page text to search for NE
            body_text = await page.evaluate('() => document.body.innerText')
            ne_lines = [line.strip() for line in body_text.split('\n') if 'NE' in line or 'Patriot' in line]
            print(f"\nLines mentioning NE/Patriots: {len(ne_lines)}")
            for line in ne_lines[:10]:
                print(f"  {line}")
                
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()

async def scrape_oddsportal():
    """Scrape odds from OddsPortal."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        try:
            print("\n=== OddsPortal NFL ===")
            await page.goto("https://www.oddsportal.com/sports/usa/nfl/", timeout=30000)
            await page.wait_for_load_state('networkidle')
            await page.wait_for_timeout(2000)
            
            content = await page.evaluate('() => document.body.innerText')
            ne_lines = [line.strip() for line in content.split('\n') if 'NE' in line or 'Patriot' in line][:20]
            print(f"NE/Patriots lines from OddsPortal: {len(ne_lines)}")
            for line in ne_lines:
                print(f"  {line}")
                
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()

async def main():
    await scrape_espn_schedule()
    await scrape_oddsportal()

if __name__ == "__main__":
    asyncio.run(main())
