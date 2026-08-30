import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:3501', { waitUntil: 'domcontentloaded', timeout: 30000 });

try {
  const pickerBtn = page.getByRole('button', { name: /add widget/i });
  await pickerBtn.waitFor({ state: 'visible', timeout: 10000 });
  await pickerBtn.click();
  const option = page.getByText(/timechain art/i).first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
  await page.waitForTimeout(8000);

  const read = () => page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="View artwork"] img');
    const els = Array.from(document.querySelectorAll('span'));
    const c = els.find((e) => /^\d+ \/ \d+$/.test(e.textContent?.trim() ?? ''));
    return {
      counter: c ? c.textContent.trim() : null,
      src: btn ? btn.src : null,
      complete: btn ? btn.complete : null,
      naturalWidth: btn ? btn.naturalWidth : null,
    };
  });

  for (let i = 0; i < 24; i++) {
    const r = await read();
    const ok = r.naturalWidth > 0;
    console.log(`${r.counter ?? '?'} ${ok ? 'OK  ' : 'FAIL'} w=${r.naturalWidth ?? '-'} ${r.src?.slice(0, 90) ?? '(no img)'}`);
    if (i < 23) {
      await page.getByRole('button', { name: /next artwork/i }).click().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
} catch (err) {
  console.error('PROBE_ERROR', err.message);
}
await browser.close();
