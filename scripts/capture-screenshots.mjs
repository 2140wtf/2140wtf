/**
 * Capture showcase screenshots for the README + social preview image.
 *
 * Usage:  node scripts/capture-screenshots.mjs [baseUrl]
 *   baseUrl defaults to https://2140.wtf — pass http://localhost:3500 to
 *   capture a local dev build instead.
 *
 * Outputs:
 *   public/shots/home.png            — landing/feed view (dark)
 *   public/shots/markets.png         — prediction markets grid (dark)
 *   public/shots/market-detail.png   — market detail dialog (dark)
 *   public/og-image.jpg              — 1200×630 social preview card
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = join(root, 'public', 'shots');
const baseUrl = process.argv[2] ?? 'https://2140.wtf';

mkdirSync(shotsDir, { recursive: true });

/** Force the brand-dark look via the app's own quick-switch. evaluate()-click
 *  because locator().click() gets intercepted by overlays; must re-apply after
 *  every full navigation since anonymous theme persistence is unreliable. */
async function forceDark(page) {
  for (let i = 0; i < 3; i++) {
    const isDark = await page.evaluate(() => document.documentElement.className.includes('dark'));
    if (isDark) return true;
    await page.evaluate(() => document.querySelector('button[aria-label^="Color mode:"]')?.click());
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => document.documentElement.className.includes('dark'));
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
    locale: 'en-US',
  });
  const page = await context.newPage();

  // --- Home / feed ---------------------------------------------------------
  console.log('capturing home…');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(4_000); // relay content settle

  if (!(await forceDark(page))) {
    console.warn('could not switch to dark mode — capturing in default theme');
  }

  await page.screenshot({ path: join(shotsDir, 'home.png') });

  // --- Prediction markets grid --------------------------------------------
  console.log('capturing markets grid…');
  await page.goto(`${baseUrl}/prediction-markets`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  // MarketCard renders data-market-id once catalog data arrives.
  const firstCard = page.locator('[data-market-id]').first();
  await firstCard.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000); // sparklines/odds settle
  await forceDark(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shotsDir, 'markets.png') });

  // --- Market detail dialog -------------------------------------------------
  console.log('capturing market detail…');
  const detailsButton = firstCard.getByRole('button', { name: /details/i });
  if (await detailsButton.isVisible().catch(() => false)) {
    await detailsButton.click();
    await page.waitForTimeout(5_000); // chart + odds load
    await page.screenshot({ path: join(shotsDir, 'market-detail.png') });
  } else {
    console.warn('no Details button visible — skipping market detail shot');
  }

  await context.close();

  // --- Social preview og-image (1200×630) -----------------------------------
  console.log('rendering og-image…');
  const ogPage = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  await ogPage.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#09090b;width:1200px;height:630px;overflow:hidden}
  .stage{position:relative;width:1200px;height:630px;display:flex;align-items:center;padding:0 72px}
  .glow-a{position:absolute;top:-160px;right:-140px;width:520px;height:520px;border-radius:50%;
          background:radial-gradient(circle,#f7931a14 0%,transparent 70%)}
  .glow-b{position:absolute;bottom:-180px;left:-120px;width:480px;height:480px;border-radius:50%;
          background:radial-gradient(circle,#f7931a10 0%,transparent 70%)}
  .mark{flex:none;margin-right:56px}
  .word{font:800 118px/1 Inter,'Segoe UI',system-ui,sans-serif;color:#fafafa;letter-spacing:-4px}
  .word span{color:#f7931a}
  .tag{font:500 34px/1.35 Inter,'Segoe UI',system-ui,sans-serif;color:#a1a1aa;margin-top:22px}
  .sub{font:400 23px/1.5 Inter,'Segoe UI',system-ui,sans-serif;color:#71717a;margin-top:16px;max-width:820px}
  .btc{width:150px;height:150px;border-radius:50%;border:7px solid #f7931a;display:flex;
       align-items:center;justify-content:center;font:700 96px/1 'DejaVu Sans','Segoe UI Symbol',sans-serif;
       color:#f7931a}
</style></head>
<body>
  <div class="stage">
    <div class="glow-a"></div><div class="glow-b"></div>
    <div class="mark"><div class="btc">&#8383;</div></div>
    <div>
      <div class="word">2140<span>.wtf</span></div>
      <div class="tag">Your content. Your vibe. Your rules.</div>
      <div class="sub">Bitcoin-native Nostr superapp &#183; encrypted communities &#183; prediction markets &#183; wallets &#183; AI agents that earn bitcoin</div>
    </div>
  </div>
</body></html>`);
  await ogPage.waitForTimeout(600);
  await ogPage.screenshot({
    path: join(root, 'public', 'og-image.jpg'),
    type: 'jpeg',
    quality: 92,
  });
  await ogPage.close();

  console.log('done:', join(shotsDir, '*.png'), '+ public/og-image.jpg');
} finally {
  await browser.close();
}
