// Render tests for the DM panel + launcher, against a mocked DM controller
// (the store/transport have their own suites; this exercises the surface).

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { nip19 } from 'nostr-tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmThread } from './dmStore';
import type { DmController } from './useDm';

const h = vi.hoisted(() => ({
  controller: null as unknown,
}));

vi.mock('./useDm', () => ({
  useDm: () => h.controller,
}));

import { DmPanel, parsePeerInput } from './DmPanel';
import { DmEntry } from './DmEntry';

const PEER_A = '11'.repeat(32);
const PEER_B = '22'.repeat(32);

function thread(peer: string, texts: Array<{ text: string; direction: 'in' | 'out'; at: number; readAt?: number }>): DmThread {
  const messages = texts.map((t, i) => ({
    id: `${i}`.padStart(64, '0'),
    peer,
    direction: t.direction,
    text: t.text,
    createdAt: t.at,
    ...(t.readAt !== undefined ? { readAt: t.readAt } : {}),
  }));
  return {
    peer,
    messages,
    lastAt: messages[messages.length - 1]?.createdAt ?? 0,
    unread: messages.filter((m) => m.direction === 'in' && m.readAt === undefined).length,
  };
}

function controller(overrides: Partial<DmController> = {}): DmController {
  return {
    access: 'ready',
    accessDetail: null,
    threads: [],
    unread: 0,
    activePeer: null,
    selectThread: vi.fn(),
    sending: false,
    send: vi.fn(async () => undefined),
    error: null,
    connection: 'live',
    relayUrl: 'wss://relay.bao.fund',
    maxTextLength: 4000,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.controller = controller();
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

/** React 19 ignores a plain `input.value = …`; drive the native setter. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('parsePeerInput', () => {
  it('accepts 64-hex (any case) and npub1, rejects everything else', () => {
    expect(parsePeerInput(PEER_A)).toBe(PEER_A);
    expect(parsePeerInput(`  ${PEER_A.toUpperCase()}  `)).toBe(PEER_A);
    expect(parsePeerInput(nip19.npubEncode(PEER_B))).toBe(PEER_B);
    for (const bad of ['', 'npub1nope', 'hello', 'aa'.repeat(31), 'zz'.repeat(32)]) {
      expect(parsePeerInput(bad)).toBeNull();
    }
  });
});

describe('DmPanel — guest + constrained sessions', () => {
  it('signed out: shows the standard sign-in prompt and calls onSignIn', async () => {
    const onSignIn = vi.fn();
    h.controller = controller({ access: 'signed-out' });
    await render(<DmPanel onSignIn={onSignIn} />);
    expect(container.querySelector('[data-testid="dm-signin-prompt"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dm-composer"]')).toBeNull();
    await act(async () => {
      (container.querySelector('[data-testid="dm-signin"]') as HTMLButtonElement).click();
    });
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('signed out without onSignIn: scrolls the #bao-signin anchor', async () => {
    h.controller = controller({ access: 'signed-out' });
    const anchor = document.createElement('div');
    anchor.id = 'bao-signin';
    const scroll = vi.fn();
    anchor.scrollIntoView = scroll;
    document.body.appendChild(anchor);
    try {
      await render(<DmPanel />);
      await act(async () => {
        (container.querySelector('[data-testid="dm-signin"]') as HTMLButtonElement).click();
      });
      expect(scroll).toHaveBeenCalled();
    } finally {
      anchor.remove();
    }
  });

  it('signed in with an extension/remote/passkey identity: explains the constraint', async () => {
    h.controller = controller({ access: 'no-local-key', accessDetail: 'Signed in with a remote signer - its key stays on the signer.' });
    await render(<DmPanel />);
    const block = container.querySelector('[data-testid="dm-no-key"]');
    expect(block?.textContent).toContain('not available for this sign-in method');
    expect(block?.textContent).toContain('remote signer');
    expect(container.querySelector('[data-testid="dm-composer"]')).toBeNull();
  });
});

describe('DmPanel — ready session', () => {
  it('lists conversations with unread badges and opens a thread with send + mark-read', async () => {
    const selectThread = vi.fn();
    const send = vi.fn(async () => undefined);
    h.controller = controller({
      selectThread,
      send,
      threads: [thread(PEER_A, [{ text: 'yo', direction: 'in', at: 100 }]), thread(PEER_B, [{ text: 'sent', direction: 'out', at: 200 }])],
      activePeer: PEER_A,
    });
    await render(<DmPanel onClose={vi.fn()} />);

    expect(container.querySelector('[data-testid="dm-connection"]')?.textContent).toContain('relay connected');
    expect(container.querySelector(`[data-testid="dm-unread-${PEER_A}"]`)?.textContent).toBe('1');
    expect(container.querySelector(`[data-testid="dm-conversation-${PEER_B}"]`)?.textContent).toContain('You: sent');

    // Active thread renders its messages.
    const threadEl = container.querySelector('[data-testid="dm-thread"]');
    expect(threadEl?.textContent).toContain('yo');

    // Selecting another conversation routes through the controller.
    await act(async () => {
      (container.querySelector(`[data-testid="dm-conversation-${PEER_B}"]`) as HTMLButtonElement).click();
    });
    expect(selectThread).toHaveBeenCalledWith(PEER_B);

    // Composer submits the trimmed-ish draft through send() and clears it.
    const composer = container.querySelector('[data-testid="dm-composer"]') as HTMLInputElement;
    await typeInto(composer, 'hello there');
    await act(async () => {
      (container.querySelector('[data-testid="dm-send"]') as HTMLButtonElement).click();
    });
    expect(send).toHaveBeenCalledWith(PEER_A, 'hello there');
    expect((container.querySelector('[data-testid="dm-composer"]') as HTMLInputElement).value).toBe('');
  });

  it('shows a send failure without pretending the message went out', async () => {
    h.controller = controller({
      activePeer: PEER_A,
      threads: [],
      send: vi.fn(async () => {
        throw new Error('relay rejected the wrap');
      }),
    });
    await render(<DmPanel />);
    const composer = container.querySelector('[data-testid="dm-composer"]') as HTMLInputElement;
    await typeInto(composer, 'will fail');
    await act(async () => {
      (container.querySelector('[data-testid="dm-send"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="dm-error"]')?.textContent).toContain('relay rejected the wrap');
  });

  it('opens a new conversation from a 64-hex or npub pubkey and refuses junk', async () => {
    const selectThread = vi.fn();
    h.controller = controller({ selectThread, threads: [] });
    await render(<DmPanel />);
    const input = container.querySelector('[data-testid="dm-new-peer"]') as HTMLInputElement;

    await typeInto(input, 'garbage');
    await act(async () => {
      (container.querySelector('[data-testid="dm-new-peer-open"]') as HTMLButtonElement).click();
    });
    expect(selectThread).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="dm-new-peer-error"]')).toBeTruthy();

    await typeInto(input, nip19.npubEncode(PEER_B));
    await act(async () => {
      (container.querySelector('[data-testid="dm-new-peer-open"]') as HTMLButtonElement).click();
    });
    expect(selectThread).toHaveBeenCalledWith(PEER_B);
    expect(container.querySelector('[data-testid="dm-new-peer-error"]')).toBeNull();
  });
});

describe('DmEntry', () => {
  it('opens the overlay panel and closes it again', async () => {
    h.controller = controller({ threads: [] });
    await render(<DmEntry />);
    expect(container.querySelector('[data-testid="dm-overlay"]')).toBeNull();
    await act(async () => {
      (container.querySelector('[data-testid="dm-open"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="dm-overlay"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dm-panel"]')).toBeTruthy();
    await act(async () => {
      (container.querySelector('[data-testid="dm-close"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid="dm-overlay"]')).toBeNull();
  });
});
