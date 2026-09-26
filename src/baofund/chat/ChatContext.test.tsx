import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ChatProvider } from './ChatContext';
import { getGuestPubkeyHex } from '../relay/guestIdentity';
import { resolveMemberIdentity } from './memberIdentity';

// Signed-out visitors must still resolve a member identity: the relay welcomer
// requires a member claim even on `policy: open` rooms, so resolveIdentity
// short-circuiting on `pubkey === null` left guests with "Room admission
// failed". These tests lock the guest fallback to the per-browser guest key.

const h = vi.hoisted(() => ({
  auth: {
    pubkey: null as string | null,
    seedIdentityHex: (() => null) as () => string | null,
  },
  resolve: undefined as ((roomId: string) => Promise<{ pubkey: string } | null>) | undefined,
}));

vi.mock('../auth/useAuth', () => ({ useAuth: () => h.auth }));
vi.mock('./useProtocolChat', () => ({
  useProtocolChat: (opts: { resolveMemberIdentity?: (roomId: string) => Promise<{ pubkey: string } | null> }) => {
    h.resolve = opts.resolveMemberIdentity;
    return {};
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  h.auth.pubkey = null;
  h.auth.seedIdentityHex = () => null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderProvider() {
  await act(async () => root.render(<ChatProvider><div /></ChatProvider>));
  if (!h.resolve) throw new Error('resolveMemberIdentity not passed to useProtocolChat');
  return h.resolve;
}

it('signed out: mints a per-room member identity from the guest key', async () => {
  const resolve = await renderProvider();
  const identity = await resolve('room-1');
  expect(identity).not.toBeNull();
  const expected = await resolveMemberIdentity({ roomId: 'room-1', loginPubkey: getGuestPubkeyHex(), seedHex: null });
  expect(identity?.pubkey).toBe(expected.pubkey);
  expect(localStorage.getItem(`baofund:chat-member:${getGuestPubkeyHex()}:room-1`)).toBeTruthy();
});

it('signed in: uses the login pubkey, not the guest key', async () => {
  h.auth.pubkey = 'ab'.repeat(32);
  const resolve = await renderProvider();
  const identity = await resolve('room-1');
  expect(identity).not.toBeNull();
  expect(localStorage.getItem(`baofund:chat-member:${h.auth.pubkey}:room-1`)).toBeTruthy();
  expect(localStorage.getItem(`baofund:chat-member:${getGuestPubkeyHex()}:room-1`)).toBeNull();
});
