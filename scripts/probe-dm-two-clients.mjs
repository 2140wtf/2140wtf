// End-to-end NIP-17 DM delivery proof on LIVE production, round-28 style:
// two independent burner clients (separate contexts, separate identities):
//   A → /messages/<B.npub>: send marker 1 via the app composer.
//   B → /messages/<A.npub>: marker 1 must appear in B's inbox live.
//   B replies marker 2; A must receive it live (both directions).
//   RELOAD both pages: the paginated backfill must restore BOTH markers
//   (regression guard for the round-28 fetch rewrite).
// Read-only apart from 2 clearly-labeled burner DMs between each other.
import { chromium } from 'playwright-core';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const BASE = process.env.PROD_BASE ?? 'https://2140.wtf';
const APP_ID = '2140'; // real appId (e2e/fixtures/ditto.json) — keys are '<appId>:sync-done:<pk>'
const M1 = `probe-dm-a2b-${Date.now().toString(36)}`;
const M2 = `probe-dm-b2a-${Date.now().toString(36)}`;

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
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 150)));
    return { label, context, page, pageErrors, pubkey, npub: nip19.npubEncode(pubkey) };
  })();
  return ctxP;
}

async function openThread(c, url) {
  await c.page.goto(url, { waitUntil: 'domcontentloaded' });
  // Wait for the composer Input (placeholder "Message...") to exist.
  await c.page.getByPlaceholder('Message...').waitFor({ state: 'visible', timeout: 30_000 });
}

async function sendViaComposer(c, text) {
  const input = c.page.getByPlaceholder('Message...');
  await input.fill(text);
  await input.press('Enter');
}

/** Poll the thread's message bubbles for the marker text. */
async function waitForMessage(c, marker, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const found = await c.page.evaluate((m) => {
      const bubbles = [...document.querySelectorAll('main .space-y-3 p.whitespace-pre-wrap')];
      return bubbles.some((p) => p.textContent?.includes(m));
    }, marker);
    if (found) return true;
    await c.page.waitForTimeout(700);
  }
  return false;
}

const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
console.log(`MARKERS: A→B=${M1}  B→A=${M2}`);

const [A, B] = await Promise.all([makeClient(browser, 'A'), makeClient(browser, 'B')]);
const a = await A, b = await B;
console.log(`A pubkey: ${a.pubkey}`);
console.log(`B pubkey: ${b.pubkey}`);

// 1) A opens thread with B and sends marker 1.
await openThread(a, `${BASE}/messages/${b.npub}`);
await sendViaComposer(a, M1);
console.log('A sent marker 1 via composer');

// 2) B opens thread with A; marker 1 must appear LIVE (no reload).
await openThread(b, `${BASE}/messages/${a.npub}`);
const liveB = await waitForMessage(b, M1, 60_000);
console.log('B received marker 1 live:', liveB);

// 3) B replies with marker 2; A must receive it live.
await sendViaComposer(b, M2);
const liveA = await waitForMessage(a, M2, 60_000);
console.log('A received marker 2 live:', liveA);

// 4) RELOAD both — paginated backfill must restore full history.
await a.page.reload({ waitUntil: 'domcontentloaded' });
await b.page.reload({ waitUntil: 'domcontentloaded' });
await a.page.getByPlaceholder('Message...').waitFor({ state: 'visible', timeout: 30_000 });
await b.page.getByPlaceholder('Message...').waitFor({ state: 'visible', timeout: 30_000 });
const backA1 = await waitForMessage(a, M1, 45_000);
const backA2 = await waitForMessage(a, M2, 45_000);
const backB1 = await waitForMessage(b, M1, 45_000);
const backB2 = await waitForMessage(b, M2, 45_000);
console.log(`After reload — A sees [1:${backA1} 2:${backA2}]  B sees [1:${backB1} 2:${backB2}]`);

const pass = liveB && liveA && backA1 && backA2 && backB1 && backB2;
console.log('A page errors:', a.pageErrors.length, ' B page errors:', b.pageErrors.length);
console.log(`RESULT: ${pass ? 'PASS' : 'FAIL'} — two-client NIP-17 DM delivery + backfill on production`);

await browser.close();
process.exit(pass ? 0 : 1);
