/**
 * Admin-gated in-app room creation (owner 2026-09-22): an ADMIN sees the "+"
 * affordance and can mint an arbitrary (invisible) room even with the build
 * flag off; everyone else keeps the operator-provisioned flow.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isAdmin: false, createRoom: vi.fn(async () => undefined) }));

vi.mock('./useIsChatAdmin', () => ({
  useIsChatAdmin: () => mocks.isAdmin,
  fetchIsChatAdmin: async () => mocks.isAdmin,
}));

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

const SIGNER = { getPublicKey: async () => 'a'.repeat(64), signEvent: vi.fn() };
vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signer: SIGNER, logout: vi.fn(), pubkey: 'a'.repeat(64) }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ({
    rooms: [{ roomId: 'r1', name: 'Trollbox', link: 'https://app.bao.network/chat/join#x', shielded: false, joinedAt: 0 }],
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
    createRoom: mocks.createRoom,
    removeRoom: vi.fn(),
    ensureDefaultRooms: vi.fn(async () => undefined),
    syncExternalRooms: vi.fn(async () => undefined),
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
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => root.render(<ChatPanel />));
}

it('hides the create affordance for a non-admin (build flag off)', async () => {
  mocks.isAdmin = false;
  await render();
  expect(container.querySelector('[aria-label="Create room"]')).toBeNull();
  expect(container.querySelector('input[placeholder="Room name"]')).toBeNull();
});

it('an admin sees "+" and can mint a room from the UI', async () => {
  mocks.isAdmin = true;
  await render();
  const plus = container.querySelector('[aria-label="Create room"]') as HTMLButtonElement | null;
  expect(plus).not.toBeNull();

  await act(async () => plus!.click());
  const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Room name"]');
  expect(nameInput).not.toBeNull();

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(nameInput!, 'Invisible HQ');
    nameInput!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = nameInput!.closest('form')!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.createRoom).toHaveBeenCalledWith('Invisible HQ', expect.anything(), expect.anything());
});
