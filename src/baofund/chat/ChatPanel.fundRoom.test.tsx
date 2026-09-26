// src/chat/ChatPanel.fundRoom.test.tsx
//
// Fund from the room (owner priority 2026-09-22): a campaign room carries its
// fundraiserId, so the room header offers a Fund action that opens the pledge
// flow (whose built-in-wallet step pre-fills the escrow). Rooms without a
// campaign ref must not show the action.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  room: {
    roomId: 'r1',
    name: 'Coop Room',
    link: 'https://app.bao.network/chat/join#x',
    shielded: false,
    joinedAt: 0,
    fundraiserId: 'fr_1' as string | undefined,
  },
}));

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

vi.mock('../auth/useAuth', () => ({
  // Signed-in: `visibleRooms` only shows the public landing room to guests,
  // and a campaign room is never the landing room.
  useAuth: () => ({ signer: { signEvent: vi.fn(async () => ({})) }, logout: vi.fn(), pubkey: 'ab'.repeat(32) }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ({
    rooms: [state.room],
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
  state.room.fundraiserId = 'fr_1';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('offers Fund in a campaign room and reports the campaign to the app', async () => {
  const onFundCampaign = vi.fn();
  await act(async () => root.render(<ChatPanel onFundCampaign={onFundCampaign} />));

  const button = container.querySelector('[data-testid=chat-fund-campaign]');
  expect(button).toBeTruthy();

  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(onFundCampaign).toHaveBeenCalledWith('fr_1', 'Coop Room');
});

it('hides Fund for rooms with no campaign ref (or no handler)', async () => {
  state.room.fundraiserId = undefined;
  await act(async () => root.render(<ChatPanel onFundCampaign={vi.fn()} />));
  expect(container.querySelector('[data-testid=chat-fund-campaign]')).toBeNull();

  state.room.fundraiserId = 'fr_1';
  await act(async () => root.render(<ChatPanel />));
  expect(container.querySelector('[data-testid=chat-fund-campaign]')).toBeNull();
});
