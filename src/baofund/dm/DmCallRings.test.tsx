// DmCallRings render tests: incoming ring (accept/decline/block), outgoing
// ring (cancel), in-call (hang-up + honest signaling copy), error surface,
// and idle = nothing. The controller is mocked; the session has its own
// suite.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
    policy: { ...DEFAULT_DM_CALL_POLICY, callsEnabled: true, whoMayRing: 'anyone' },
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

import { DmCallRings } from './DmCallRings';

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

async function render(ui: React.ReactElement): Promise<void> {
  await act(async () => root.render(ui));
}

function testid(id: string): Element | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

describe('DmCallRings', () => {
  it('renders nothing while idle', async () => {
    await render(<DmCallRings calls={controller()} />);
    expect(container.textContent).toBe('');
  });

  it('incoming: accept / decline / block wired to the controller', async () => {
    const calls = controller({ phase: 'incoming', peer: PEER, role: 'callee', since: Math.floor(Date.now() / 1000) - 7 });
    await render(<DmCallRings calls={calls} />);
    expect(testid('dmcall-incoming-label')?.textContent).toContain(PEER.slice(0, 10));
    await act(async () => (testid('dmcall-accept') as HTMLButtonElement).click());
    expect(calls.accept).toHaveBeenCalledTimes(1);
    await act(async () => (testid('dmcall-decline') as HTMLButtonElement).click());
    expect(calls.decline).toHaveBeenCalledTimes(1);
    await act(async () => (testid('dmcall-block') as HTMLButtonElement).click());
    expect(calls.blockAndDecline).toHaveBeenCalledTimes(1);
  });

  it('outgoing: shows the elapsed ring time and cancels', async () => {
    const calls = controller({ phase: 'outgoing', peer: PEER, role: 'caller', since: Math.floor(Date.now() / 1000) - 65 });
    await render(<DmCallRings calls={calls} />);
    expect(testid('dmcall-outgoing-label')?.textContent).toContain('1:05');
    await act(async () => (testid('dmcall-cancel') as HTMLButtonElement).click());
    expect(calls.cancel).toHaveBeenCalledTimes(1);
  });

  it('in-call with live media: E2EE status, participant count, mute toggle, hang-up', async () => {
    const calls = controller({
      phase: 'in-call',
      peer: PEER,
      role: 'callee',
      since: Math.floor(Date.now() / 1000) - 120,
      answeredAt: Math.floor(Date.now() / 1000) - 118,
      media: 'live',
      muted: true,
      participantCount: 2,
    });
    await render(<DmCallRings calls={calls} />);
    expect(testid('dmcall-active-label')?.textContent).toContain('In call with');
    expect(testid('dmcall-media-note')?.textContent).toContain('Encrypted voice · E2EE · 2 in call');
    const mute = testid('dmcall-mute') as HTMLButtonElement;
    expect(mute.textContent).toContain('Unmute');
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    await act(async () => mute.click());
    expect(calls.toggleMute).toHaveBeenCalledTimes(1);
    await act(async () => (testid('dmcall-hangup') as HTMLButtonElement).click());
    expect(calls.hangup).toHaveBeenCalledTimes(1);
  });

  it('connecting: secure-join copy + hang-up; no mute until live', async () => {
    const calls = controller({
      phase: 'connecting',
      peer: PEER,
      role: 'caller',
      since: Math.floor(Date.now() / 1000) - 2,
      answeredAt: Math.floor(Date.now() / 1000) - 2,
      media: 'connecting',
    });
    await render(<DmCallRings calls={calls} />);
    expect(testid('dmcall-connecting-label')?.textContent).toContain('Connecting to');
    expect(testid('dmcall-media-note')?.textContent).toContain('Securing the call');
    expect(testid('dmcall-mute')).toBeNull();
    await act(async () => (testid('dmcall-hangup') as HTMLButtonElement).click());
    expect(calls.hangup).toHaveBeenCalledTimes(1);
  });

  it('surfaces a controller error with a dismiss action', async () => {
    const calls = controller({ error: 'Could not answer - the relay is unreachable.' });
    await render(<DmCallRings calls={calls} />);
    expect(testid('dmcall-error')?.textContent).toContain('relay is unreachable');
    await act(async () => (testid('dmcall-error')?.querySelector('button') as HTMLButtonElement).click());
    expect(calls.clearError).toHaveBeenCalledTimes(1);
  });
});
