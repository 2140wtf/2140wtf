// Dump the full dialog HTML after clicking the FIRST Buy It Now button.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);
await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

const bin = page.getByRole('button', { name: /buy it now/i }).first();
console.log('BIN buttons:', await page.getByRole('button', { name: /buy it now/i }).count());
await bin.click();
await page.waitForTimeout(2_000);

const dialog = page.locator('[role="dialog"]');
console.log('Dialog visible:', await dialog.isVisible().catch(() => false));
const html = await dialog.innerHTML().catch(() => '');
console.log('--- dialog innerHTML (first 1200 chars) ---');
console.log(html.slice(0, 1200));

await browser.close();
