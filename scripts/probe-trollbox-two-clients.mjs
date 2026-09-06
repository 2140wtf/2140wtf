// End-to-end delivery proof on LIVE production: two independent burner
// clients (separate browser contexts, separate identities) both open
// https://2140.wtf/fal-live, join the Trollbox on the pinned relay
// (wss://2140.social/ws), client A posts a unique marker, client B must
// receive it. Read-only apart from ONE clearly-labeled test message.
import { chromium } from 'playwright-core';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const BASE = process.env.PROD_BASE ?? 'https://2140.wtf';
const APP_ID = '2140wtf';
const MARKER = `probe-e2e-${Date.now().toString(36)}`;

function makeClient(browser, label) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const nsec = nip19.nsecEncode(sk);
  const login = { id: `nsec:${pubkey}`, type: 'nsec', pubkey, createdAt: new Date().toISOString(), data: { nsec } };
  const ctxP = (async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.addInitScript((value) => localStorage.setItem('nostr:login', value), JSON.stringify([login]));
    await page.addInitScript((kv) => {
      localStorage.setItem(kv.syncDoneKey, '1');
      localStorage.setItem(kv.lastSyncKey, String(kv.lastSync));
    }, { syncDoneKey: `${APP_ID}:sync-done:${pubkey}`, lastSyncKey: `${APP_ID}:settings-lastSync:${pubkey}`, lastSync: Date.now() });
    const sockets = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(`${BASE}/fal-live`, { waitUntil: 'domcontentloaded' });
    return { label, context, page, sockets, pubkey };
  })();
  return ctxP;
}

const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
console.log(`MARKER: ${MARKER}`);

const [A, B] = await Promise.all([makeClient(browser, 'A'), makeClient(browser, 'B')]);
const a = await A, b = await B;

// Both must open the pinned relay socket
await Promise.all([a, b].map(async (c) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    if (c.sockets.some((u) => u.includes('2140.social/ws'))) return;
    await c.page.waitForTimeout(300);
  }
}));
for (const c of [a, b]) {
  console.log(`${c.label} pinned-relay socket:`, c.sockets.some((u) => u.includes('2140.social/ws')) ? 'OPEN' : 'MISSING');
}

// Both must reach joinPhase 'ready' (composer enabled + green dot).
// Expand the trollbox first — the composer lives inside the collapsed bar
// by default on mobile.
async function waitReady(c, timeoutMs) {
  try {
    await c.page.getByRole('button', { name: 'Expand Trollbox' }).tap({ timeout: 5_000 });
  } catch { /* maybe already expanded */ }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const state = await c.page.evaluate(() => {
      const ta = document.querySelector('main.fal-live-height aside textarea');
      const dot = document.querySelector('main.fal-live-height aside [role="status"]');
      const visible = !!ta && ta.offsetParent !== null;
      return { enabled: !!ta && !ta.disabled && visible, dot: dot?.getAttribute('aria-label') ?? null };
    });
    if (state.enabled) return state;
    await c.page.waitForTimeout(500);
  }
  return null;
}
const [readyA, readyB] = await Promise.all([waitReady(a, 90_000), waitReady(b, 90_000)]);
console.log('A ready:', JSON.stringify(readyA));
console.log('B ready:', JSON.stringify(readyB));

if (!readyA || !readyB) {
  console.log('RESULT: FAIL — one or both clients never joined');
  await browser.close();
  process.exit(1);
}

// A posts the marker
await a.page.fill('main.fal-live-height aside textarea', `${MARKER} (automated relay-delivery test)`);
await a.page.press('main.fal-live-height aside textarea', 'Enter');
console.log('A posted marker');

// B must see it in its scroll
const t1 = Date.now();
let received = false;
while (Date.now() - t1 < 30_000) {
  const text = await b.page.evaluate(() => document.querySelector('main.fal-live-height aside')?.innerText ?? '');
  if (text.includes(MARKER)) { received = true; break; }
  await b.page.waitForTimeout(500);
}
console.log('B received marker:', received);
console.log('RESULT:', received ? 'PASS — same relay, same room, cross-client delivery confirmed on production' : 'FAIL');

await browser.close();
process.exit(received ? 0 : 1);
