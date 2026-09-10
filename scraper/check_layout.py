"""Dev tool: screenshot team page at desktop + mobile widths, dump layout state."""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://host.docker.internal:3000/nfl/patriots"

async def snap(pw, width, out):
    browser = await pw.chromium.launch(headless=True)
    page = await browser.new_page(viewport={"width": width, "height": 900})
    await page.goto(URL, timeout=60_000, wait_until="domcontentloaded")
    await page.wait_for_timeout(12_000)
    state = await page.evaluate("""() => {
      const q = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'MISSING'; };
      return {
        heroDesktop: q('.max-w-6xl > div.hidden.md\\:grid, .max-w-6xl > div[class*="hidden md:grid"]'),
        anyMdHidden: (() => { const els = [...document.querySelectorAll('.md\\\\:hidden')]; return els.slice(0,3).map(e => getComputedStyle(e).display); })(),
        tiles: (() => { const h = [...document.querySelectorAll('h2')].find(e => e.textContent.includes('Last 5')); const c = h ? h.parentElement.parentElement.querySelectorAll(':scope > div')[1] : null; return c ? getComputedStyle(c).display : 'NOH2'; })(),
        panels: document.querySelectorAll('.fs-panel').length,
      };
    }""")
    print(width, state)
    await page.screenshot(path=out, full_page=False)
    await browser.close()

async def main():
    async with async_playwright() as pw:
        await snap(pw, 1280, "/tmp/dash_desktop.png")
        await snap(pw, 390, "/tmp/dash_mobile.png")

asyncio.run(main())
