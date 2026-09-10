"""Extract Patriots game lines and build final comparison."""

import asyncio
import json
import re
from playwright.async_api import async_playwright

async def get_patriots_game_lines():
    """Get the specific lines for the Patriots game."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("=== Patriots Game Lines ===\n")
        
        try:
            # Get the game page directly
            await page.goto('https://www.espn.com/nfl/game/_/gameId/401872656/patriots-seahawks', timeout=30000)
            await page.wait_for_timeout(8000)
            
            # Extract all odds and line data
            data = await page.evaluate('''() => {
                const result = {
                    title: document.title,
                    odds: [],
                    teams: [],
                    text: document.body.innerText.substring(0, 8000)
                };
                
                // Find odds data
                const oddsElements = document.querySelectorAll('[class*="odds"], [class*="Line"]');
                oddsElements.forEach(el => {
                    if (el.innerText.trim()) {
                        result.odds.push(el.innerText.trim().substring(0, 200));
                    }
                });
                
                // Find team data
                const teamElements = document.querySelectorAll('[class*="team"], [class*="Team"]');
                teamElements.forEach(el => {
                    const text = el.innerText.trim();
                    if (text && (text.includes('NE') || text.includes('SEA') || text.includes('Patriot') || text.includes('Seahawk'))) {
                        result.teams.push({
                            text: text.substring(0, 100),
                            class: el.className.substring(0, 80)
                        });
                    }
                });
                
                return result;
            }''')
            
            print(f"Title: {data['title']}")
            
            print(f"\nOdds found ({len(data['odds'])}):")
            for odd in data['odds'][:30]:
                print(f"  {odd}")
            
            print(f"\nTeam data found ({len(data['teams'])}):")
            for team in data['teams']:
                print(f"  [{team['class']}] {team['text']}")
            
            print(f"\nPage text excerpt:")
            print(data['text'][:2000])
            
            # Save full data
            with open('/tmp/patriots_game.json', 'w') as f:
                json.dump(data, f, indent=2)
            print("\nSaved to /tmp/patriots_game.json")
            
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()


async def get_week1_schedule():
    """Get the full Week 1 schedule with all lines."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("\n=== Week 1 Schedule (All Games) ===\n")
        
        try:
            await page.goto('https://www.espn.com/nfl/schedule/_/date/20260913', timeout=30000)
            await page.wait_for_timeout(6000)
            
            data = await page.evaluate('''() => {
                const games = [];
                const lines = [];
                
                // Find all game entries
                const gameSelectors = ['[class*="game"]', '[class*="Game"]', '[class*="event"]'];
                
                for (const sel of gameSelectors) {
                    try {
                        const elements = document.querySelectorAll(sel);
                        elements.forEach(el => {
                            const text = el.innerText;
                            if (text && (text.includes('-') && (text.includes('NE') || text.includes('SEA')))) {
                                games.push({
                                    text: text.substring(0, 300),
                                    class: el.className.substring(0, 80)
                                });
                            }
                        });
                    } catch(e) {}
                }
                
                // Extract all odds
                const oddsEls = document.querySelectorAll('[class*="odds__col"], [class*="Line"]');
                oddsEls.forEach(el => {
                    const text = el.innerText.trim();
                    if (text.includes('-') && (text.includes('.') || /\d/.test(text))) {
                        lines.push(text.substring(0, 100));
                    }
                });
                
                return { games, lines, text: document.body.innerText.substring(0, 5000) };
            }''')
            
            print(f"Games found: {len(data['games'])}")
            for game in data['games']:
                print(f"  {game['text']}")
            
            print(f"\nLines found: {len(data['lines'])}")
            for line in data['lines'][:30]:
                print(f"  {line}")
            
            # Save
            with open('/tmp/week1_schedule.json', 'w') as f:
                json.dump(data, f, indent=2)
            print(f"\nSaved ({len(json.dumps(data))} chars)")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()


async def main():
    await get_patriots_game_lines()
    await get_week1_schedule()

if __name__ == "__main__":
    asyncio.run(main())
