// Verify the min WoT bid gate in the browser on the demo auctions.
//  1. Open demo auction (no min_wot): bid dialog shows no WoT warning,
//     confirm enabled.
//  2. Gated demo auction (min_wot=99): bid dialog shows the gentle block
//     message and the confirm button is disabled (fresh account scores 0).
// Authenticated via an ephemeral throwaway nsec in localStorage.
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const BASE = process.env.BASE_URL ?? 'http://localhost:3501';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);
const loginBlob = JSON.stringify([{ type: 'nsec', pubkey, data: { nsec } }]);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

await page.addInitScript((blob) => {
  window.localStorage.setItem('nostr:login', blob);
}, loginBlob);

await page.goto(`${BASE}/market`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.waitForTimeout(5_000);

// Dismiss the first-run onboarding overlay if it is blocking the page.
const skip = page.getByRole('button', { name: /skip (and continue|for now)/i }).first();
if (await skip.isVisible().catch(() => false)) {
  await skip.click();
  await page.waitForTimeout(3_000);
}

// Switch to the Auctions view via the segmented toggle.
const auctionsToggle = page.getByRole('button', { name: 'Auctions', exact: true });
await auctionsToggle.click({ timeout: 30_000 });
await page.waitForTimeout(6_000);

async function probeCard(titleRegex, shotPath) {
  // Find the auction card by its title, then click its Place bid button.
  const card = page
    .locator('div')
    .filter({ has: page.getByText(titleRegex).first() })
    .filter({ has: page.getByRole('button', { name: /place bid/i }) })
    .last();
  const count = await card.count();
  console.log(`Card "${titleRegex}" candidates:`, count);
  if (count === 0) return null;
  await card.first().getByRole('button', { name: /place bid/i }).first().click();
  await page.waitForTimeout(1_500);
  const dialog = page.locator('[role="dialog"]');
  if (!(await dialog.isVisible().catch(() => false))) {
    console.log('Dialog did not open for', titleRegex);
    return null;
  }
  const text = await dialog.innerText();
  const confirm = dialog.getByRole('button', { name: /lock bid in escrow/i });
  const result = {
    woTWarning: /Web of Trust/.test(text),
    confirmEnabled: await confirm.isEnabled().catch(() => false),
    confirmLabel: await confirm.innerText().catch(() => ''),
  };
  console.log(titleRegex, JSON.stringify(result));
  await page.screenshot({ path: shotPath });
  await dialog.getByRole('button', { name: /cancel/i }).click().catch(() => {});
  await page.waitForTimeout(500);
  return result;
}

const open = await probeCard(/Demo Auction — Vintage Bitcoin Poster/i, 'e2e/shots/wot-gate-open.png');
const gated = await probeCard(/WoT Gated/i, 'e2e/shots/wot-gate-blocked.png');

let pass = true;
if (!open || open.woTWarning || !open.confirmEnabled) {
  console.log('FAIL: open auction should have no WoT warning and enabled confirm');
  pass = false;
}
if (!gated || !gated.woTWarning || gated.confirmEnabled) {
  console.log('FAIL: gated auction should show WoT warning and disabled confirm');
  pass = false;
}
console.log(pass ? 'WOT GATE VERIFY: PASS' : 'WOT GATE VERIFY: FAIL');

await browser.close();
process.exit(pass ? 0 : 1);
