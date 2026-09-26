// src/chat/ChatPanel.draft.test.tsx
//
// Composer input loss: a message rejected BEFORE publishing (over the 8000
// character cap, room not joined) must leave the draft in the composer. The
// old handleSend cleared the input unconditionally, so the error ("Message
// too long - max 8000 characters.") described text that had already been
// destroyed - silent data loss. Same contract for replies (replyToMessage
// resolves false when nothing was published).

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ROOM = { roomId: 'r1', name: 'Troll₿ox', link: 'https://app.bao.network/chat/join#x', shielded: false, joinedAt: 0 };
const MESSAGE = { id: 'm1', author: 'ab'.repeat(32), text: 'hello there', status: 'scrolled' as const };

const h = vi.hoisted(() => ({
  sendMessage: null as unknown,
  replyToMessage: null as unknown,
}));

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signer: null, logout: vi.fn(), pubkey: null, status: 'signed-out' }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ({
    rooms: [ROOM],
    messages: [MESSAGE],
    typing: { authors: [] },
    roster: new Map(),
    mentions: [],
    selectedRoomId: 'r1',
    selectRoom: vi.fn(async () => undefined),
    sendMessage: (...args: unknown[]) => (h.sendMessage as (...a: unknown[]) => unknown)(...args),
    notifyTyping: vi.fn(),
    toggleReaction: vi.fn(async () => undefined),
    retractMessage: vi.fn(async () => undefined),
    replyToMessage: (...args: unknown[]) => (h.replyToMessage as (...a: unknown[]) => unknown)(...args),
    selfAuthor: null,
    isSending: false,
    error: null,
    mentionUnread: new Map(),
    importLink: vi.fn(async () => undefined),
    createRoom: vi.fn(async () => undefined),
    removeRoom: vi.fn(),
    ensureDefaultRooms: vi.fn(async () => undefined),
    capabilities: new Map(),
    capabilityProbeInFlight: false,
    botAuthors: new Set(),
    roles: new Map(),
    bans: new Map(),
    memberClaims: new Map(),
    mayBan: () => false,
    mayKick: () => false,
    banAuthor: vi.fn(async () => undefined),
    liftBan: vi.fn(async () => undefined),
    kickAuthor: vi.fn(async () => undefined),
    mayManageRoles: () => false,
    grantRole: vi.fn(async () => undefined),
    revokeRole: vi.fn(async () => undefined),
    roleGrants: () => new Map(),
    roomFounder: () => null,
  }),
}));

vi.mock('../relay/guestIdentity', () => ({
  createGuestSigner: () => ({
    signEvent: async () => ({ id: 'x', pubkey: 'p', sig: 's', kind: 27235, created_at: 1, tags: [], content: '' }),
  }),
}));

vi.mock('../lib/fundHttp', () => ({
  fundApiOrigin: () => 'https://fund.example',
}));

import { ChatPanel } from './ChatPanel';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  h.sendMessage = vi.fn(async () => true);
  h.replyToMessage = vi.fn(async () => true);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response)));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => root.render(<ChatPanel />));
}

function messageInput(): HTMLInputElement {
  return container.querySelector('form input[placeholder*="Type a message"]') as HTMLInputElement;
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(): Promise<void> {
  const form = messageInput().closest('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

it('keeps an over-limit draft when sendMessage rejects it', async () => {
  h.sendMessage = vi.fn(async () => false);
  await render();
  const long = 'x'.repeat(8001);
  await act(async () => setInput(messageInput(), long));
  await submit();
  expect(h.sendMessage).toHaveBeenCalledWith(long);
  expect(messageInput().value).toBe(long);
});

it('clears the draft when sendMessage accepts it', async () => {
  h.sendMessage = vi.fn(async () => true);
  await render();
  await act(async () => setInput(messageInput(), 'a normal message'));
  await submit();
  expect(messageInput().value).toBe('');
});

it('keeps a rejected reply draft and its reply target', async () => {
  h.replyToMessage = vi.fn(async () => false);
  await render();
  const reply = container.querySelector('[title="Reply"]') as HTMLButtonElement;
  await act(async () => reply.click());
  expect(container.textContent).toContain('Replying to abababab…');
  await act(async () => setInput(messageInput(), 'x'.repeat(8001)));
  await submit();
  expect(h.replyToMessage).toHaveBeenCalledTimes(1);
  expect(messageInput().value).toHaveLength(8001);
  expect(container.textContent).toContain('Replying to abababab…');
});

it('clears the draft and the reply target when the reply is accepted', async () => {
  h.replyToMessage = vi.fn(async () => true);
  await render();
  const reply = container.querySelector('[title="Reply"]') as HTMLButtonElement;
  await act(async () => reply.click());
  await act(async () => setInput(messageInput(), 'a reply'));
  await submit();
  expect(messageInput().value).toBe('');
  expect(container.textContent).not.toContain('Replying to');
});
