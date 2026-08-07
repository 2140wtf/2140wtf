/** Probe: what's actually in the NIndexedDB event store after a feed load? */
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
console.log('[cold] feed loaded, probing IDB');
await page.waitForTimeout(4000);

const out = await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  const result = { dbs: dbs.map((d) => `${d.name}@v${d.version}`), stores: {} };
  for (const dbInfo of dbs) {
    if (!/event|nostr/i.test(dbInfo.name)) continue;
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbInfo.name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    for (const storeName of db.objectStoreNames) {
      const tx = db.transaction(storeName, 'readonly');
      const count = await new Promise((res) => {
        const q = tx.objectStore(storeName).count();
        q.onsuccess = () => res(q.result);
      });
      result.stores[`${dbInfo.name}.${storeName}`] = count;
    }
    db.close();
  }
  return result;
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
