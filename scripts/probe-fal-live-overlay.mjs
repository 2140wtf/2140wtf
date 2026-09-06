// Probe: fal-live trollbox expand + iframe stability in a real (headless)
// browser at phone viewport with touch. Mirrors the user report: tap the
// TROLLBOX bar — it must expand, and the studio iframe box must not change.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(DIST, p);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  try {
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${base}/fal-live`, { waitUntil: 'networkidle' });
console.log('URL:', page.url());
console.log('TITLE:', await page.title());
console.log('MAIN_COUNT:', await page.locator('main.fal-live-height').count());
console.log('IFRAME_COUNT:', await page.locator('iframe[title="fal.live AI generation studio"]').count());
console.log('BODY_SNIPPET:', (await page.locator('body').innerText().catch(() => '')).slice(0, 300).replace(/\n+/g, ' | '));

const geo = () => page.evaluate(() => {
  const iframe = document.querySelector('iframe[title="fal.live AI generation studio"]');
  const bar = document.querySelector('button[aria-label="Expand Trollbox"], button[aria-label="Collapse Trollbox"]');
  const aside = document.querySelector('main.fal-live-height > aside');
  if (!iframe || !aside) return null;
  const b = iframe.getBoundingClientRect();
  const a = aside.getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, width: b.width, chatH: a.height, overlay: getComputedStyle(aside).position, barHit: bar ? bar.getBoundingClientRect().height : 0 };
});

const before = await geo();
console.log('before:', JSON.stringify(before));

// 1) Tap the bar itself (center of the TROLLBOX label area — previously dead)
await page.locator('main.fal-live-height > aside > div').first().tap();
await page.waitForTimeout(400);
const afterTap = await geo();
console.log('afterTap:', JSON.stringify(afterTap));

// 2) Iframe box invariance across the toggle
const inv = before && afterTap && Math.abs(before.top - afterTap.top) <= 1 && Math.abs(before.bottom - afterTap.bottom) <= 1 && Math.abs(before.width - afterTap.width) <= 1;
console.log('IFRAME_INVARIANT:', inv);

// 3) URL-bar churn simulation: contract the viewport (chrome hides) and
//    confirm the iframe box does NOT move while the chat is expanded.
await page.setViewportSize({ width: 375, height: 620 });
await page.waitForTimeout(400);
const churned = await geo();
console.log('afterChurn:', JSON.stringify(churned));
console.log('CHURN_INVARIANT:', afterTap && churned && Math.abs(afterTap.top - churned.top) <= 1 && Math.abs(afterTap.bottom - churned.bottom) <= 1);

// 4) Collapse again via the bar
await page.locator('main.fal-live-height > aside > div').first().tap();
await page.waitForTimeout(400);
const collapsed = await geo();
console.log('collapsed:', JSON.stringify(collapsed));
console.log('COLLAPSE_OK:', collapsed && collapsed.chatH <= 45);
console.log('PAGE_ERRORS:', errors.length ? errors : 'none');

await browser.close();
server.close();
process.exit(inv && collapsed?.chatH <= 45 ? 0 : 1);
