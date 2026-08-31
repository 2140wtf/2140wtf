// Verify the Listings/Auctions toggle now lives in the header row (same row
// as the Merchants title + search box), not the toolbar row below.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);

const listingsBtn = page.getByRole('button', { name: 'Listings', exact: true }).first();
const auctionsBtn = page.getByRole('button', { name: /auctions/i }).first();
const search = page.getByPlaceholder(/search listings/i).first();

const lb = await listingsBtn.boundingBox();
const ab = await auctionsBtn.boundingBox();
const sb = await search.boundingBox();

console.log('Listings toggle box:', lb ? `y=${Math.round(lb.y)} h=${Math.round(lb.height)}` : 'NOT FOUND');
console.log('Auctions toggle box:', ab ? `y=${Math.round(ab.y)} h=${Math.round(ab.height)}` : 'NOT FOUND');
console.log('Search box box:', sb ? `y=${Math.round(sb.y)} h=${Math.round(sb.height)}` : 'NOT FOUND');

if (lb && sb) {
  const sameRow = Math.abs(lb.y - sb.y) < 20;
  console.log('Toggle is on the same row as search:', sameRow);
}

await page.screenshot({ path: 'e2e/shots/header-toggle-row.png' });
await browser.close();
