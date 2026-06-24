import type { Page } from '@playwright/test';
import { injectTestLogin, seedLocalStorage } from './login';

export interface DemoRoomOptions {
  roomName: string;
  pace?: 'guided' | 'fast';
}

export async function joinDemoRoom(page: Page, options: DemoRoomOptions): Promise<void> {
  const { roomName, pace = 'guided' } = options;

  await injectTestLogin(page);
  await seedLocalStorage(page, 'bao-court-settings', {
    categories: ['world'],
    bondAmountSats: 10000,
    demoMode: true,
    demoPace: pace,
  });

  await page.goto('/court', { waitUntil: 'load' });
  await page.getByRole('tab', { name: 'Lobby' }).click();

  const roomInput = page.locator('#demo-room-name');
  await roomInput.fill(roomName);

  await page.getByRole('button', { name: /Join demo jury/i }).click();

  // Wait until we are actually in the room (either waiting or already forming).
  await page.getByRole('button', { name: /Leave room/i }).waitFor({ state: 'visible', timeout: 15_000 });
}
