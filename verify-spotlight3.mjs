import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('http://localhost:3000/nfl/ne', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(5000);

// Use the React DevTools approach: query the component state
// Since we can't easily access React internals, let's check the DOM elements
const heading = await p.locator('.fs-shell > div.md\\:grid > div.fs-panel h2.fs-eyebrow').first().textContent();
console.log('Heading:', heading);

// Check if the "Season starts September" message is showing (fallback)
const fallback = await p.getByText('Season starts September').count();
console.log('Fallback message visible:', fallback > 0);

// Check for any paragraph text in the panel
const paras = await p.locator('.fs-shell > div.md\\:grid > div.fs-panel').first().locator('p').allTextContents();
console.log('Panel paragraphs:', paras);

// Check for any image in the panel (opponent logo)
const imgs = await p.locator('.fs-shell > div.md\\:grid > div.fs-panel').first().locator('img').count();
console.log('Panel images:', imgs);

// Get full innerHTML of the panel
const html = await p.locator('.fs-shell > div.md\\:grid > div.fs-panel').first().innerHTML();
console.log('Panel HTML (first 2000):', html.slice(0, 2000));

await browser.close();
