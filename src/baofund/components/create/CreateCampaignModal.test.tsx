import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CreateCampaignModal } from './CreateCampaignModal';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  publish: vi.fn(),
  signer: { getPublicKey: async () => 'test-pubkey' },
}));

vi.mock('../../lib/baoFundraising', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/baoFundraising')>()),
  createFundraiser: mocks.create,
}));
vi.mock('../../relay/publishCampaignCard', () => ({ publishCampaignCard: mocks.publish }));
vi.mock('../../relay/guestIdentity', () => ({
  createGuestSigner: vi.fn(() => mocks.signer),
  getGuestPubkeyHex: () => 'guest-pubkey',
}));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ status: 'ready', signer: mocks.signer, pubkey: 'test-pubkey' }),
}));

let container: HTMLDivElement;
let root: Root;
let onDone = vi.fn<(msg: string) => void>();
let onClose = vi.fn<() => void>();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.publish.mockResolvedValue({ ok: true });
  mocks.create.mockResolvedValue({
    fundraiser: { id: 'fr_new', title: 'New campaign' },
    milestones: [{ id: 'm1' }],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onDone = vi.fn();
  onClose = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function render() {
  await act(async () => root.render(<CreateCampaignModal onDone={onDone} onClose={onClose} />));
}

async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

it('refuses to silently drop a milestone row that has content but no amount', async () => {
  await render();
  await act(async () => {
    setValue(container.querySelectorAll<HTMLInputElement>('input')[0], 'My two-tranche campaign');
    setValue(container.querySelector<HTMLInputElement>('input[placeholder^="Milestone goal"]')!, 'Ship the first tranche');
    setValue(container.querySelector<HTMLTextAreaElement>('textarea')!, 'This is a long enough campaign description to pass the server-side rule.');
  });
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(container.textContent).toMatch(/amount/i);
});

it('locks the discussion room on and explains every gate', async () => {
  await render();
  const room = container.querySelector<HTMLInputElement>('[data-testid=discussion-room-enabled]')!;
  expect(room.checked).toBe(true);
  expect(room.disabled).toBe(true);
  const gate = container.querySelector<HTMLSelectElement>('[data-testid=discussion-room-gate]')!;
  expect(Array.from(gate.options).map((o) => o.value)).toEqual(['open', 'invite', 'follows', 'donors']);
  const help = () => container.querySelector('[data-testid=discussion-room-help]')!.textContent ?? '';
  expect(help()).toMatch(/anyone/i);
  await act(async () => {
    gate.value = 'donors';
    gate.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(help()).toMatch(/shown only to contributors/i);
  await act(async () => {
    gate.value = 'invite';
    gate.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(help()).toMatch(/revoke/i);
  await act(async () => {
    gate.value = 'follows';
    gate.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(help()).toMatch(/not live yet/i);
});

it('shows both testnet rails as visible radios and sends the chosen one', async () => {
  await render();
  const l1 = container.querySelector<HTMLInputElement>('[data-testid=rail-l1]')!;
  const liquid = container.querySelector<HTMLInputElement>('[data-testid=rail-liquid]')!;
  expect(l1.checked).toBe(true);
  expect(liquid.checked).toBe(false);
  await act(async () => { liquid.click(); });
  expect(liquid.checked).toBe(true);
  expect(l1.checked).toBe(false);
  await act(async () => {
    setValue(container.querySelectorAll<HTMLInputElement>('input')[0], 'Liquid rail campaign');
    setValue(container.querySelector<HTMLTextAreaElement>('textarea')!, 'This is a long enough campaign description to pass the server-side rule.');
  });
  await submit();
  const body = mocks.create.mock.calls[0][1] as {
    settlement_rail: string;
    discussion_room: { enabled: boolean; gate: string };
  };
  expect(body.settlement_rail).toBe('liquid');
  expect(body.discussion_room).toEqual({ enabled: true, gate: 'open' });
});

it('still creates from the description when every milestone row is completely empty', async () => {
  await render();
  await act(async () => {
    setValue(container.querySelectorAll<HTMLInputElement>('input')[0], 'A single-milestone campaign');
    setValue(container.querySelector<HTMLTextAreaElement>('textarea')!, 'This is a long enough campaign description to pass the server-side rule.');
  });
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  const body = mocks.create.mock.calls[0][1] as { runner_type: string; milestones: Array<{ amount_sats: number; description: string }> };
  expect(body.runner_type).toBe('human');
  expect(body.milestones).toHaveLength(1);
  expect(body.milestones[0].amount_sats).toBe(21400);
  expect(onDone).toHaveBeenCalled();
});
