/**
 * Live localhost acceptance test for BAO API claims + portable NIP-60 Cashu.
 *
 * Creates two ephemeral Nostr identities, claims real BAO signet proofs into
 * both wallets, then sends A -> B and B -> A by npub. Secret keys and Cashu
 * tokens are never printed or written to disk.
 *
 * Run: node tests-manual/bao-nip60-two-account.mjs
 */
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const APP = process.env.WTF_URL || 'http://127.0.0.1:3500';
const CLAIM = 21;
const TRANSFER = 5;

function createIdentity() {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  return { pubkey, npub: nip19.npubEncode(pubkey), nsec: nip19.nsecEncode(secret) };
}

async function openWallet(browser, identity, label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${APP}/wallet`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const login = page.locator('button').filter({ hasText: /^\s*Log in\s*$/ }).last();
  await login.waitFor({ state: 'visible', timeout: 30_000 });
  await login.click();
  await page.locator('input[placeholder="nsec1..."]').fill(identity.nsec);
  await page.locator('[role="dialog"] button').filter({ hasText: /^\s*Log in\s*$/ }).click();
  await page.waitForTimeout(1_000);
  await page.evaluate(({ pubkey }) => {
    localStorage.setItem(`2140:sync-done:${pubkey}`, '1');
  }, identity);
  await page.goto(`${APP}/wallet`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const baoTab = page.getByRole('tab', { name: /BAO Wallet/i });
  await baoTab.waitFor({ state: 'visible', timeout: 30_000 });
  await baoTab.click();
  try {
    await page.getByText(/testnet coins/i).waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    console.log(`[${label}] wallet screen:`, (await page.locator('body').innerText()).slice(0, 2_000));
    throw error;
  }
  await page.getByRole('button', { name: /Cashu/i }).first().click();
  await page.getByText('Advanced Cashu wallet', { exact: true }).click();

  const enable = page.getByRole('button', { name: /Enable NIP-60 send and receive/i });
  if (await enable.isVisible().catch(() => false)) {
    await enable.click();
    await enable.waitFor({ state: 'hidden', timeout: 30_000 });
  }

  console.log(`[${label}] wallet ready ${identity.npub.slice(0, 16)}…`);
  return { context, page, errors };
}

async function portableBalance(page) {
  const text = await page.locator('details').filter({ hasText: 'Advanced Cashu wallet' }).innerText();
  const match = text.match(/(?:^|\n)([\d,]+)\s*\n?demo sats(?:\n|$)/i);
  return match ? Number(match[1].replaceAll(',', '')) : -1;
}

async function claim(page, label) {
  const input = page.getByLabel('Claim amount in sats');
  await input.fill(String(CLAIM));
  await page.getByRole('button', { name: /^Claim Cashu$/ }).click();
  await page.getByText(/BAO Cashu claimed|Could not claim BAO Cashu/, { exact: true }).first().waitFor({ state: 'visible', timeout: 240_000 });
  const body = await page.locator('body').innerText();
  if (body.includes('Could not claim BAO Cashu')) {
    const notification = await page.locator('[role="status"]').last().innerText().catch(() => 'No API error detail rendered');
    throw new Error(`[${label}] claim failed: ${notification.replace(/\s+/g, ' ')}`);
  }
  await page.waitForFunction(() => {
    const details = [...document.querySelectorAll('details')].find((node) => node.textContent?.includes('Advanced Cashu wallet'));
    const match = details?.textContent?.match(/(\d[\d,]*)\s*demo sats/i);
    return match && Number(match[1].replaceAll(',', '')) >= 21;
  }, undefined, { timeout: 30_000 });
  console.log(`[${label}] claimed; portable balance=${await portableBalance(page)}`);
}

async function send(page, recipientNpub, amount, label) {
  await page.getByRole('tab', { name: /^Send$/ }).last().click();
  await page.getByText('Send directly to an npub', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByPlaceholder('Recipient npub1…').fill(recipientNpub);
  const card = page.locator('div').filter({ hasText: 'Send directly to an npub' }).filter({ has: page.getByPlaceholder('Recipient npub1…') }).last();
  await card.getByPlaceholder('Amount in demo sats').fill(String(amount));
  await card.getByRole('button', { name: /^Send to npub$/ }).click();
  await page.getByText(/BAO Cashu sent|Payment saved for delivery|Payment status unknown/).waitFor({ state: 'visible', timeout: 90_000 });
  const body = await page.locator('body').innerText();
  if (!body.includes('BAO Cashu sent')) throw new Error(`[${label}] transfer did not confirm as sent`);
  console.log(`[${label}] sent ${amount} sats`);
}

const accountA = createIdentity();
const accountB = createIdentity();
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome' });

try {
  const a = await openWallet(browser, accountA, 'A');
  const b = await openWallet(browser, accountB, 'B');
  await Promise.all([claim(a.page, 'A'), claim(b.page, 'B')]);

  const bBefore = await portableBalance(b.page);
  await send(a.page, accountB.npub, TRANSFER, 'A -> B');
  await b.page.waitForFunction((before) => {
    const details = [...document.querySelectorAll('details')].find((node) => node.textContent?.includes('Advanced Cashu wallet'));
    const match = details?.textContent?.match(/(\d[\d,]*)\s*demo sats/i);
    return match && Number(match[1].replaceAll(',', '')) > before;
  }, bBefore, { timeout: 90_000 });

  const aBeforeReturn = await portableBalance(a.page);
  await send(b.page, accountA.npub, TRANSFER, 'B -> A');
  await a.page.waitForFunction((before) => {
    const details = [...document.querySelectorAll('details')].find((node) => node.textContent?.includes('Advanced Cashu wallet'));
    const match = details?.textContent?.match(/(\d[\d,]*)\s*demo sats/i);
    return match && Number(match[1].replaceAll(',', '')) > before;
  }, aBeforeReturn, { timeout: 90_000 });

  if (a.errors.length || b.errors.length) {
    console.log('Browser console errors:', [...a.errors, ...b.errors].slice(0, 10));
  }
  console.log(`PASS A=${await portableBalance(a.page)} B=${await portableBalance(b.page)}`);
} finally {
  await browser.close();
}
