/** Probe 2: kind histogram + run the seed query directly. */
import { chromium } from 'playwright';

const APP = 'http://localhost:3301';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});
const page = await (await browser.newContext()).newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });
const t0 = Date.now();
while (Date.now() - t0 < 40000) {
  if ((await page.evaluate(() => document.querySelectorAll('article, [class*="NoteCard"]').length)) > 0) break;
  await page.waitForTimeout(100);
}
await page.waitForTimeout(3000);

const out = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('nostr');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction('events', 'readonly');
  const all = await new Promise((res) => { const q = tx.objectStore('events').getAll(); q.onsuccess = () => res(q.result); });
  const kinds = {};
  for (const ev of all) kinds[ev.kind] = (kinds[ev.kind] ?? 0) + 1;
  // Feed-ish kinds present?
  const feedEvents = all.filter((ev) => [1, 6, 16, 1068, 6969, 1111, 30023].includes(ev.kind));
  feedEvents.sort((a, b) => b.created_at - a.created_at);
  db.close();
  return {
    totalEvents: all.length,
    kindHistogram: kinds,
    feedLikeCount: feedEvents.length,
    newestFeedEventAge_s: feedEvents[0] ? Math.floor(Date.now() / 1000) - feedEvents[0].created_at : null,
    sample: feedEvents.slice(0, 3).map((e) => ({ kind: e.kind, content: (e.content || '').slice(0, 60) })),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
