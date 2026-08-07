import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
const WTF = 'http://localhost:3301';
const browser = await chromium.launch({ headless: true, executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await (await browser.newContext()).newPage();
const sk = generateSecretKey();
await page.goto(`${WTF}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.locator('button').filter({ hasText: /^\s*Join\s*$/ }).first().click();
await page.waitForTimeout(1500);
await page.locator('input[placeholder*="nsec"]').first().fill(nip19.nsecEncode(sk));
await page.locator('[role="dialog"] button').filter({ hasText: /Log in/i }).last().click();
await page.waitForTimeout(4000);
for (let i = 0; i < 6; i++) {
  let clicked = false;
  for (const pat of [/Skip for now/i, /Continue to 2140/i, /Let's go/i]) {
    const btn = page.locator('button:visible').filter({ hasText: pat }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) { await btn.click({ force: true }); await page.waitForTimeout(2200); clicked = true; break; }
  }
  if (clicked) continue;
  if (!page.url().includes('/wallet')) { await page.goto(`${WTF}/wallet`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); continue; }
  break;
}
await page.waitForTimeout(4000);
const baoWalletBtn = page.locator('button:visible').filter({ hasText: /BAO Wallet/i }).first();
if (await baoWalletBtn.isVisible({ timeout: 4000 }).catch(() => false)) { await baoWalletBtn.click(); await page.waitForTimeout(5000); }
const text = (await page.locator('body').textContent()).replace(/\s+/g, ' ');
const i = Math.max(0, text.indexOf("Wallet"));
console.log("URL:", page.url()); console.log(text.slice(i, i + 1800));
await browser.close();
