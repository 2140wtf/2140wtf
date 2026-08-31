// Scan every auction card and report Buy It Now presence per card.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);

await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

// Cards are direct children of the grid; find cards by their "Auction" badge.
const allButtons = await page.getByRole('button', { name: /buy it now/i }).all();
console.log('Total Buy It Now buttons on page:', allButtons.length);
for (const b of allButtons.slice(0, 5)) {
  console.log('  label:', (await b.textContent())?.trim());
}

const bidButtons = await page.getByRole('button', { name: /place bid/i }).all();
console.log('Total Place bid buttons on page:', bidButtons.length);

// Which card titles are visible?
const titles = await page.locator('.line-clamp-2').allInnerTexts();
console.log('Card titles (first 8):', JSON.stringify(titles.slice(0, 8), null, 0));

await page.screenshot({ path: 'e2e/shots/buynow-final-grid.png' });
await browser.close();
