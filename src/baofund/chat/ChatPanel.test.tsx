// src/chat/ChatPanel.test.tsx
//
// Render-level regression for the owner rule "all chats have the same
// features": the fullscreen toggle must exist in EMBEDDED mode (bao.network
// hub) exactly like the standalone surfaces, and expand the panel to the
// fixed overlay. Escape exits.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ROOM = { roomId: 'r1', name: 'Trollbox', link: 'https://app.bao.network/chat/join#x', shielded: false, joinedAt: 0 };

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

import { ChatPanel } from './ChatPanel';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom has no Element.scrollTo - the panel auto-scrolls on fullscreen.
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
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
