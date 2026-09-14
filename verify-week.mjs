import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
await p.goto('http://localhost:3000/nfl', { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForTimeout(3500)
const cards = await p.locator('a[href*="/nfl/game/"]').allTextContents()
console.log('game cards:', cards.length)
for (const c of cards.slice(0, 20)) console.log(' -', c.replace(/\s+/g, ' ').trim().slice(0, 140))
console.log('headers:', await p.locator('h2').allTextContents().then(h => h.slice(0, 4)))
const live = cards.filter(c => /\bLIVE\b/.test(c)).length
console.log('live cards:', live)
console.log('page errors:', errors.length, errors.slice(0, 3))
await p.screenshot({ path: '/tmp/opencode/nfl-week1.png', fullPage: true })
await browser.close()
