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

async function injectDarkCss(page) {
  await page.addStyleTag({ content: `
    :root {
      --background: 228 20% 10% !important;
      --foreground: 210 40% 98% !important;
      --card: 228 20% 12% !important;
      --card-foreground: 210 40% 98% !important;
      --popover: 228 20% 12% !important;
      --popover-foreground: 210 40% 98% !important;
      --primary: 258 70% 60% !important;
      --primary-foreground: 0 0% 100% !important;
      --secondary: 228 15% 16% !important;
      --secondary-foreground: 210 40% 98% !important;
      --muted: 228 15% 16% !important;
      --muted-foreground: 215 20% 65% !important;
      --accent: 228 15% 18% !important;
      --accent-foreground: 210 40% 98% !important;
      --border: 228 15% 22% !important;
      --input: 228 15% 22% !important;
      --ring: 258 70% 60% !important;
    }
    body { background: hsl(228 20% 10%) !important; }
  ` });
}

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
  await injectDarkCss(page);

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
  await forceDark(page);
  await injectDarkCss(page);

  // --- Wallet ----------------------------------------------------------------
  console.log('capturing wallet…');
  await page.goto(`${baseUrl}/wallet`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await forceDark(page);
  await injectDarkCss(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shotsDir, 'wallet.png') });

  // --- Zap dialog (invoice only — NEVER confirm payment) ----------------------
  await forceDark(page);
  await injectDarkCss(page);
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
