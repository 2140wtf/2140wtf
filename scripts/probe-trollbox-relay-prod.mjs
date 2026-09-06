// Production probe: does the trollbox (BaoScrollChat in locked-room mode on
// /fal-live) actually open its WebSocket to wss://2140.social/ws, join, and
// reach "relay live" for an authed user? Read-only: fresh throwaway identity,
// listens to the scroll, posts nothing.
import { chromium } from 'playwright-core';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import fs from 'node:fs';

const BASE = process.env.PROD_BASE ?? 'https://2140.wtf';
const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);
const login = { id: `nsec:${pubkey}`, type: 'nsec', pubkey, createdAt: new Date().toISOString(), data: { nsec } };
const appId = '2140wtf';

const browser = await chromium.launch({ args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

const wsUrls = [];
const notice = [];
page.on('websocket', (ws) => {
  wsUrls.push(ws.url());
});
page.on('console', (m) => {
  const t = m.text();
  if (/join|relay|scroll|welcomer|error/i.test(t)) notice.push(t.slice(0, 160));
});
page.on('pageerror', (e) => notice.push('PAGEERROR: ' + String(e).slice(0, 160)));

await page.addInitScript((value) => localStorage.setItem('nostr:login', value), JSON.stringify([login]));
await page.addInitScript((kv) => {
  localStorage.setItem(kv.syncDoneKey, '1');
  localStorage.setItem(kv.lastSyncKey, String(kv.lastSync));
}, { syncDoneKey: `${appId}:sync-done:${pubkey}`, lastSyncKey: `${appId}:settings-lastSync:${pubkey}`, lastSync: Date.now() });

await page.goto(`${BASE}/fal-live`, { waitUntil: 'domcontentloaded' });

// Wait for either the socket or 20s
const t0 = Date.now();
let socketSeen = false;
while (Date.now() - t0 < 20_000) {
  if (wsUrls.some((u) => u.includes('2140.social'))) { socketSeen = true; break; }
  await page.waitForTimeout(500);
}
console.log('WEBSOCKETS_SEEN:', wsUrls.length ? wsUrls.join(', ') : 'none');
console.log('TROLLBOX_RELAY_SOCKET:', socketSeen);

// Status text in the chat UI (relay live / joining / error / loading)
await page.waitForTimeout(4000);
const status = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((s) => /relay live|joining|idle|Join failed|Loading scroll/.test(s.textContent ?? ''));
  return el?.textContent ?? '(status row not found)';
});
console.log('CHAT_STATUS_TEXT:', status);
const body = (await page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400);
console.log('BODY_SNIPPET:', body);
console.log('CONSOLE_INTERESTING:', notice.slice(0, 8).join(' // ') || 'none');

await browser.close();
process.exit(socketSeen ? 0 : 1);
