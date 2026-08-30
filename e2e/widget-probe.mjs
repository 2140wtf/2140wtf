import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

const pickerBtn = page.getByRole('button', { name: /add widget/i });
await pickerBtn.waitFor({ state: 'visible', timeout: 10000 });
// Radix dialog overlay can intercept the click; force to bypass hit-target check
await pickerBtn.click({ force: true });
const option = page.getByText(/timechain art/i).first();
await option.waitFor({ state: 'visible', timeout: 10000 });
await option.click({ force: true });
await page.waitForTimeout(6000);

for (let i = 0; i < 24; i++) {
  const r = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="View artwork"] img');
    const els = Array.from(document.querySelectorAll('span'));
    const c = els.find((e) => /^\d+ \/ \d+$/.test(e.textContent?.trim() ?? ''));
    return {
      counter: c ? c.textContent.trim() : null,
      src: btn ? btn.src : null,
      w: btn ? btn.naturalWidth : null,
    };
  });
  console.log(`${r.counter ?? '?'} ${r.w > 0 ? 'OK  ' : 'FAIL'} w=${r.w ?? '-'} ${(r.src ?? '(no img)').slice(8, 75)}`);
  if (i < 23) {
    // Playwright's actionability checks stall while the skeleton covers the
    // button; dispatch the click directly instead.
    await page.evaluate(() => {
      (document.querySelector('button[aria-label="Next artwork"]') ?? {}).click?.();
    });
    await page.waitForTimeout(1500);
  }
}
await browser.close();
