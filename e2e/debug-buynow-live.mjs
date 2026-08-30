// Hard reload + dump the demo auction card's rendered HTML.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'networkidle', timeout: 40_000 }).catch(() => {});
await page.waitForTimeout(5_000);

await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

const card = page.locator('div.group', { hasText: /Demo Auction/i }).first();
console.log('Card visible:', await card.isVisible().catch(() => false));

// Does the card show the "Buy now 210,000 sats" price line (parser sees the tag)?
const body = await card.innerText().catch(() => '');
console.log('--- card text ---');
console.log(body.slice(0, 400));

const bin = card.getByRole('button', { name: /buy it now/i });
console.log('Buy It Now count:', await bin.count());

await browser.close();
