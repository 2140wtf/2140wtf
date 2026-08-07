/** Warm load with relays BLOCKED — content must still appear (from IDB seed). */
import { chromium } from 'playwright';

const APP = 'http://localhost:3301';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Cold visit to warm the IDB cache
await page.goto(APP, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if ((await page.evaluate(() => document.querySelectorAll('article, [class*="NoteCard"]').length)) > 0) break;
  await page.waitForTimeout(100);
}
console.log('[cold] cache warmed');
await page.waitForTimeout(4000);

// Block all relay websockets, then reload
await ctx.routeWebSocket(/^wss:\/\//, (ws) => ws.close());
await page.reload({ waitUntil: 'domcontentloaded' });
const t1 = Date.now();
let cards = 0, noPosts = false;
while (Date.now() - t1 < 15000) {
  const state = await page.evaluate(() => ({
    cards: document.querySelectorAll('article, [class*="NoteCard"]').length,
    noPosts: (document.body.textContent || '').includes('No posts found'),
  }));
  cards = state.cards;
  noPosts = state.noPosts;
  if (cards > 0) break;
  await page.waitForTimeout(100);
}
console.log(`[offline-warm] cards=${cards} after ${((Date.now() - t1) / 1000).toFixed(2)}s, noPosts=${noPosts}`);
await page.screenshot({ path: '/tmp/feed-offline-warm.png' });
await browser.close();
