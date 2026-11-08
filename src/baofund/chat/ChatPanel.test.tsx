// src/chat/ChatPanel.test.tsx
//
// Render-level regression for the owner rule "all chats have the same
// features": the fullscreen toggle must exist in EMBEDDED mode (bao.network
// hub) exactly like the standalone surfaces, and expand the panel to the
// fixed overlay. Escape exits.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ROOM = { roomId: 'r1', name: 'Troll₿ox', link: 'https://app.bao.network/chat/join#x', shielded: false, joinedAt: 0, publicLanding: true };

const h = vi.hoisted(() => ({
  mentionUnread: new Map<string, number>(),
  importLink: vi.fn(async () => undefined),
}));

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signer: null, logout: vi.fn(), pubkey: null }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ({
    rooms: [ROOM],
    messages: [],
    typing: { authors: [] },
    roster: new Map(),
    mentions: [],
    selectedRoomId: 'r1',
    selectRoom: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    notifyTyping: vi.fn(),
    toggleReaction: vi.fn(async () => undefined),
    retractMessage: vi.fn(async () => undefined),
    replyToMessage: vi.fn(async () => undefined),
    selfAuthor: null,
    isSending: false,
    error: null,
    mentionUnread: h.mentionUnread,
    importLink: h.importLink,
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

import { ChatPanel } from './ChatPanel';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom has no Element.scrollTo - the panel auto-scrolls on fullscreen.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  h.mentionUnread = new Map();
  h.importLink.mockClear();
  // Every test starts on a plain path: only a join path adopts a fragment.
  window.history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: React.ComponentProps<typeof ChatPanel>): Promise<void> {
  await act(async () => root.render(<ChatPanel {...props} />));
}

function panel(): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

it('embedded chat offers the fullscreen toggle and expands to the overlay', async () => {
  await render({ embedded: true });
  const toggle = container.querySelector('[aria-label="Toggle fullscreen chat"]');
  expect(toggle).toBeTruthy();
  expect(panel().className).not.toContain('fixed inset-0');

  await act(async () => {
    toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(panel().className).toContain('fixed inset-0');
  expect(container.querySelector('[aria-label="Toggle fullscreen chat"]')?.getAttribute('title')).toBe('Exit fullscreen (Esc)');

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(panel().className).not.toContain('fixed inset-0');
});

it('standalone chat keeps the same toggle', async () => {
  await render({});
  expect(container.querySelector('[aria-label="Toggle fullscreen chat"]')).toBeTruthy();
});

it('keeps the host surface title (fund app) and restores it on unmount; mentions only', async () => {
  // The fund host ships "₿AO Fund" as its title. The chat must not relabel
  // the page to a hardcoded "₿AO" on mount, must prefix MENTION counts, and
  // must restore the host title when it unmounts (tab switch).
  document.title = '₿AO Fund';
  h.mentionUnread = new Map([['r1', 2]]);
  const localContainer = document.createElement('div');
  document.body.append(localContainer);
  const localRoot = createRoot(localContainer);
  await act(async () => localRoot.render(<ChatPanel />));
  expect(document.title).toBe('(2) ₿AO Fund');
  await act(async () => localRoot.unmount());
  expect(document.title).toBe('₿AO Fund');
  localContainer.remove();
});

it('does not relabel the host surface when there are no mentions', async () => {
  document.title = '₿AO Fund';
  await render({});
  expect(document.title).toBe('₿AO Fund');
});

it('opens the room a join link names, without a paste', async () => {
  // The link IS the invite: opening /chat/join#<fragment> must do exactly what
  // pasting the same string into the panel does.
  window.history.replaceState(null, '', '/chat/join#frag-abc');
  await render({});
  expect(h.importLink).toHaveBeenCalledWith(`${window.location.origin}/chat/join#frag-abc`);
});

it('adopts a fal.live join link as the canonical invite URL', async () => {
  window.history.replaceState(null, '', '/fal-live/join#frag-live');
  await render({ embedded: true });
  // One canonical form: the frame opens the room, the stored link stays /chat/join.
  expect(h.importLink).toHaveBeenCalledWith(`${window.location.origin}/chat/join#frag-live`);
});

it('never adopts a fragment standing on the chat page itself', async () => {
  // Anchors and campaign hashes live on the surfaces too; only a join path is
  // an invite, or every deep link would be imported as a room.
  window.history.replaceState(null, '', '/community#section-2');
  await render({});
  expect(h.importLink).not.toHaveBeenCalled();
});
