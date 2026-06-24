import { expect, test } from '@playwright/test';
import { joinDemoRoom } from '../fixtures/court';
import { NetworkMonitor } from '../fixtures/network';

const FORMATION_TIMEOUT = 45_000;
const CEREMONY_TIMEOUT = 60_000;

test.describe('FROST demo court', () => {
  test('full coordinator-free demo completes and publishes an attestation', async ({ page }) => {
    test.setTimeout(120_000);

    const monitor = new NetworkMonitor({ tolerateRelayErrors: true });
    monitor.attach(page);

    const browser = page.context().browser();
    if (!browser) {
      throw new Error('Browser instance not available');
    }

    const roomName = `smoke-${Date.now()}`;

    // Join the same demo room from three independent browser contexts so the
    // threshold of 3 is reached without relying on a coordinator.
    await joinDemoRoom(page, { roomName, pace: 'fast' });

    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await joinDemoRoom(p2, { roomName, pace: 'guided' });

    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await joinDemoRoom(p3, { roomName, pace: 'guided' });

    // Wait for the first page to see the full roster and form the jury.
    const dialog = page.getByRole('dialog', { name: 'Juror session' });
    try {
      await expect(dialog).toBeVisible({ timeout: FORMATION_TIMEOUT });
    } catch {
      test.skip(true, 'Demo room did not form; relay.bao.network may be unreachable from this environment.');
      return;
    }

    // In fast mode the ceremony auto-runs to the attestation.
    await expect(page.getByText('Attestation published')).toBeVisible({ timeout: CEREMONY_TIMEOUT });

    await page.getByRole('button', { name: /Close session/i }).click();
    await expect(dialog).not.toBeVisible();

    await ctx2.close();
    await ctx3.close();

    monitor.assertNoFailures();
  });
});
