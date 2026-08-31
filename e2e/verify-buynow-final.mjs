// Final check: open the Buy It Now dialog from a card that HAS the button,
// verify fixed price + locked input + confirm button. Does NOT confirm.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);
await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

// Click the first Buy It Now button anywhere on the page (all are on demo cards).
const bin = page.getByRole('button', { name: /buy it now/i }).first();
await bin.click();
await page.waitForTimeout(1_500);

const dialog = page.locator('[role="dialog"]');
console.log('Dialog open:', await dialog.isVisible().catch(() => false));
const text = await dialog.innerText().catch(() => '');
console.log('Dialog title has "Buy It Now":', /Buy It Now/.test(text));
console.log('Label "Fixed price (sats)":', /Fixed price/i.test(text));
const input = dialog.locator('#bid-amount');
if (await input.isVisible().catch(() => false)) {
  console.log(`Amount: ${await input.inputValue()} | disabled: ${await input.isDisabled()}`);
}
console.log('Confirm button:', await dialog.getByRole('button', { name: /confirm buy it now/i }).isVisible().catch(() => false));
await page.screenshot({ path: 'e2e/shots/buynow-dialog-final.png' });
console.log('Page errors:', errors.length ? errors.join(' | ') : 'none');

await browser.close();
