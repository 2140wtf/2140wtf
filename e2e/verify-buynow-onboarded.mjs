// Verify the Buy It Now dialog with an authenticated session that has
// completed onboarding. Injects a throwaway nsec login, skips onboarding via
// its "Skip and continue to app" escape hatch, then opens the BIN dialog.
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const BASE = 'http://localhost:3501';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);
const loginBlob = JSON.stringify([{ type: 'nsec', pubkey, data: { nsec } }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

await page.addInitScript((blob) => {
  window.localStorage.setItem('nostr:login', blob);
}, loginBlob);

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(6_000);

// Skip onboarding if it appeared.
const skipBtn = page.getByRole('button', { name: /skip and continue/i }).first();
if (await skipBtn.isVisible().catch(() => false)) {
  await skipBtn.click();
  console.log('Skipped onboarding.');
  await page.waitForTimeout(3_000);
}

// Dismiss any lingering overlay dialogs (welcome cards etc.) with Escape.
for (let i = 0; i < 3; i++) {
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
}

await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

const binCount = await page.getByRole('button', { name: /buy it now/i }).count();
console.log('Buy It Now buttons:', binCount);

if (binCount > 0) {
  await page.getByRole('button', { name: /buy it now/i }).first().click();
  await page.waitForTimeout(2_000);

  const dialog = page.locator('[role="dialog"]').last();
  const visible = await dialog.isVisible().catch(() => false);
  console.log('Dialog open:', visible);
  if (visible) {
    const text = await dialog.innerText();
    console.log('Title is "Buy It Now":', /Buy It Now/.test(text));
    console.log('Label "Fixed price":', /Fixed price/i.test(text));
    const input = dialog.locator('#bid-amount');
    if (await input.isVisible().catch(() => false)) {
      console.log(`Amount: ${await input.inputValue()} | disabled: ${await input.isDisabled()}`);
    }
    console.log('Confirm button visible:', await dialog.getByRole('button', { name: /confirm buy it now/i }).isVisible().catch(() => false));
    await page.screenshot({ path: 'e2e/shots/buynow-dialog-authed.png' });
  }
}

await browser.close();
