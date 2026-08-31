// Debug: dump the demo auction card's buttons and dialog state precisely.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(4_000);

await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(3_000);

// Find the card containing the demo title, list its buttons.
const card = page.locator('div.group', { hasText: /Demo Auction/i }).first();
console.log('Card found:', await card.isVisible().catch(() => false));
const cardButtons = card.locator('button');
const count = await cardButtons.count();
for (let i = 0; i < count; i++) {
  const b = cardButtons.nth(i);
  console.log(`  button[${i}]: "${(await b.textContent())?.trim()}" visible=${await b.isVisible()}`);
}

// Click Buy It Now inside the card specifically.
const bin = card.getByRole('button', { name: /buy it now/i }).first();
if (await bin.isVisible().catch(() => false)) {
  await bin.click();
  await page.waitForTimeout(1_500);
  const dialog = page.locator('[role="dialog"]');
  console.log('Dialog open:', await dialog.isVisible().catch(() => false));
  if (await dialog.isVisible().catch(() => false)) {
    console.log('--- dialog text ---');
    console.log((await dialog.innerText()).slice(0, 600));
    const input = dialog.locator('#bid-amount');
    if (await input.isVisible().catch(() => false)) {
      console.log(`amount=${await input.inputValue()} disabled=${await input.isDisabled()}`);
    }
    await page.screenshot({ path: 'e2e/shots/buynow-dialog-real.png' });
  }
} else {
  console.log('No Buy It Now button inside the demo card.');
}

await browser.close();
