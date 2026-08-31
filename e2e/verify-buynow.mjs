// Verify the eBay-style Buy It Now flow on the Auctions tab (localhost:3501).
// 1. Open /market, click the Auctions toggle.
// 2. Confirm the demo auction card renders with a Buy It Now button.
// 3. Open the Buy It Now dialog and confirm it is fixed-price and gated.
// Does NOT confirm a purchase — visual + structural checks only.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(4000);

// Switch to the Auctions tab
const auctionsToggle = page.getByRole('button', { name: /auctions/i }).first();
await auctionsToggle.click();
await page.waitForTimeout(3000);

// Find the demo auction card
const demoCard = page.locator('div', { hasText: /Demo Auction/i }).locator('button').first();
const body = await page.locator('body').innerText();
const hasDemo = /Demo Auction/i.test(body);
console.log('Demo auction visible:', hasDemo);

// Check for Buy It Now button
const buyNowBtn = page.getByRole('button', { name: /buy it now/i }).first();
const buyNowVisible = await buyNowBtn.isVisible().catch(() => false);
console.log('Buy It Now button visible:', buyNowVisible);

// Check for Place bid button
const bidBtn = page.getByRole('button', { name: /place bid/i }).first();
const bidVisible = await bidBtn.isVisible().catch(() => false);
console.log('Place bid button visible:', bidVisible);

// If Buy It Now exists, click it and check the dialog opens (without confirming)
if (buyNowVisible) {
  await buyNowBtn.click();
  await page.waitForTimeout(1500);
  const dialog = page.locator('[role="dialog"]');
  const dialogVisible = await dialog.isVisible().catch(() => false);
  console.log('Buy It Now dialog opened:', dialogVisible);
  if (dialogVisible) {
    const dialogText = await dialog.innerText();
    console.log('Dialog mentions escrow:', /escrow/i.test(dialogText));
    console.log('Dialog shows fixed price:', /buy.?now|fixed/i.test(dialogText));
  }
  await page.keyboard.press('Escape');
} else {
  console.log('Buy It Now button not found — may require login or auction may lack buy_now tag.');
}

// Screenshots for review
await page.screenshot({ path: 'e2e/shots/buynow-grid.png', fullPage: false });

console.log('---');
console.log(errors.length ? `ERRORS (${errors.length}):` : 'No page errors.');
errors.slice(0, 5).forEach((e) => console.log(' ', e));

await browser.close();
