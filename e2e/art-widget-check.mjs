import { chromium } from 'playwright';

const BASE = 'http://localhost:3501';
const results = { steps: [], images: [], errors: [] };
const log = (s) => results.steps.push(s);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on('console', (msg) => {
  if (['error', 'warning'].includes(msg.type())) results.errors.push(`[console.${msg.type}] ${msg.text()}`);
});
page.on('pageerror', (err) => results.errors.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => {
  const u = req.url();
  if (/\.(png|jpe?g|webp|gif|avif|svg)/i.test(u)) results.errors.push(`[img-req-failed] ${u}`);
});

// 1) Load app
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
log(`loaded ${page.url()}`);

// 2) Open widget picker and add Timechain Art widget
const pickerBtn = page.getByRole('button', { name: /add widget/i });
await pickerBtn.waitFor({ state: 'visible', timeout: 10000 });
await pickerBtn.click();
const option = page.getByText(/timechain art/i).first();
await option.waitFor({ state: 'visible', timeout: 10000 });
await option.click();
log('clicked Timechain Art in picker');

// close picker if it stays open
const closeBtn = page.getByRole('button', { name: /done|close|add/i });
if (await closeBtn.isVisible().catch(() => false)) {
  await closeBtn.click().catch(() => {});
  log('closed picker');
}

// 3) Wait for the widget to render and check images
await page.waitForTimeout(6000);

const imgs = page.locator('img');
const count = await imgs.count();
log(`found ${count} <img> elements`);

for (let i = 0; i < count; i++) {
  const src = await imgs.nth(i).getAttribute('src');
  let status = null;
  try {
    const resp = await page.request.get(src, { timeout: 10000 });
    status = resp.status();
  } catch (e) {
    status = `ERR ${e.message.slice(0, 60)}`;
  }
  results.images.push({ src, status });
}

const natural = await page.evaluate(() =>
  Array.from(document.querySelectorAll('img')).map((img) => ({
    src: img.src.slice(0, 90),
    complete: img.complete,
    naturalWidth: img.naturalWidth,
  }))
);
results.images = results.images.concat(natural.map((n) => ({ src: n.src, natural: n })));

console.log(JSON.stringify(results, null, 2));
await browser.close();
