// useDmCalls wiring: real session/guard/stores, mocked auth + transport.
// Verifies access gating (guests / no-local-key get NO lane), the seed lane
// lifecycle across identity switches, policy persistence from Settings, the
// offer publish path with epk/nonce extras, and the accept -> in-call
// transition fed through the transport's raw lane sink.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PEER_A = '11'.repeat(32);
const PEER_B = '22'.repeat(32);
const SECRET_HEX = 'a5'.repeat(32);

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  transports: [] as Array<{
    options: {
      onLanePayload?: (payload: unknown, envelope: { wrapId: string; from: string }) => void;
      onIncoming?: (r: unknown) => void;
    };
    started: { pubkey: string; secret: Uint8Array } | null;
    stopped: boolean;
    sentPayloads: Array<{ peer: string; payload: Record<string, unknown>; wrapId: string }>;
  }>,
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => h.auth,
}));

vi.mock('./dmCallMedia', async (importOriginal) => {
  const original = await importOriginal<typeof import('./dmCallMedia')>();
  return {
    ...original,
    joinDmCallMedia: async () => ({
      participantCount: () => 2,
      setMuted: async () => undefined,
      isMuted: () => true,
      leave: async () => undefined,
      onParticipants: () => () => undefined,
      onEncryptionError: () => () => undefined,
    }),
  };
});

vi.mock('./dmTransport', () => {
  let wrapCounter = 0;
  return {
    DmTransport: class {
      options: (typeof h.transports)[number]['options'];
      started: { pubkey: string; secret: Uint8Array } | null = null;
      stopped = false;
      sentPayloads: Array<{ peer: string; payload: Record<string, unknown>; wrapId: string }> = [];
      constructor(options: (typeof h.transports)[number]['options']) {
        this.options = options;
        h.transports.push(this as unknown as (typeof h.transports)[number]);
      }
      start(pubkey: string, secret: Uint8Array): void {
        this.started = { pubkey, secret };
      }
      stop(): void {
        this.stopped = true;
      }
      async sendPayload(peer: string, payload: unknown): Promise<string> {
        wrapCounter += 1;
        const wrapId = wrapCounter.toString(16).padStart(64, '0');
        this.sentPayloads.push({ peer, payload: payload as Record<string, unknown>, wrapId });
        return wrapId;
      }
      async send(): Promise<string> {
        wrapCounter += 1;
        return wrapCounter.toString(16).padStart(64, '0');
      }
    },
  };
});

import { DmCallProvider, useDmCallsOptional } from './useDmCalls';
import { buildDmCallAcceptPayload } from './dmCallLane';
import { newDmCallEphemeral } from '@/baofund/community/dmCallKeys.js';
import { loadDmCallPolicy, saveDmCallPolicy } from './dmCallStore';
import { readDmCallExtras } from './dmCallLane';

function Probe(): React.ReactElement {
  const calls = useDmCallsOptional();
  return (
    <div>
      <span data-testid="access">{calls?.access ?? 'none'}</span>
      <span data-testid="phase">{calls?.phase ?? 'none'}</span>
      <span data-testid="peer">{calls?.peer ?? ''}</span>
      <span data-testid="calls-enabled">{String(calls?.policy.callsEnabled ?? false)}</span>
      <span data-testid="error">{calls?.error ?? ''}</span>
      <span data-testid="media">{calls?.media ?? ''}</span>
      <span data-testid="participants">{String(calls?.participantCount ?? 0)}</span>
      <button type="button" data-testid="enable" onClick={() => calls?.setPolicy({ callsEnabled: true })}>
        enable
      </button>
      <button type="button" data-testid="call-a" onClick={() => void calls?.startCall(PEER_B)}>
        call
      </button>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  h.transports.length = 0;
  h.auth = { status: 'signed-out', method: null, pubkey: null, seedIdentityHex: () => null, backupPending: false };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* already unmounted */
  }
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => root.render(<DmCallProvider><Probe /></DmCallProvider>));
}

const text = (id: string): string => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

describe('useDmCalls / DmCallProvider', () => {
  it('guests and no-local-key sessions get NO lane (cannot call or be called)', async () => {
    await render();
    expect(text('access')).toBe('signed-out');
    expect(h.transports).toHaveLength(0);

    h.auth = { status: 'ready', method: 'nip07', pubkey: PEER_B, seedIdentityHex: () => null };
    await render();
    expect(text('access')).toBe('no-local-key');
    expect(h.transports).toHaveLength(0);
    // startCall is a no-op without a lane.
    await act(async () => (container.querySelector('[data-testid="call-a"]') as HTMLButtonElement).click());
    expect(text('phase')).toBe('idle');
  });

  it('seed sessions get an always-on lane and the offer carries epk + nonce', async () => {
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_A, seedIdentityHex: () => SECRET_HEX };
    await render();
    expect(text('access')).toBe('ready');
    expect(h.transports).toHaveLength(1);
    expect(h.transports[0].started?.pubkey).toBe(PEER_A);
    expect(h.transports[0].started?.secret.length).toBe(32);

    // Calls are opt-in: the first attempt is refused until enabled.
    await act(async () => (container.querySelector('[data-testid="call-a"]') as HTMLButtonElement).click());
    expect(text('phase')).toBe('idle');
    expect(text('error')).toContain('Settings');
    expect(h.transports[0].sentPayloads).toHaveLength(0);

    await act(async () => (container.querySelector('[data-testid="enable"]') as HTMLButtonElement).click());
    expect(text('calls-enabled')).toBe('true');
    expect(loadDmCallPolicy(PEER_A).callsEnabled).toBe(true);

    await act(async () => (container.querySelector('[data-testid="call-a"]') as HTMLButtonElement).click());
    expect(text('phase')).toBe('outgoing');
    const offer = h.transports[0].sentPayloads.find((s) => s.payload.op === 'offer');
    expect(offer).toBeTruthy();
    expect(offer!.peer).toBe(PEER_B);
    const extras = readDmCallExtras(offer!.payload);
    expect(extras.epk).toMatch(/^[0-9a-f]{64}$/);
    expect(extras.nonce).toMatch(/^[0-9a-f]{32}$/);

    // The callee accepts over the lane sink -> in-call.
    const callId = offer!.payload.callId as string;
    const accept = buildDmCallAcceptPayload(callId, extras.nonce as string, newDmCallEphemeral(), { rn: callId });
    await act(async () => {
      h.transports[0].options.onLanePayload?.(accept, { wrapId: 'ab'.repeat(32), from: PEER_B });
    });
    expect(text('phase')).toBe('in-call');
    expect(text('peer')).toBe(PEER_B);
    // Phase 4: the media join resolved through the mocked broker path.
    expect(text('media')).toBe('live');
    expect(text('participants')).toBe('2');
  });

  it('identity switch tears the old lane down before the new one starts', async () => {
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_A, seedIdentityHex: () => SECRET_HEX };
    await render();
    const first = h.transports[0];
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_B, seedIdentityHex: () => SECRET_HEX };
    await render();
    expect(first.stopped).toBe(true);
    expect(h.transports).toHaveLength(2);
    expect(h.transports[1].started?.pubkey).toBe(PEER_B);

    // Policy is per identity: PEER_A's enabled flag never leaks to PEER_B.
    saveDmCallPolicy(PEER_A, { callsEnabled: true });
    await render();
    expect(text('calls-enabled')).toBe('false');

    await act(async () => root.unmount());
    expect(h.transports[1].stopped).toBe(true);
  });
});
