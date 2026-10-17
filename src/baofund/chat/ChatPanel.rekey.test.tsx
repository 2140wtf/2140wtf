// src/chat/ChatPanel.rekey.test.tsx
//
// Rekey affordance (ADR-voice-invisible-rooms v10.2, section 11.5): the room header offers
// "Rekey room" to signed-in members on voice-capable rooms; the API decides
// (creator or BAO admin) and typed-403s everyone else. Render-level contract:
// the button exists exactly when signer AND voice material are present, and
// the click posts the rekey endpoint with the signer attached.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ROOM = { roomId: 'r1', name: 'Troll₿ox', link: 'https://app.bao.network/chat/join#x', shielded: false, joinedAt: 0 };

const h = vi.hoisted(() => ({
  voiceMaterial: new Map<string, { voiceRoot: string; voiceGeneration: number }>(),
  signer: null as unknown,
  selectRoom: vi.fn(async () => undefined),
}));

const fund = vi.hoisted(() => ({
  fetch: vi.fn(async (_path: string, _opts?: unknown) => ({ data: { admin: false } })),
}));

vi.mock('../lib/fundHttp', () => ({
  fundFetch: (...args: unknown[]) => fund.fetch(args[0] as string, args[1]),
}));

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signer: h.signer, logout: vi.fn(), pubkey: h.signer ? 'aa'.repeat(32) : null }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ({
    rooms: [ROOM],
    messages: [],
    voiceMaterial: h.voiceMaterial,
    typing: { authors: [] },
    roster: new Map(),
    mentions: [],
    selectedRoomId: 'r1',
    selectRoom: h.selectRoom,
    sendMessage: vi.fn(async () => undefined),
    notifyTyping: vi.fn(),
    toggleReaction: vi.fn(async () => undefined),
    retractMessage: vi.fn(async () => undefined),
    replyToMessage: vi.fn(async () => undefined),
    selfAuthor: null,
    isSending: false,
    error: null,
    roomLoading: false,
    mentionUnread: new Map<string, number>(),
    importLink: vi.fn(async () => undefined),
    createRoom: vi.fn(async () => undefined),
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
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  h.voiceMaterial = new Map();
  h.signer = null;
  h.selectRoom = vi.fn(async () => undefined);
  fund.fetch.mockClear();
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

function rekeyButton(): HTMLElement | null {
  return container.querySelector('[data-testid="chat-rekey-room"]');
}

const MATERIAL = { voiceRoot: 'ab'.repeat(32), voiceGeneration: 0 };

it('shows the rekey button for a signed-in member on a voice room and posts the endpoint', async () => {
  h.signer = { marker: 'signer' };
  h.voiceMaterial = new Map([['r1', MATERIAL]]);
  await render();

  const button = rekeyButton();
  expect(button).not.toBeNull();

  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // Rekey is confirm-gated: the first click only opens the confirmation.
  expect(fund.fetch.mock.calls.find(([path]) => String(path).includes('/rekey'))).toBeFalsy();
  expect(container.querySelector('[data-testid="chat-rekey-confirm"]')).not.toBeNull();

  await act(async () => {
    container.querySelector('[data-testid="chat-rekey-confirm-yes"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const call = fund.fetch.mock.calls.find(([path]) => String(path).includes('/rekey'));
  expect(call).toBeTruthy();
  expect(call![0]).toBe('/v1/chat/rooms/r1/rekey');
  expect((call![1] as { method?: string }).method).toBe('POST');
  expect((call![1] as { signer?: unknown }).signer).toEqual({ marker: 'signer' });
  expect(h.selectRoom).toHaveBeenCalledWith('r1', { force: true });
  expect(container.textContent).toContain('Room keys rotated');
});

it('hides the rekey button when signed out', async () => {
  h.signer = null;
  h.voiceMaterial = new Map([['r1', MATERIAL]]);
  await render();
  expect(rekeyButton()).toBeNull();
});

it('hides the rekey button on a room without voice material', async () => {
  h.signer = { marker: 'signer' };
  h.voiceMaterial = new Map();
  await render();
  expect(rekeyButton()).toBeNull();
});

it('surfaces the server error when the caller is not the operator', async () => {
  h.signer = { marker: 'signer' };
  h.voiceMaterial = new Map([['r1', MATERIAL]]);
  fund.fetch.mockImplementation(async (path: unknown) => {
    if (String(path).includes('/rekey')) throw new Error('Only the room creator or a BAO admin can rekey this room.');
    return { data: { admin: false } };
  });
  await render();

  await act(async () => {
    rekeyButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('[data-testid="chat-rekey-confirm-yes"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(container.textContent).toContain('Only the room creator or a BAO admin can rekey this room.');
});
