/**
 * Capture LOGIN-GATED showcase screenshots (wallet, zap flow).
 *
 * Credentials NEVER touch this repo or the transcript:
 *   echo nsec1... > .capture-nsec   (gitignored)
 *   node scripts/capture-gated-shots.mjs [baseUrl]
 *
 * The key is read at runtime, used only to sign in through the app's own
 * LoginDialog, and nothing is printed. No payment is ever confirmed — the
 * zap shot stops at the invoice QR.
 *
 * Outputs:
 *   public/shots/wallet.png      — Cashu wallet view
 *   public/shots/zap-dialog.png  — zap dialog with invoice QR visible
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = join(root, 'public', 'shots');
const baseUrl = process.argv[2] ?? 'https://2140.wtf';

const secretFile = join(root, '.capture-nsec');
let NSEC;
try {
  NSEC = readFileSync(secretFile, 'utf8').trim();
} catch {
  console.error(`Missing ${secretFile}. Create it with:\n  echo nsec1... > .capture-nsec\nThe file is gitignored; the key never leaves this machine.`);
  process.exit(1);
}
if (!/^nsec1[a-zA-Z0-9]{58}$/.test(NSEC)) {
  console.error('.capture-nsec does not contain a valid nsec1… key');
  process.exit(1);
}

mkdirSync(shotsDir, { recursive: true });

async function forceDark(page) {
  for (let i = 0; i < 3; i++) {
    const isDark = await page.evaluate(() => document.documentElement.className.includes('dark'));
    if (isDark) return true;
    await page.evaluate(() => document.querySelector('button[aria-label^="Color mode:"]')?.click());
    await page.waitForTimeout(700);
  }
  return false;
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  // --- Log in through the app's own dialog ---------------------------------
  console.log('logging in via LoginDialog…');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await forceDark(page);

  await page.getByRole('button', { name: /^Log in$/i }).first().click();
  const nsecInput = page.locator('#nsec');
  await nsecInput.waitFor({ state: 'visible', timeout: 20_000 });
  await nsecInput.fill(NSEC);
  await page.getByRole('button', { name: /^Log in$/i }).last().click();

  // Logged-in signal: the logged-out "Log in" entry point disappears.
  await page
    .waitForFunction(
      () => ![...document.querySelectorAll('a,button')].some((el) => el.textContent?.trim() === 'Sign up'),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {});
  const loggedIn = !(await page
    .locator('a,button')
    .filter({ hasText: /^Sign up$/ })
    .first()
    .isVisible()
    .catch(() => false));
  if (!loggedIn) {
    console.error('Login did not complete — aborting before any capture.');
    process.exit(1);
  }
  console.log('logged in ✓');

  // --- Wallet ----------------------------------------------------------------
  console.log('capturing wallet…');
  await page.goto(`${baseUrl}/wallet`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: join(shotsDir, 'wallet.png') });

  // --- Zap dialog (invoice only — NEVER confirm payment) ----------------------
  console.log('capturing zap dialog…');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(4_000);
  const zapTrigger = page
    .locator('[aria-label*="zap" i], [title*="zap" i]')
    .first();
  if (await zapTrigger.isVisible().catch(() => false)) {
    await zapTrigger.click({ trial: true }).catch(() => {});
    await page.waitForTimeout(6_000); // invoice fetch
    const qrVisible = await page
      .locator('[aria-label="Lightning invoice QR code"]')
      .isVisible()
      .catch(() => false);
    if (qrVisible) {
      await page.screenshot({ path: join(shotsDir, 'zap-dialog.png') });
      console.log('zap invoice captured (payment NOT confirmed)');
    } else {
      console.warn('zap dialog did not reach invoice QR — skipping shot');
    }
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    console.warn('no zap trigger visible on feed — skipping zap shot');
  }

  // Hard stop: make sure nothing was published/paid by this session.
  await context.close();
  console.log('done:', join(shotsDir, '{wallet,zap-dialog}.png'));
} finally {
  await browser.close();
}
