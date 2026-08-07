/**
 * Cross-app cashu test:
 *   2140wtf ₿AO signet wallet creates a Lightning invoice (receive)
 *   → bao.markets wallet drawer pays it via Cashu melt (send)
 *   → 2140wtf wallet auto-mints the proofs (balance increases)
 *
 * Run: node tests-manual/cross-app-cashu.mjs
 * Needs: :3300 bao.markets dev (live API), :3301 2140wtf dev.
 */
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';

const BAO = 'http://localhost:3300';
const WTF = 'http://localhost:3301';
const API = 'https://relay.bao.network/bao-api/v1';
const PIN = '214021';
const AMOUNT = 15;

// Fresh bao.markets guest account (created against the live API)
async function createBaoAccount() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const challengeRes = await fetch(`${API}/auth/challenge`);
  const { challenge } = await challengeRes.json();
  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', `${API}/auth/guest`], ['method', 'POST'], ['challenge', challenge]],
    content: '',
  }, sk);
  const res = await fetch(`${API}/auth/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
  });
  if (!res.ok) throw new Error(`guest auth failed: ${res.status}`);
  const data = await res.json();
  return { pubkey, npub: nip19.npubEncode(pubkey), nsec: nip19.nsecEncode(sk), sessionToken: data.sessionToken || data.token };
}
const baoAccount = await createBaoAccount();
console.log('[bao] account', baoAccount.npub.slice(0, 20));

const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/bob/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
});

// ── Context 1: 2140wtf wallet (fresh identity) ──────────────────────────────
const ctxW = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const wtf = await ctxW.newPage();
wtf.on('pageerror', (e) => console.log('[wtf pageerror]', e.message.slice(0, 200)));
const wtfSk = generateSecretKey();
const wtfNsec = nip19.nsecEncode(wtfSk);
console.log('[2140wtf] identity', nip19.npubEncode(getPublicKey(wtfSk)).slice(0, 20));

await wtf.goto(`${WTF}/`, { waitUntil: 'domcontentloaded' });
const joinBtn = wtf.locator('button').filter({ hasText: /^\s*Join\s*$/ }).first();
await joinBtn.waitFor({ state: 'visible', timeout: 60_000 });
await joinBtn.click();
await wtf.waitForTimeout(1500);
await wtf.locator('input[placeholder*="nsec"]').first().fill(wtfNsec);
await wtf.locator('[role="dialog"] button').filter({ hasText: /Log in/i }).last().click();
await wtf.waitForTimeout(4000);
for (let i = 0; i < 6; i++) {
  let clicked = false;
  for (const pat of [/Skip for now/i, /Continue to 2140/i, /Let's go/i]) {
    const btn = wtf.locator('button:visible').filter({ hasText: pat }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) { await btn.click({ force: true }); await wtf.waitForTimeout(2200); clicked = true; break; }
  }
  if (clicked) continue;
  if (!wtf.url().includes('/wallet')) { await wtf.goto(`${WTF}/wallet`, { waitUntil: 'domcontentloaded' }); await wtf.waitForTimeout(3000); continue; }
  break;
}
await wtf.waitForTimeout(4000);
console.log('[2140wtf] wallet page loaded:', wtf.url());

// Switch to the ₿AO signet wallet (same mint as bao.markets)
const baoWalletBtn = wtf.locator('button:visible').filter({ hasText: /BAO Wallet/i }).first();
if (await baoWalletBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
  await baoWalletBtn.click();
  await wtf.waitForTimeout(4000);
}
await wtf.screenshot({ path: '/tmp/cross-01-wtf-wallet.png' });

// BAO Cashu section: Receive tab → Invoice sub-tab → amount → Create invoice
const invoiceSubTab = wtf.locator('button:visible').filter({ hasText: /^Invoice$/ }).last();
if (await invoiceSubTab.isVisible({ timeout: 4000 }).catch(() => false)) {
  await invoiceSubTab.scrollIntoViewIfNeeded();
  await invoiceSubTab.click();
  await wtf.waitForTimeout(1500);
}
const amountInput = wtf.locator('input[placeholder="Amount in demo sats"]:visible').last();
await amountInput.scrollIntoViewIfNeeded();
await amountInput.fill(String(AMOUNT));
await wtf.waitForTimeout(500);
const createInvBtn = wtf.locator('button:visible').filter({ hasText: /^Create invoice$/ }).last();
await createInvBtn.click();
console.log('[2140wtf] create invoice clicked');
await wtf.waitForTimeout(8000);
await wtf.screenshot({ path: '/tmp/cross-02-wtf-invoice.png' });

// Grab the invoice text — the <p> in the QR card holds ONLY the invoice
// (the Copy button is a sibling, not a child).
const invoiceText = await wtf.evaluate(() => {
  for (const p of document.querySelectorAll('p')) {
    const t = (p.textContent ?? '').trim();
    if (/^ln(tbs|bc|tb|sb|bcrt)/i.test(t)) return t;
  }
  return null;
});
if (!invoiceText) {
  console.log('[2140wtf] FAILED to find invoice on screen');
  await browser.close();
  process.exit(1);
}
console.log('[2140wtf] invoice:', invoiceText.slice(0, 55), '… length:', invoiceText.length);
// Persist the EXACT string for forensic inspection
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/wtf-invoice.txt', invoiceText);
const badChars = [...invoiceText].filter((c) => {
  const code = c.codePointAt(0);
  return !/[qpzry9x8gf2tvdw0s3jn54khce6mua7l1]/i.test(c);
});
console.log('[2140wtf] non-bech32 chars in invoice:', JSON.stringify(badChars), 'count:', badChars.length);
if (invoiceText.length < 100) {
  console.log('[2140wtf] invoice looks TRUNCATED — dumping candidates');
  const candidates = await wtf.evaluate(() => {
    const out = [];
    document.querySelectorAll('p, textarea, input, code, pre').forEach((el) => {
      const t = (el.value ?? el.textContent ?? '').trim();
      if (t.startsWith('lntbs')) out.push({ tag: el.tagName, len: t.length, head: t.slice(0, 40) });
    });
    return out;
  });
  console.log(JSON.stringify(candidates));
  await browser.close();
  process.exit(1);
}

// ── Context 2: bao.markets — fund + pay the invoice ─────────────────────────
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const bao = await ctxB.newPage();
bao.on('pageerror', (e) => console.log('[bao pageerror]', e.message.slice(0, 200)));

await bao.goto(`${BAO}/demo/markets`, { waitUntil: 'domcontentloaded' });
await bao.evaluate((s) => {
  localStorage.setItem('bao_session', JSON.stringify({
    pubkey: s.pubkey, npub: s.npub, via: 'guest', profile: null,
    secretKey: null, nip46Client: null, sessionToken: s.sessionToken,
  }));
  localStorage.setItem('bao_guest_key_backup', JSON.stringify({
    pubkey: s.pubkey, privateKey: s.nsec, username: 'G', createdAt: Date.now(),
  }));
}, baoAccount);
await bao.reload({ waitUntil: 'domcontentloaded' });
await bao.waitForTimeout(5000);

// Faucet claim (cashu rail) → wait for IDB proofs (auto-collect)
await bao.evaluate(() => window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'balance', rail: 'cashu' } })));
await bao.waitForTimeout(2500);
const claimBtn = bao.locator('[role="dialog"] button').filter({ hasText: /CLAIM\s*21\b/i }).first();
if (await claimBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
  await claimBtn.click();
  console.log('[bao] faucet claimed');
  await bao.waitForTimeout(12000);
  const claimText = ((await bao.locator('[role="dialog"]').textContent()) || '').replace(/\s+/g, ' ');
  console.log('[bao] drawer after claim:', claimText.slice(0, 400));
}
// Wait for the backend async mint → pending payout visible server-side
let pendingCount = 0;
const pStart = Date.now();
while (Date.now() - pStart < 90_000) {
  pendingCount = await fetch(`${API}/wallet/cashu-pending`, {
    headers: { Authorization: `Bearer ${baoAccount.sessionToken}` },
  }).then((r) => r.json()).then((d) => d.data?.tokens?.length ?? 0).catch(() => 0);
  if (pendingCount > 0) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('[bao] server pending tokens:', pendingCount);
// Watch for collect failures in console
bao.on('console', (m) => { if (/Failed to receive|collect|payout/i.test(m.text())) console.log('[bao c]', m.text().slice(0, 200)); });
const fundStart = Date.now();
let idbSum = 0;
while (Date.now() - fundStart < 120_000) {
  await bao.waitForTimeout(4000);
  idbSum = await bao.evaluate(async () => {
    const { loadProofsFromIndexedDB } = await import('/packages/markets/services/bao-markets/CashuSettlement.ts');
    const proofs = await loadProofsFromIndexedDB('https://relay.bao.network/cashu');
    return proofs.reduce((s, p) => s + p.amount, 0);
  }).catch(() => -1);
  if (idbSum > 0) break;
}
console.log('[bao] IDB proofs sum:', idbSum);
if (idbSum < AMOUNT) {
  console.log('[bao] funding failed');
  await browser.close();
  process.exit(1);
}

// Send → cashu rail → paste the 2140wtf invoice → PIN → melt
await bao.evaluate(() => window.dispatchEvent(new CustomEvent('bao-open-wallet-drawer', { detail: { tab: 'send', rail: 'cashu' } })));
await bao.waitForTimeout(2500);
const cashuRail = bao.locator('[role="dialog"] button').filter({ hasText: /Cashu/i }).first();
if (await cashuRail.isVisible({ timeout: 3000 }).catch(() => false)) { await cashuRail.click(); await bao.waitForTimeout(800); }
const field = bao.locator('[role="dialog"] textarea, [role="dialog"] input[type="text"]').first();
await field.click();
await field.fill(invoiceText);
await bao.waitForTimeout(1500);
for (const label of [/^Continue$/i, /Send|Pay now|Confirm/i]) {
  const btn = bao.locator('[role="dialog"] button').filter({ hasText: label }).last();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false) && await btn.isEnabled().catch(() => false)) {
    await btn.click(); await bao.waitForTimeout(2000);
  }
}
await bao.screenshot({ path: '/tmp/cross-03-bao-before-pin.png' });
const createM = bao.locator('text=Set Wallet PIN').first();
const verifyM = bao.locator('text=Confirm PIN').first();
if (await createM.isVisible({ timeout: 4000 }).catch(() => false)) {
  console.log('[bao] PIN create');
  await bao.keyboard.type(PIN, { delay: 70 });
  await bao.locator('button').filter({ hasText: /^Continue$/ }).first().click();
  await bao.waitForTimeout(500);
  await bao.keyboard.type(PIN, { delay: 70 });
  await bao.locator('button').filter({ hasText: /^Set PIN$/ }).first().click();
} else if (await verifyM.isVisible({ timeout: 4000 }).catch(() => false)) {
  console.log('[bao] PIN verify');
  await bao.keyboard.type(PIN, { delay: 70 });
  await bao.locator('button').filter({ hasText: /^Confirm$/ }).first().click();
}
await bao.waitForTimeout(10000);
await bao.screenshot({ path: '/tmp/cross-04-bao-outcome.png' });
const baoText = ((await bao.locator('body').textContent()) || '').replace(/\s+/g, ' ');
const outcomeIdx = baoText.search(/Payment Failed|Payment Sent|Payment Successful|Success/i);
console.log('[bao] outcome:', outcomeIdx >= 0 ? baoText.slice(outcomeIdx, outcomeIdx + 200) : baoText.slice(-300));

// ── Back to 2140wtf: verify the invoice got paid & minted ───────────────────
wtf.on('console', (m) => { if (/mint|quote|proof|nip60/i.test(m.text())) console.log('[wtf c]', m.text().slice(0, 200)); });
let minted = false;
for (let i = 0; i < 12; i++) {
  await wtf.waitForTimeout(5000);
  const t = ((await wtf.locator('body').textContent()) || '').replace(/\s+/g, ' ');
  const m = t.match(/Cashu\s*(\d+)\s*demo sats/) ?? t.match(/(\d+)\s*demo sats/);
  console.log(`[2140wtf] t+${(i + 1) * 5}s balance:`, m ? m[1] : '?');
  if (m && Number(m[1]) >= AMOUNT) { minted = true; break; }
}
console.log('[2140wtf] MINTED (auto):', minted);
if (!minted) {
  // Manual path: the UI offers "Confirm payment" when NUT-17 doesn't fire
  const confirmBtn = wtf.locator('button:visible').filter({ hasText: /Confirm payment/i }).first();
  if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('[2140wtf] clicking Confirm payment…');
    await confirmBtn.click();
    await wtf.waitForTimeout(12000);
    const t = ((await wtf.locator('body').textContent()) || '').replace(/\s+/g, ' ');
    const m = t.match(/(\d+)\s*demo sats/);
    console.log('[2140wtf] balance after manual confirm:', m ? m[1] : '?');
    minted = !!m && Number(m[1]) >= AMOUNT;
  } else {
    console.log('[2140wtf] no Confirm payment button visible');
  }
  // Inspect the quote state directly from the wallet's own store
  const quoteInfo = await wtf.evaluate(() => {
    const out = { pendingTxs: [] };
    return out;
  }).catch(() => null);
}
console.log('[2140wtf] MINTED (final):', minted);
await wtf.screenshot({ path: '/tmp/cross-05-wtf-final.png' });
await browser.close();
