/** Capture the full stack of the 'Bech32 string is not valid' melt failure. */
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';

const BAO = 'http://localhost:3300';
const API = 'https://relay.bao.network/bao-api/v1';
const MINT = 'https://relay.bao.network/cashu';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const { challenge } = await (await fetch(`${API}/auth/challenge`)).json();
const event = finalizeEvent({
  kind: 27235, created_at: Math.floor(Date.now() / 1000),
  tags: [['u', `${API}/auth/guest`], ['method', 'POST'], ['challenge', challenge]], content: '',
}, sk);
const auth = await (await fetch(`${API}/auth/guest`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
})).json();
const account = { pubkey, npub: nip19.npubEncode(pubkey), nsec: nip19.nsecEncode(sk), sessionToken: auth.sessionToken || auth.token };

// Fresh 15-sat invoice from the mint (same as 2140wtf wallet creates)
const quote = await (await fetch(`${MINT}/v1/mint/quote/bolt11`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount: 15, unit: 'sat' }),
})).json();
console.log('[invoice] len:', quote.request.length, quote.request.slice(0, 40));

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BAO}/demo/markets`, { waitUntil: 'domcontentloaded' });
await page.evaluate((s) => {
  localStorage.setItem('bao_session', JSON.stringify({
    pubkey: s.pubkey, npub: s.npub, via: 'guest', profile: null,
    secretKey: null, nip46Client: null, sessionToken: s.sessionToken,
  }));
  localStorage.setItem('bao_guest_key_backup', JSON.stringify({
    pubkey: s.pubkey, privateKey: s.nsec, username: 'G', createdAt: Date.now(),
  }));
}, account);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

const out = await page.evaluate(async ({ bolt11 }) => {
  try {
    // Replicate requestWithdraw's melt-quote step with the app's wallet
    const { Wallet } = await import('/node_modules/.vite/deps/@cashu_cashu-ts.js');
    const w = new Wallet('https://relay.bao.network/cashu', { unit: 'sat' });
    await w.loadMint();
    const q = await w.createMeltQuoteBolt11(bolt11);
    return { ok: true, quote: { amount: q.amount, fee: q.fee_reserve, state: q.state } };
  } catch (e) {
    return { ok: false, message: e.message, stack: (e.stack || '').split('\n').slice(0, 8) };
  }
}, { bolt11: quote.request });
console.log(JSON.stringify(out, null, 2));
await browser.close();
