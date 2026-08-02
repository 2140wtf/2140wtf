import { expect, test } from '@playwright/test';
import { injectTestLogin } from '../fixtures/login';
import { installReadOnlyNetworkGuard, measurePageLoad, NetworkMonitor } from '../fixtures/network';

const LOAD_THRESHOLD_MS = 5_000;
const ITERATIONS = 5;

test.describe('network behavior under real load', () => {
  test.beforeEach(async ({ page }) => installReadOnlyNetworkGuard(page));
  test('home page reloads stay within timing threshold and do not hard-fail', async ({ page }) => {
    const monitor = new NetworkMonitor({ tolerateRelayErrors: true });
    monitor.attach(page);
    await injectTestLogin(page);

    const timings: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const { loadTime } = await measurePageLoad(page, '/');
      timings.push(loadTime);
      // Wait for the feed chrome to settle before the next reload.
      await page.getByRole('button', { name: 'Follows', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    }

    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1];

    expect(p95).toBeLessThan(LOAD_THRESHOLD_MS);
    monitor.assertNoFailures();
  });
});
