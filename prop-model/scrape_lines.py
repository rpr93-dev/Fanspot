"""Extract real lines and odds for Patriots games from ESPN."""

import asyncio
import json
import re
from playwright.async_api import async_playwright

async def extract_lines():
    """Extract actual betting lines from ESPN."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("=== Extracting Patriots Lines from ESPN ===\n")
        
        try:
            # Get the schedule page which has odds
            await page.goto('https://www.espn.com/nfl/schedule/_/type/20260907', timeout=30000)
            await page.wait_for_timeout(8000)
            
            # Get structured data from the page
            data = await page.evaluate('''() => {
                const result = {
                    title: document.title,
                    text: document.body.innerText.substring(0, 10000),
                    html: document.documentElement.outerHTML.substring(0, 20000),
                    classes: [],
                    links: []
                };
                
                // Find all elements with odds-related classes
                const selectors = ['[class*="odds"]', '[class*="line"]', '[class*="spread"]', 
                                   '[class*="total"]', '[class*="over"]', '[class*="under"]',
                                   '[data-testid*="odds"]', '[data-testid*="line"]'];
                
                for (const sel of selectors) {
                    try {
                        const elements = document.querySelectorAll(sel);
                        elements.forEach(el => {
                            result.classes.push({
                                selector: sel,
                                text: el.innerText.substring(0, 200),
                                class: el.className.substring(0, 100)
                            });
                        });
                    } catch(e) {}
                }
                
                // Find all links
                const links = Array.from(document.querySelectorAll('a'));
                links.forEach(link => {
                    if (link.href && (link.href.includes('nfl') || link.href.includes('odd'))) {
                        result.links.push(link.href.substring(0, 150));
                    }
                });
                
                return result;
            }''')
            
            print(f"Title: {data['title']}")
            print(f"Classes found: {len(data['classes'])}")
            
            for cls in data['classes'][:30]:
                print(f"\n[{cls['class']}]")
                print(f"  {cls['text']}")
            
            print(f"\nLinks found: {len(data['links'])}")
            for link in data['links'][:20]:
                print(f"  {link}")
            
            # Save full data
            with open('/tmp/espn_extract.json', 'w') as f:
                json.dump(data, f, indent=2)
            print("\nSaved to /tmp/espn_extract.json")
            
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()


async def extract_from_text():
    """Parse the raw text for lines."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("\n=== Extracting Lines from Text Content ===\n")
        
        try:
            await page.goto('https://www.espn.com/nfl/schedule', timeout=30000)
            await page.wait_for_timeout(6000)
            
            # Get the full text content
            content = await page.evaluate('() => document.body.innerText')
            
            # Look for line patterns
            patterns = [
                r'([A-Z]{2,3})\s+([+-]?\d+\.?\d*)\s+@?\s+([A-Z]{2,3})',  # Team +/- @ Team
                r'(?:Over|Under|O|U)\s+([\d.]+)',  # Over/Under lines
                r'Spread:\s*([+-]?\d+\.?\d*)',  # Spread
                r'Total:\s*([\d.]+)',  # Total
            ]
            
            print("Looking for patterns in text...")
            
            for pattern in patterns:
                matches = re.findall(pattern, content, re.IGNORECASE)
                if matches:
                    print(f"\nPattern '{pattern[:40]}...' found {len(matches)} matches:")
                    for match in matches[:15]:
                        print(f"  {match}")
            
            # Save full content
            with open('/tmp/espn_text_full.txt', 'w') as f:
                f.write(content)
            print(f"\nFull text saved ({len(content)} chars)")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()


async def main():
    await extract_lines()
    await extract_from_text()

if __name__ == "__main__":
    asyncio.run(main())
