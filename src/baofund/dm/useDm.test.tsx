// useDm wiring test: real dmStore, mocked auth + transport. Verifies the
// access states, identity binding (start/stop on switch), send routing and
// the unread/mark-read flow end to end through the hook.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendDmRecord, loadDmRecords, type DmRecord } from './dmStore';

const PEER_A = '11'.repeat(32);
const PEER_B = '22'.repeat(32);
const SECRET_HEX = 'a5'.repeat(32);

const h = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  transports: [] as Array<{
    options: { onIncoming?: (r: unknown) => void; onState?: (s: string) => void };
    started: { pubkey: string; secret: Uint8Array } | null;
    stopped: boolean;
    sent: Array<{ peer: string; text: string }>;
  }>,
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => h.auth,
}));

vi.mock('./dmTransport', async () => {
  const store = await import('./dmStore');
  return {
    DmTransport: class {
      options: { onIncoming?: (r: unknown) => void; onState?: (s: string) => void };
      started: { pubkey: string; secret: Uint8Array } | null = null;
      stopped = false;
      sent: Array<{ peer: string; text: string }> = [];
      private pubkey: string | null = null;
      constructor(options: { onIncoming?: (r: unknown) => void; onState?: (s: string) => void }) {
        this.options = options;
        h.transports.push(this as unknown as (typeof h.transports)[number]);
      }
      start(pubkey: string, secret: Uint8Array): void {
        this.pubkey = pubkey;
        this.started = { pubkey, secret };
        this.options.onState?.('live');
      }
      stop(): void {
        this.stopped = true;
      }
      async send(peer: string, text: string): Promise<DmRecord> {
        this.sent.push({ peer, text });
        const record: DmRecord = { id: 'ab'.repeat(32), peer, direction: 'out', text, createdAt: 1_700_000_100 };
        store.appendDmRecord(this.pubkey, record);
        this.options.onIncoming?.(record);
        return record;
      }
    },
  };
});

import { useDm } from './useDm';

function Probe(): React.ReactElement {
  const dm = useDm();
  return (
    <div>
      <span data-testid="access">{dm.access}</span>
      <span data-testid="detail">{dm.accessDetail ?? ''}</span>
      <span data-testid="threads">{dm.threads.map((t) => `${t.peer}:${t.messages.length}`).join(',')}</span>
      <span data-testid="unread">{dm.unread}</span>
      <span data-testid="active">{dm.activePeer ?? ''}</span>
      <button type="button" data-testid="sel-a" onClick={() => dm.selectThread(PEER_A)}>sel</button>
      <button type="button" data-testid="send-a" onClick={() => void dm.send(PEER_A, 'hi').catch(() => undefined)}>send</button>
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  h.transports.length = 0;
  h.auth = { status: 'signed-out', method: null, pubkey: null, seedIdentityHex: () => null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* the test already unmounted this root */
  }
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => root.render(<Probe />));
}

const text = (id: string): string => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

describe('useDm', () => {
  it('signed out: no transport, access signed-out', async () => {
    await render();
    expect(text('access')).toBe('signed-out');
    expect(h.transports).toHaveLength(0);
  });

  it('extension/remote/passkey sessions are no-local-key with method-specific copy', async () => {
    h.auth = { status: 'ready', method: 'nip07', pubkey: PEER_B, seedIdentityHex: () => null };
    await render();
    expect(text('access')).toBe('no-local-key');
    expect(text('detail')).toContain('extension');
    expect(h.transports).toHaveLength(0);
  });

  it('seed sessions start a transport, send through it, and reflect store writes', async () => {
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_A, seedIdentityHex: () => SECRET_HEX };
    await render();
    expect(text('access')).toBe('ready');
    expect(h.transports).toHaveLength(1);
    expect(h.transports[0].started?.pubkey).toBe(PEER_A);
    expect(h.transports[0].started?.secret.length).toBe(32);

    // Incoming while no thread is open: unread counts up and the thread lists.
    await act(async () => {
      const record: DmRecord = { id: 'cd'.repeat(32), peer: PEER_B, direction: 'in', text: 'hey', createdAt: 1_700_000_200 };
      appendDmRecord(PEER_A, record);
      h.transports[0].options.onIncoming?.(record);
    });
    expect(text('threads')).toBe(`${PEER_B}:1`);
    expect(text('unread')).toBe('1');

    // Selecting the thread marks it read.
    await act(async () => {
      (container.querySelector('[data-testid="sel-a"]') as HTMLButtonElement).click();
    });
    expect(text('active')).toBe(PEER_A);
    await act(async () => {
      const record: DmRecord = { id: 'ee'.repeat(32), peer: PEER_A, direction: 'in', text: 'ping', createdAt: 1_700_000_300 };
      appendDmRecord(PEER_A, record);
      h.transports[0].options.onIncoming?.(record);
    });
    // Active-thread arrival is auto-marked read; the earlier PEER_B unread stays.
    expect(text('unread')).toBe('1');
    expect(loadDmRecords(PEER_A).find((r) => r.id === (('ee'.repeat(32))))?.readAt).toBeTruthy();

    // Send routes through the transport and the outgoing message is stored.
    await act(async () => {
      (container.querySelector('[data-testid="send-a"]') as HTMLButtonElement).click();
    });
    expect(h.transports[0].sent).toEqual([{ peer: PEER_A, text: 'hi' }]);
    expect(loadDmRecords(PEER_A).some((r) => r.direction === 'out' && r.text === 'hi')).toBe(true);
  });

  it('identity switch tears the old transport down before the new one starts', async () => {
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_A, seedIdentityHex: () => SECRET_HEX };
    await render();
    const first = h.transports[0];
    h.auth = { status: 'ready', method: 'seed', pubkey: PEER_B, seedIdentityHex: () => SECRET_HEX };
    await render();
    expect(first.stopped).toBe(true);
    expect(h.transports).toHaveLength(2);
    expect(h.transports[1].started?.pubkey).toBe(PEER_B);
    // The previous identity's selection/records can never surface.
    expect(text('threads')).toBe('');
    expect(text('active')).toBe('');

    // Unmount stops the active transport too.
    await act(async () => root.unmount());
    expect(h.transports[1].stopped).toBe(true);
  });
});
