/** Feed load timing profiler — guest (logged-out) feed on /. */
import { chromium } from 'playwright';

const APP = 'http://localhost:3301';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});
const page = await (await browser.newContext()).newPage();

const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// Track websocket activity to relays
page.on('websocket', (ws) => console.log(`[${ms()}] WS open: ${ws.url()}`));
page.on('console', (m) => { if (/feed|relay|nostr/i.test(m.text()) && m.type() !== 'log') return; });

await page.goto(APP, { waitUntil: 'domcontentloaded' });
console.log(`[${ms()}] DOM loaded`);

let reported = { content: false, empty: false };
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      noPosts: body.includes('No posts found'),
      skeleton: !!document.querySelector('[class*="skeleton"]'),
      cards: document.querySelectorAll('article, [data-testid*="note"], [class*="NoteCard"]').length,
    };
  });
  if (!reported.content && state.cards > 0) {
    console.log(`[${ms()}] CONTENT: ${state.cards} note cards visible`);
    reported.content = true;
  }
  if (!reported.empty && state.noPosts) {
    console.log(`[${ms()}] EMPTY STATE shown ("No posts found")`);
    reported.empty = true;
  }
  if (i % 10 === 0) console.log(`[${ms()}] … cards=${state.cards} skeleton=${state.skeleton} empty=${state.noPosts}`);
  if (reported.content && reported.empty) break;
  if (i === 60 && !reported.content) console.log(`[${ms()}] 30s with no content`);
}
await page.screenshot({ path: '/tmp/feed-timing.png' });
await browser.close();
