import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CampaignChatGate } from './CampaignChatGate';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function renderGate(props: Partial<React.ComponentProps<typeof CampaignChatGate>> = {}) {
  const onClose = vi.fn();
  const onOpenRoom = vi.fn();
  await act(async () => root.render(
    <CampaignChatGate campaignTitle="Agent Memory Vault" onClose={onClose} onOpenRoom={onOpenRoom} {...props} />,
  ));
  return { onClose, onOpenRoom };
}

it('explains the contribution requirement and names the campaign', async () => {
  await renderGate();
  const text = container.textContent ?? '';
  expect(text).toContain('Agent Memory Vault');
  expect(text).toContain('reserved for donors');
});

it('offers exactly the two public doors', async () => {
  await renderGate();
  const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent?.trim());
  expect(buttons).toContain('Troll₿ox');
  expect(buttons).toContain('Public Chat');
});

it('opens the landing room by name when its button is clicked', async () => {
  const { onOpenRoom } = await renderGate();
  const btn = container.querySelector('[data-testid=gate-open-room-Troll₿ox]') as HTMLButtonElement;
  await act(async () => btn.click());
  expect(onOpenRoom).toHaveBeenCalledWith('Troll₿ox');
});

it('opens Public Chat by name when its button is clicked', async () => {
  const { onOpenRoom } = await renderGate();
  const btn = container.querySelector('[data-testid="gate-open-room-Public Chat"]') as HTMLButtonElement;
  await act(async () => btn.click());
  expect(onOpenRoom).toHaveBeenCalledWith('Public Chat');
});

it('closes on Close and on backdrop click', async () => {
  const { onClose } = await renderGate();
  const close = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Close') as HTMLButtonElement;
  await act(async () => close.click());
  expect(onClose).toHaveBeenCalledTimes(1);

  const backdrop = container.querySelector('[role=dialog]')?.parentElement as HTMLDivElement;
  await act(async () => backdrop.click());
  expect(onClose).toHaveBeenCalledTimes(2);
});
