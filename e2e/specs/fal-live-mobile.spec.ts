import { expect, test } from '@playwright/test';
import { injectTestLogin } from '../fixtures/login';
import { installReadOnlyNetworkGuard } from '../fixtures/network';

async function openFalLive(page: import('@playwright/test').Page, width: number, height: number) {
  await installReadOnlyNetworkGuard(page);
  await injectTestLogin(page);
  await page.setViewportSize({ width, height });
  await page.goto('/fal-live', { waitUntil: 'domcontentloaded' });
}

async function readGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="fal.live AI generation studio"]');
    const nav = document.querySelector<HTMLElement>('nav.fixed.bottom-0');
    const main = document.querySelector<HTMLElement>('main.fal-live-height');
    const chat = document.querySelector<HTMLElement>('main.fal-live-height > aside');
    if (!iframe || !nav || !main || !chat) throw new Error('Fal Live mobile layout elements not found');

    const iframeBox = iframe.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    const chatBox = chat.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      iframeTop: iframeBox.top,
      iframeBottom: iframeBox.bottom,
      navTop: navBox.top,
      mainTop: mainBox.top,
      mainBottom: mainBox.bottom,
      chatHeight: chatBox.height,
      iframeWidth: iframeBox.width,
      chatOverlay: getComputedStyle(chat).position === 'absolute',
    };
  });
}

test('fal.live mobile studio keeps its bottom controls above app chrome', async ({ page }) => {
  await openFalLive(page, 375, 667);

  const studio = page.getByTitle('fal.live AI generation studio');
  await expect(studio).toBeVisible();
  await expect(page.getByText('TROLLBOX', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Trollbox' })).toBeVisible();

  const geometry = await readGeometry(page);

  // The cross-origin studio cannot be inspected internally, so the iframe
  // boundary is the safety invariant: anything anchored to fal.live's bottom
  // edge, including expanded Choices, must finish above our fixed nav.
  expect(geometry.iframeBottom).toBeLessThanOrEqual(geometry.navTop + 1);
  expect(geometry.mainBottom).toBeLessThanOrEqual(geometry.navTop + 1);
  expect(geometry.chatHeight).toBeLessThanOrEqual(44 + 1);
  expect(geometry.iframeTop).toBeLessThan(geometry.iframeBottom);

  await page.getByRole('button', { name: 'Expand Trollbox' }).click();
  // The aside animates height over 200ms; poll until the transition settles
  // instead of racing the animation.
  await expect
    .poll(async () => (await readGeometry(page)).chatHeight, { timeout: 5_000 })
    .toBeGreaterThan(44);
  const expanded = await readGeometry(page);
  expect(expanded.chatHeight).toBeGreaterThan(44);
  expect(expanded.iframeBottom).toBeLessThanOrEqual(expanded.navTop + 1);
  expect(expanded.iframeTop).toBeLessThan(expanded.iframeBottom);
});

test('expanding the trollbox never resizes the studio iframe (video-keepalive invariant)', async ({ page }) => {
  // Cross-origin video playback pauses in several mobile engines when the
  // iframe's rendered box changes. The expanded chat is therefore a floating
  // overlay: the iframe box must be pixel-identical collapsed and expanded.
  await openFalLive(page, 375, 667);

  const collapsed = await readGeometry(page);
  expect(collapsed.chatOverlay).toBe(true);

  await page.getByRole('button', { name: 'Expand Trollbox' }).click();
  await expect
    .poll(async () => (await readGeometry(page)).chatHeight, { timeout: 5_000 })
    .toBeGreaterThan(44);
  const expanded = await readGeometry(page);
  expect(expanded.chatOverlay).toBe(true);

  // THE invariant: identical iframe box across the toggle.
  expect(expanded.iframeTop).toBeCloseTo(collapsed.iframeTop, 0);
  expect(expanded.iframeBottom).toBeCloseTo(collapsed.iframeBottom, 0);
  expect(expanded.iframeWidth).toBeCloseTo(collapsed.iframeWidth, 0);

  // The collapsed bar overlays the permanently-reserved video strip, so the
  // collapsed chat does not push the iframe: bottom edge stays above nav.
  expect(expanded.iframeBottom).toBeLessThanOrEqual(expanded.navTop + 1);
});

test('fal.live remains usable on a short phone viewport', async ({ page }) => {
  await openFalLive(page, 320, 568);

  await expect(page.getByTitle('fal.live AI generation studio')).toBeVisible();
  await expect(page.getByText('TROLLBOX', { exact: true })).toBeVisible();

  const geometry = await readGeometry(page);
  expect(geometry.iframeBottom).toBeLessThanOrEqual(geometry.navTop + 1);
  expect(geometry.iframeTop).toBeLessThan(geometry.iframeBottom);
  expect(geometry.chatHeight).toBeLessThanOrEqual(44 + 1);
});
