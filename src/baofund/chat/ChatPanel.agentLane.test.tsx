// src/chat/ChatPanel.agentLane.test.tsx
//
// Regression: the onboard prompt must never carry ANOTHER room's agent-lane
// link. `agentLane` is fetched per selected room; when the user switches to a
// room with the same name and no agentLink (and the fetch for the new room
// fails/404s), a useMemo that does not depend on the room id keeps rendering
// the previous room's lane link - handing the agent into the wrong room.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LANDING_ROOM } from '../lib/baoCommunity';

const ROOM_A = { roomId: 'room-a', name: DEFAULT_LANDING_ROOM, link: 'https://app.bao.network/chat/join#human-a', shielded: false, joinedAt: 0 };
const ROOM_B = { roomId: 'room-b', name: DEFAULT_LANDING_ROOM, link: 'https://app.bao.network/chat/join#human-b', shielded: false, joinedAt: 0 };
const AGENT_LINK_A = 'https://app.bao.network/chat/join#agent-a';

const baseCtx = () => ({
  rooms: [ROOM_A] as Array<typeof ROOM_A>,
  messages: [],
  typing: { authors: [] as string[] },
  roster: new Map(),
  mentions: [],
  selectedRoomId: ROOM_A.roomId,
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
  botAuthors: new Set<string>(),
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
  resetSessions: vi.fn(),
});
let ctx = baseCtx();

vi.mock('@/baofund/community/agents.js', () => ({
  roomLinkPrivacy: () => ({ shielded: false }),
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ signer: null, logout: vi.fn(), pubkey: null, status: 'signed-out' }),
}));

vi.mock('./ChatContext', () => ({
  useChatContext: () => ctx,
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
  ctx = baseCtx();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('bao-hello.mjs.sha256')) return { ok: true, text: async () => `${'a'.repeat(64)}\n` } as unknown as Response;
    if (url.includes(`/rooms/${ROOM_A.roomId}/agent-link`)) {
      return { ok: true, status: 200, json: async () => ({ data: { agentLink: AGENT_LINK_A } }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => { await new Promise((resolvePromise) => setTimeout(resolvePromise, 0)); });
  }
}

function openPrompt(): HTMLTextAreaElement {
  const onboard = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Onboard an AI agent'));
  expect(onboard).toBeTruthy();
  act(() => { onboard!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  return container.querySelector('textarea') as HTMLTextAreaElement;
}

it("switching rooms never leaks another room's agent-lane link into the prompt", async () => {
  await act(async () => root.render(<ChatPanel />));
  await flush();
  expect(openPrompt().value).toContain(AGENT_LINK_A);

  // Same-name room, no agentLink, and the API has no lane for it (404): the
  // previously fetched lane must NOT survive the room switch.
  ctx = { ...baseCtx(), rooms: [ROOM_B], selectedRoomId: ROOM_B.roomId };
  await act(async () => root.render(<ChatPanel />));
  await flush();

  const prompt = openPrompt().value;
  expect(prompt).not.toContain(AGENT_LINK_A);
  expect(prompt).toContain('<select a room first>');
});

it('points agents at the public fund app entry, not the gated host', async () => {
  await act(async () => root.render(<ChatPanel />));
  await flush();
  const prompt = openPrompt().value;
  expect(prompt).toContain('The full BAO Fund app');
  expect(prompt).toContain('https://app.bao.network/index.html');
  expect(prompt).toContain('fund.bao.network is the password-gated testnet mirror');
});
