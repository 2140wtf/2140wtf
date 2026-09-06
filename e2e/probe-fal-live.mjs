import { chromium } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3500';

const extraArgs = (process.env.EXTRA_ARGS ?? '').split(' ').filter(Boolean);
const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox', ...extraArgs] });
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });

const consoleMsgs = [];
const pageErrors = [];
const failedRequests = [];
const falRequests = [];

page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 220)}`));
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 220)));
page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.url().includes('fal.live') || r.url().includes('fal')) {
    falRequests.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
  }
});

await page.goto(`${BASE}/fal-live`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12_000);

const probe = await page.evaluate(() => {
  const iframe = document.querySelector('iframe[title="fal.live AI generation studio"]');
  const out = { iframePresent: !!iframe };
  if (iframe) {
    const box = iframe.getBoundingClientRect();
    out.src = iframe.getAttribute('src');
    out.rect = { top: Math.round(box.top), left: Math.round(box.left), w: Math.round(box.width), h: Math.round(box.height) };
    // Heuristic: cross-origin iframe content can't be inspected, but load
    // events and referrer-policy headers shape what fal.live receives.
    out.sandbox = iframe.getAttribute('sandbox');
    out.allow = iframe.getAttribute('allow');
    out.referrerPolicy = iframe.getAttribute('referrerpolicy');
  }
  const main = document.querySelector('main.fal-live-height');
  if (main) {
    const mb = main.getBoundingClientRect();
    out.mainRect = { top: Math.round(mb.top), h: Math.round(mb.height) };
  }
  // What route is actually rendered? Onboarding gate vs studio.
  out.hasOnboarding = !!document.body.textContent.match(/Find people to follow|Skip and continue/);
  out.hasTrollbox = !!document.body.textContent.match(/TROLLBOX/);
  out.hasSignIn = !!document.body.textContent.match(/Sign in|Log in/);
  return out;
});

console.log('=== PROBE ===');
console.log(JSON.stringify(probe, null, 2));
console.log('=== CONSOLE (last 15) ===');
console.log(consoleMsgs.slice(-15).join('\n') || '(none)');
console.log('=== PAGE ERRORS ===');
console.log(pageErrors.join('\n') || '(none)');
console.log('=== FAILED REQUESTS (fal + last 10 others) ===');
console.log(falRequests.join('\n'));
console.log(failedRequests.slice(-10).join('\n') || '(none)');

await page.screenshot({ path: '/tmp/fal-live-mobile.png', fullPage: false });
console.log('screenshot: /tmp/fal-live-mobile.png');

await browser.close();
