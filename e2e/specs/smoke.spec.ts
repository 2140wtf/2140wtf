import { expect, test } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { injectTestLogin } from '../fixtures/login';
import { NetworkMonitor } from '../fixtures/network';

const DEFAULT_TIMEOUT = 20_000;

function attachMonitor(page: import('@playwright/test').Page): NetworkMonitor {
  const monitor = new NetworkMonitor({ tolerateRelayErrors: true });
  monitor.attach(page);
  return monitor;
}

test.describe('smoke', () => {
  test('home feed loads without critical errors', async ({ page }) => {
    const monitor = attachMonitor(page);
    await injectTestLogin(page);
    await page.goto('/', { waitUntil: 'load' });

    // Wait for the logged-in feed chrome.
    await expect(page.getByRole('button', { name: 'Follows' })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // The feed may contain notes or an empty state depending on relay data.
    const noteLike = page.locator('article, [class*="note"], [data-feed-item]').first();
    const emptyState = page.getByText(/Your feed is empty|No posts found/);
    await expect(noteLike.or(emptyState)).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    monitor.assertNoFailures();
  });

  test('profile routing renders the users own profile', async ({ page }) => {
    const monitor = attachMonitor(page);
    const login = await injectTestLogin(page);
    const npub = nip19.npubEncode(login.pubkey);

    await page.goto(`/${npub}`, { waitUntil: 'load' });
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    monitor.assertNoFailures();
  });

  test('mobile drawer opens and shows navigation items', async ({ page }) => {
    const monitor = attachMonitor(page);
    await injectTestLogin(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/', { waitUntil: 'load' });

    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
    await expect(drawer).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Spot-check default sidebar items (scoped to the drawer to avoid duplicates
    // from the desktop sidebar and mobile bottom nav). The Markets item is a
    // collapsible group, so it is rendered as a button with an all-caps label.
    await expect(drawer.getByRole('link', { name: 'Feed' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'MARKETS' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Polls' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();

    monitor.assertNoFailures();
  });

  test('prediction market chart shows both outcome pills', async ({ page }) => {
    const monitor = attachMonitor(page);
    await injectTestLogin(page);
    await page.goto('/prediction-markets', { waitUntil: 'load' });

    await page.getByText('Will Bitcoin reach $150K').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // The outcome pills render inside the chart card; wait for them to appear
    // after the lightweight-charts canvas has computed the sparklines.
    const chartCard = dialog.locator('.rounded-xl, [class*="rounded-xl"]').filter({ hasText: /Yes|No/ }).first();
    await expect(chartCard.getByText(/Yes/)).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(chartCard.getByText(/No/)).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    monitor.assertNoFailures();
  });
});
