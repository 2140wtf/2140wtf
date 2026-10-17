// DmCallSettingsSection: the Settings surface for call policy + blocks.
// Controller mocked; persistence lives in dmCallStore's own suite.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { nip19 } from 'nostr-tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmCallsController } from './useDmCalls';
import { DEFAULT_DM_CALL_POLICY } from './dmCallStore';

const PEER = '11'.repeat(32);

function controller(overrides: Partial<DmCallsController> = {}): DmCallsController {
  return {
    access: 'ready',
    phase: 'idle',
    peer: null,
    callId: null,
    since: null,
    answeredAt: null,
    role: null,
    error: null,
    media: 'off',
    muted: true,
    participantCount: 0,
    toggleMute: vi.fn(async () => false),
    policy: { ...DEFAULT_DM_CALL_POLICY },
    blocks: [],
    log: [],
    setPolicy: vi.fn(),
    block: vi.fn(),
    unblock: vi.fn(),
    startCall: vi.fn(async () => true),
    accept: vi.fn(async () => true),
    decline: vi.fn(),
    blockAndDecline: vi.fn(),
    cancel: vi.fn(),
    hangup: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

import { DmCallSettingsSection } from './DmCallSettingsSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(calls: DmCallsController): Promise<void> {
  await act(async () => root.render(<DmCallSettingsSection calls={calls} />));
}

async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const testid = (id: string): Element | null => container.querySelector(`[data-testid="${id}"]`);

describe('DmCallSettingsSection', () => {
  it('offers the ADR defaults: calls off, nobody may ring, no missed notice', async () => {
    await render(controller());
    expect((testid('dmcall-enabled') as HTMLInputElement).checked).toBe(false);
    expect((testid('dmcall-missed-notice') as HTMLInputElement).checked).toBe(false);
    expect((testid('dmcall-who-may-ring') as HTMLSelectElement).value).toBe('nobody');
    expect(container.textContent).toContain('Both sides must opt in');
    expect(testid('dmcall-block-empty')).toBeTruthy();
  });

  it('wires the toggles and the whoMayRing select to setPolicy', async () => {
    const calls = controller();
    await render(calls);
    await act(async () => (testid('dmcall-enabled') as HTMLInputElement).click());
    expect(calls.setPolicy).toHaveBeenCalledWith({ callsEnabled: true });
    await act(async () => (testid('dmcall-missed-notice') as HTMLInputElement).click());
    expect(calls.setPolicy).toHaveBeenCalledWith({ missedNotice: true });

    const select = testid('dmcall-who-may-ring') as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(select, 'anyone');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(calls.setPolicy).toHaveBeenCalledWith({ whoMayRing: 'anyone' });
    // The follows options are present but honestly labelled as unavailable.
    expect(container.textContent).toContain('not available yet');
  });

  it('blocks by 64-hex or npub, refuses junk, and unblocks', async () => {
    const calls = controller({ blocks: [PEER] });
    await render(calls);
    await typeInto(testid('dmcall-block-input') as HTMLInputElement, 'not a pubkey');
    await act(async () => (testid('dmcall-block-add') as HTMLButtonElement).click());
    expect(calls.block).not.toHaveBeenCalled();
    expect(testid('dmcall-block-error')?.textContent).toContain('64-hex');

    const other = '22'.repeat(32);
    await typeInto(testid('dmcall-block-input') as HTMLInputElement, nip19.npubEncode(other));
    await act(async () => (testid('dmcall-block-add') as HTMLButtonElement).click());
    expect(calls.block).toHaveBeenCalledWith(other);
    expect(testid('dmcall-block-error')).toBeNull();

    await act(async () => (testid(`dmcall-unblock-${PEER}`) as HTMLButtonElement).click());
    expect(calls.unblock).toHaveBeenCalledWith(PEER);
    expect(testid('dmcall-block-list')?.textContent).toContain(PEER.slice(0, 12));
  });

  it('signed-out / no-local-key sessions get honest unavailability copy, no controls', async () => {
    await render(controller({ access: 'signed-out' }));
    expect(testid('dmcall-settings-unavailable')?.textContent).toContain('Sign in');
    expect(testid('dmcall-enabled')).toBeNull();

    await render(controller({ access: 'no-local-key' }));
    expect(testid('dmcall-settings-unavailable')?.textContent).toContain('sign-in method');
    expect(testid('dmcall-block-input')).toBeNull();
  });
});
