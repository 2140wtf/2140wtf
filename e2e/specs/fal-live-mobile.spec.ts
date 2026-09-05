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
  const expanded = await readGeometry(page);
  expect(expanded.chatHeight).toBeGreaterThan(44);
  expect(expanded.iframeBottom).toBeLessThanOrEqual(expanded.navTop + 1);
  expect(expanded.iframeTop).toBeLessThan(expanded.iframeBottom);
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
