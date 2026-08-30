// Verify the Buy It Now gate: logged-out → toast + login dialog.
// This confirms the eBay-style flow is properly auth-gated.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);
await page.getByRole('button', { name: /auctions/i }).first().click();
await page.waitForTimeout(4_000);

// Click Buy It Now while logged out.
const bin = page.getByRole('button', { name: /buy it now/i }).first();
await bin.click();
await page.waitForTimeout(1_500);

// Capture the toast + login dialog.
const toast = page.locator('[role="status"], [data-sonner-toast]').first();
const toastText = (await toast.innerText().catch(() => '')).slice(0, 120);
console.log('Toast:', toastText || '(none)');

const dialog = page.locator('[role="dialog"]');
const dialogText = (await dialog.innerText().catch(() => '')).slice(0, 200);
console.log('Login dialog shown:', /Daily Nostr|log in|sign in|2140/i.test(dialogText));
await page.screenshot({ path: 'e2e/shots/buynow-gate-logged-out.png' });

await browser.close();
