import { expect, test } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import { injectTestLogin } from '../fixtures/login';
import { installReadOnlyNetworkGuard, NetworkMonitor } from '../fixtures/network';

const DEFAULT_TIMEOUT = 20_000;

function attachMonitor(page: import('@playwright/test').Page): NetworkMonitor {
  const monitor = new NetworkMonitor({
    tolerateRelayErrors: true,
    // Prediction-market detail/history endpoints 404 once a market has
    // expired upstream; the app renders the empty state gracefully, so
    // don't fail the build on third-party data rot.
    tolerateNotFound: [/\/bao-api\/v1\/smj\//],
    // The BAO markets API (relay.bao.network/bao-api) is frequently down or
    // unreachable from CI and returns CORS/502 failures for every endpoint
    // while it is. The markets page degrades gracefully (PR #65), so an
    // upstream outage is infra flake, not an app regression — tolerate it.
    tolerateExternal: [/relay\.bao\.network\/bao-api\//],
  });
  monitor.attach(page);
  return monitor;
}

test.beforeEach(async ({ page }) => installReadOnlyNetworkGuard(page));

test.describe('smoke', () => {
  test('home feed loads without critical errors', async ({ page }) => {
    const monitor = attachMonitor(page);
    await injectTestLogin(page);
    await page.goto('/', { waitUntil: 'load' });

    // Wait for the logged-in feed chrome.
    await expect(page.getByRole('button', { name: 'Follows', exact: true })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

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
    // from the desktop sidebar and mobile bottom nav). The legacy ₿AOs
    // collapsible group was split by the 2140 Social migration: 2140 Social is
    // now a standalone destination and the three ₿AO links render flat, so each
    // is a link rather than a group trigger. The chat was rebranded to
    // "2140 Community Chat" (separate app from BAO Markets).
    await expect(drawer.getByRole('link', { name: 'Feed' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: '2140 Community Chat' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: '₿AO MARKETS' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Fund my ₿AO' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Merchants' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Polls' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();

    monitor.assertNoFailures();
  });

  test('prediction market chart shows both outcome pills', async ({ page }) => {
    const monitor = attachMonitor(page);
    await injectTestLogin(page);
    await page.goto('/prediction-markets', { waitUntil: 'load' });

    // The public demo catalog is short-lived by design: poll markets expire
    // within minutes, so the default active view can legitimately be empty.
    // Only assert the chart when a market exists; always require the page to
    // render a graceful state (market cards or the empty state).
    // Outcome labels come from live market data and their casing varies
    // between catalogs (Yes/YES/...), so match the buy button loosely.
    const marketCard = page.locator('[data-market-id]').filter({
      has: page.getByRole('button', { name: /^buy yes$/i }),
    }).first();
    const emptyState = page.getByText(/No markets found|markets API is unreachable/);
    await expect(marketCard.or(emptyState).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    if (!(await marketCard.isVisible())) {
      await expect(emptyState).toBeVisible();
      monitor.assertNoFailures();
      return;
    }

    await marketCard.getByRole('button', { name: 'Details' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // The outcome pills render in the dialog's trade module; labels come from
    // live market data and their casing varies (Yes/YES/...), so match loosely.
    await expect(dialog.getByRole('button', { name: /^yes$/i })).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(dialog.getByRole('button', { name: /^no$/i })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    monitor.assertNoFailures();
  });
});
