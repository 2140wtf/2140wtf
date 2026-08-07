/** Verify instant seed: cold load (relay) → reload → content from IDB in <1s. */
import { chromium } from 'playwright';

const APP = 'http://localhost:3301';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

async function waitForContent(label, maxMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const cards = await page.evaluate(() =>
      document.querySelectorAll('article, [class*="NoteCard"]').length);
    if (cards > 0) {
      console.log(`[${label}] content after ${((Date.now() - t0) / 1000).toFixed(2)}s (${cards} cards)`);
      return (Date.now() - t0) / 1000;
    }
    await page.waitForTimeout(100);
  }
  console.log(`[${label}] NO content after ${maxMs / 1000}s`);
  return null;
}

// 1. Cold visit — relay load
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await waitForContent('cold', 40000);
await page.waitForTimeout(4000); // let IDB cache settle

// 2. Reload — seed should render almost instantly
await page.reload({ waitUntil: 'domcontentloaded' });
await waitForContent('warm-reload', 15000);

// 3. Fresh page navigation (new tab, same profile)
const page2 = await ctx.newPage();
await page2.goto(APP, { waitUntil: 'domcontentloaded' });
{
  const t0 = Date.now();
  let cards = 0;
  while (Date.now() - t0 < 15000) {
    cards = await page2.evaluate(() => document.querySelectorAll('article, [class*="NoteCard"]').length);
    if (cards > 0) break;
    await page2.waitForTimeout(100);
  }
  console.log(`[warm-newtab] content after ${((Date.now() - t0) / 1000).toFixed(2)}s (${cards} cards)`);
}
await browser.close();
