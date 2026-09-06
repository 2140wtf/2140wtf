// Probe against LIVE production: https://2140.wtf/fal-live
// Verifies the deployed bundle contains the round-130 fixes and behaves:
//   1. full-bar tap target (not chevron-only)
//   2. bar tap expands the trollbox
//   3. iframe box invariant across expand AND viewport churn (video keepalive)
//   4. second tap collapses
// No login injected, no writes — read-only interaction with the public page.
import { chromium } from 'playwright-core';

const BASE = process.env.PROD_BASE ?? 'https://2140.wtf';
const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// 0) Deploy marker: live CSS must contain the session-pinned dvh variable
const html = await (await fetch(`${BASE}/fal-live/`)).text();
const cssPath = [...html.matchAll(/href="(\/assets\/[^"]+\.css)"/g)].map((m) => m[1]);
let dvhPinLive = false;
for (const p of cssPath) {
  const css = await (await fetch(`${BASE}${p}`)).text();
  if (css.includes('--fal-live-dvh')) dvhPinLive = true;
}
console.log('CSS_BUNDLES:', cssPath.length, '· DVH_PIN_IN_LIVE_CSS:', dvhPinLive);

await page.goto(`${BASE}/fal-live`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main.fal-live-height iframe', { timeout: 30_000 });

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

// 1) Tap the FULL bar (center, away from the chevron on the right edge)
await page.locator('button[aria-label="Expand Trollbox"]').tap();
await page.waitForTimeout(500);
const afterTap = await geo();
console.log('afterTap:', JSON.stringify(afterTap));
console.log('EXPANDS:', !!afterTap && afterTap.chatH > 100);
console.log('FULL_BAR_TARGET:', before.barHit >= 40);

// 2) Iframe box invariance across the toggle
console.log(
  'IFRAME_INVARIANT:',
  !!before && !!afterTap &&
    Math.abs(before.top - afterTap.top) <= 1 &&
    Math.abs(before.bottom - afterTap.bottom) <= 1 &&
    Math.abs(before.width - afterTap.width) <= 1,
);

// 3) URL-bar churn simulation: height-only viewport change must not move the iframe
await page.setViewportSize({ width: 375, height: 620 });
await page.waitForTimeout(500);
const churned = await geo();
console.log('afterChurn:', JSON.stringify(churned));
console.log(
  'CHURN_INVARIANT:',
  !!afterTap && !!churned &&
    Math.abs(afterTap.top - churned.top) <= 1 &&
    Math.abs(afterTap.bottom - churned.bottom) <= 1,
);

// 4) Collapse via the bar (label flips when expanded)
await page.setViewportSize({ width: 375, height: 667 });
await page.waitForTimeout(300);
await page.locator('button[aria-label="Collapse Trollbox"]').tap();
await page.waitForTimeout(500);
const collapsed = await geo();
console.log('collapsed:', JSON.stringify(collapsed));
console.log('COLLAPSE_OK:', !!collapsed && collapsed.chatH <= 45);
console.log('PAGE_ERRORS:', errors.length ? errors : 'none');

await browser.close();
const pass = dvhPinLive && before?.barHit >= 40 && afterTap?.chatH > 100 &&
  Math.abs(before.top - afterTap.top) <= 1 && Math.abs(before.bottom - afterTap.bottom) <= 1 &&
  collapsed?.chatH <= 45;
process.exit(pass ? 0 : 1);
