import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { CourtPanel } from './CourtPanel';

class Socket {
  static OPEN = 1;
  static sockets: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  sent: unknown[][] = [];
  constructor() {
    Socket.sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Socket.sockets = [];
  vi.stubGlobal('WebSocket', Socket);
  try { window.localStorage.clear(); } catch { /* jsdom storage */ }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Validly signed fixtures: the panel verifies signatures before folding.
const COURT_TEST_SK = generateSecretKey();
function disputeEvent(id: string, escrow: string) {
  return finalizeEvent(
    {
      kind: 38025,
      created_at: 1_700_000_000,
      content: '{}',
      tags: [
        ['d', id],
        ['market', escrow],
        ['original', 'refund'],
        ['proposed', 'released'],
        ['deadline', '1700086400'],
      ],
    },
    COURT_TEST_SK,
  );
}

async function render() {
  await act(async () => root.render(
    <CourtPanel
      myPubkey={null}
      nip60Signer={null}
      signEvent={null}
      relayUrl="wss://relay.test"
      campaigns={[{ id: 'd1', frId: 'fr_real', title: 'Solar Microgrid' }]}
    />,
  ));
  const sock = Socket.sockets[0];
  if (!sock) throw new Error('court socket not opened');
  return sock;
}

it('shows human-readable disputes and hides test rows by default', async () => {
  const sock = await render();
  await act(async () => {
    sock.receive(['EVENT', 'court-s4', disputeEvent('a'.repeat(64), 'escrow:fr_real::m2')]);
    sock.receive(['EVENT', 'court-s4', disputeEvent('b'.repeat(64), 'escrow:fr_court_e2e_123::m1')]);
    sock.receive(['EOSE', 'court-s4']);
  });

  const text = container.textContent ?? '';
  // Names + words, not ids: campaign title, milestone, transition verbs.
  expect(text).toContain('Solar Microgrid - milestone 2');
  expect(text).toContain('Refund requested - Release proposed');
  expect(text).toContain('Join the jury');
  // Raw protocol values never render as visible text.
  expect(text).not.toContain('court_e2e');
  expect(text).not.toContain('a'.repeat(64));
  expect(text).not.toContain('escrow:fr_real');
  // The e2e dispute is hidden with a counter.
  expect(text).toContain('1 test dispute hidden during the testing phase.');

  const toggle = container.querySelector('input[type=checkbox]') as HTMLInputElement;
  expect(toggle).toBeTruthy();
  await act(async () => toggle.click());
  const shown = container.textContent ?? '';
  expect(shown).toContain('Unknown campaign - milestone 1');
  expect(shown).not.toContain('test dispute hidden');
});

it('shows the empty state when the relay has no disputes', async () => {
  const sock = await render();
  await act(async () => sock.receive(['EOSE', 'court-s4']));
  expect(container.textContent).toContain('No live disputes on the relay.');
});
