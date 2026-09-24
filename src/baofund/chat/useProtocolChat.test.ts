import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { MergeResult } from '@/baofund/community/merge.js';
import type { ScrollViews } from '@/baofund/community/aggregate.js';
import type { Envelope } from '@/baofund/community/envelope.js';
import { useProtocolChat, type UseProtocolChatReturn } from './useProtocolChat';

const mocks = vi.hoisted(() => ({
  join: vi.fn(),
  probe: vi.fn(),
  stored: [] as { roomId: string; link: string; name?: string }[],
  roomStatus: vi.fn(),
  roomCredential: vi.fn(),
  publicRooms: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('../lib/roomInvite', () => ({
  validateRoomInvite: (link: string) => mocks.validate(link),
}));
vi.mock('../lib/relayStorageProbe', () => ({
  probeRelayStorage: (...args: unknown[]) => mocks.probe(...args),
}));
vi.mock('../lib/baoCommunity', () => ({
  loadFundRooms: () => mocks.stored,
  saveFundRooms: (rooms: typeof mocks.stored) => { mocks.stored = rooms; },
  addFundRoom: (room: (typeof mocks.stored)[number]) => [...mocks.stored.filter(r => r.roomId !== room.roomId), room],
  removeFundRoom: (id: string) => mocks.stored.filter(r => r.roomId !== id),
  roomMetaFromLink: (link: string, name?: string) => ({
    roomId: link,
    link,
    name: name ?? link,
    // Mirror the real opt-in: only the default landing room runs the probe.
    ...(name === 'Trollbox' ? { storageObservation: true } : {}),
  }),
  joinFundRoom: mocks.join,
  encodeTextPayload: (text: string) => ({ text }),
  decodeTextPayload: (p: { text?: string }) => p.text ?? null,
  fetchCampaignRoomStatus: (...args: unknown[]) => mocks.roomStatus(...args),
  requestRoomCredential: (...args: unknown[]) => mocks.roomCredential(...args),
  fetchPublicRooms: (...args: unknown[]) => mocks.publicRooms(...args),
  DEFAULT_LANDING_ROOM: 'Trollbox',
  provisionFundRoom: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function views(id: string) {
  return { timeline: [{ envelope: { msg_id: id, author: id, payload: { text: id } }, redacted: false }],
    roster: new Map(), reactions: new Map(), threadIndex: { threads: new Map(), orphans: [] } } as unknown as ScrollViews;
}
function room(id: string, epoch = 0) {
  const session = {
    subscribeLive: vi.fn((_cb: (env: Envelope) => void) => vi.fn()),
    subscribeTyping: vi.fn(() => vi.fn()), subscribeMentions: vi.fn(() => vi.fn()),
    subscribeReactions: vi.fn(() => vi.fn()), readViews: vi.fn(async () => views(id)), read: vi.fn<() => Promise<MergeResult>>(), post: vi.fn(),
    react: vi.fn(async () => ({}) as Envelope), unreact: vi.fn(async () => ({}) as Envelope), reply: vi.fn(async () => ({}) as Envelope),
  };
  // refreshScroll reads the merged scroll (it needs redacted ids as well as
  // the views); derive the MergeResult from whatever readViews the test set.
  session.read.mockImplementation(async () => {
    const v = await session.readViews();
    return { messages: v.timeline ?? [], rejected: [], coverage: new Map(), chainWarnings: [] } as unknown as MergeResult;
  });
  return { conn: { close: vi.fn(), query: vi.fn(async () => []), subscribe: vi.fn(() => vi.fn()) }, joined: { authorSecretKey: new Uint8Array(32).fill(1), governance: 'aa'.repeat(32), epoch }, session };
}
let current: UseProtocolChatReturn;
let root: Root;
let mounted: boolean;
function Harness() {
  const chat = useProtocolChat();
  React.useLayoutEffect(() => { current = chat; });
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.stored = ['A', 'B'].map(id => ({ roomId: id, link: id }));
  mocks.join.mockReset().mockImplementation(async (id: string, _opts?: unknown) => room(id));
  // Default probe: decisive not-observed-storing (honest relay).
  mocks.probe.mockReset().mockResolvedValue({ conclusive: true, storesEphemeral: false, liveDelivered: true, accepted: true });
  mocks.publicRooms.mockReset().mockResolvedValue([]);
  mocks.validate.mockReset().mockImplementation((link: string) => ({ relay: `wss://relay.test/${link}`, welcomerPub: 'x', routingId: 'y' }));
  root = createRoot(document.createElement('div')); mounted = true;
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); vi.useRealTimers(); });
it('importLink fails closed on an invalid invite (both validator modes: null AND throwing): error shown, NOTHING persisted or joined (bug-hunt 2026-09-22)', async () => {
  const before = current.rooms.length;
  // Mode 1: validator returns a falsy result.
  mocks.validate.mockReturnValueOnce(null);
  await act(async () => { await current.importLink('https://app.bao.network/chat/join#garbage'); });
  expect(current.error).toContain('Invalid, incomplete or expired room invite');
  expect(mocks.join).not.toHaveBeenCalled();
  expect(current.rooms.length).toBe(before);
  // Mode 2: validator THROWS (the real implementation's contract).
  mocks.validate.mockImplementationOnce(() => { throw new Error('Invalid, incomplete or expired room invite'); });
  await act(async () => { await current.importLink('https://app.bao.network/chat/join#garbage2'); });
  expect(current.error).toContain('Invalid, incomplete or expired room invite');
  expect(mocks.join).not.toHaveBeenCalled();
  expect(current.rooms.length).toBe(before);
  // And a valid link still works end-to-end.
  await act(async () => { await current.importLink('good-room'); });
  expect(current.error).toBeNull();
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it('refuses a donor-gated campaign room for a non-contributor and joins nothing', async () => {
  mocks.roomStatus.mockResolvedValue({ gate: 'donors', available: false, reason: 'not_a_contributor' });
  await act(async () => { await current.importCampaign('fr_1', 'Coop', {} as never); });
  expect(current.error).toContain('Only contributors');
  expect(mocks.join).not.toHaveBeenCalled();
  expect(mocks.stored.some((r) => r.link === 'camp-gated')).toBe(false);
});

it('joins an open campaign room through the status endpoint', async () => {
  mocks.roomStatus.mockResolvedValue({ gate: 'open', available: true, link: 'camp-open' });
  await act(async () => { await current.importCampaign('fr_1', 'Coop', {} as never); });
  expect(current.error).toBeNull();
  expect(mocks.join).toHaveBeenCalledTimes(1);
});

it('returns the imported room metadata so hosts select it by its real roomId', async () => {
  mocks.roomStatus.mockResolvedValue({ gate: 'open', available: true, link: 'camp-open' });
  let meta: unknown = 'unset';
  await act(async () => { meta = await current.importCampaign('fr_1', 'Coop', {} as never); });
  expect((meta as { roomId?: string } | null)?.roomId).toBe('camp-open');
  // Fund-from-the-room: the persisted meta carries the campaign ref so the
  // room can offer its Fund action without re-deriving the link.
  expect((meta as { fundraiserId?: string } | null)?.fundraiserId).toBe('fr_1');
});

it('returns null when the campaign room cannot be imported', async () => {
  mocks.roomStatus.mockResolvedValue({ gate: 'donors', available: false, reason: 'not_a_contributor' });
  let meta: unknown = 'unset';
  await act(async () => { meta = await current.importCampaign('fr_1', 'Coop', {} as never); });
  expect(meta).toBeNull();
});

it('surfaces a missing room credential for a contributor instead of joining', async () => {
  mocks.roomStatus.mockResolvedValue({
    gate: 'donors',
    available: true,
    link: 'camp-gated',
    roomId: 'room-1',
    issuerPub: { n: 'ab'.repeat(256), e: '010001' },
  });
  mocks.roomCredential.mockResolvedValue(null);
  await act(async () => { await current.importCampaign('fr_1', 'Coop', {} as never); });
  expect(current.error).toContain('credential');
  expect(mocks.join).not.toHaveBeenCalled();
});

it('joins a newly imported room immediately', async () => {
  await act(async () => current.importLink('new-room'));
  expect(mocks.join).toHaveBeenCalledWith('new-room', {});
  expect(current.selectedRoomId).toBe('new-room');
  expect(current.messages.map(m => m.text)).toEqual(['new-room']);
});
it('disposes a late join without replacing or closing the newer room', async () => {
  const late = deferred<ReturnType<typeof room>>(); const a = room('A'); const b = room('B');
  mocks.join.mockImplementation((id: string) => id === 'A' ? late.promise : Promise.resolve(b));
  let selecting!: Promise<void>;
  await act(async () => { selecting = current.selectRoom('A'); });
  await act(async () => current.selectRoom('B'));
  await act(async () => { late.resolve(a); await selecting; });
  expect(current.selectedRoomId).toBe('B');
  expect(current.messages.map(m => m.text)).toEqual(['B']);
  expect(a.conn.close).toHaveBeenCalledOnce();
  expect(b.conn.close).not.toHaveBeenCalled();
  expect(a.session.subscribeLive).not.toHaveBeenCalled();
});
it.each(['remove', 'unmount'])('disposes a pending join after %s', async action => {
  const late = deferred<ReturnType<typeof room>>(); const a = room('A');
  mocks.join.mockReturnValue(late.promise);
  let selecting!: Promise<void>;
  await act(async () => { selecting = current.selectRoom('A'); });
  await act(async () => {
    if (action === 'remove') current.removeRoom('A');
    else { root.unmount(); mounted = false; }
  });
  await act(async () => { late.resolve(a); await selecting; });
  expect(a.conn.close).toHaveBeenCalledOnce();
  expect(a.session.subscribeLive).not.toHaveBeenCalled();
  if (action === 'remove') expect(current.selectedRoomId).toBeNull();
});
it('ignores stale history and live events after switching rooms', async () => {
  const history = deferred<ScrollViews>(); const a = room('A'); const b = room('B');
  a.session.readViews.mockReturnValue(history.promise);
  mocks.join.mockImplementation(async (id: string) => id === 'A' ? a : b);
  let selecting!: Promise<void>;
  await act(async () => { selecting = current.selectRoom('A'); });
  const callback = a.session.subscribeLive.mock.calls[0][0];
  await act(async () => current.selectRoom('B'));
  await act(async () => { history.resolve(views('A')); await selecting; callback({ msg_id: 'late', payload: { text: 'late' } } as Envelope); });
  expect(current.messages.map(m => m.text)).toEqual(['B']);
  expect(a.session.subscribeReactions).not.toHaveBeenCalled();
});
it('ignores a late failed send after switching rooms', async () => {
  const send = deferred<never>(); const a = room('A');
  a.session.post.mockReturnValue(send.promise);
  mocks.join.mockImplementation(async (id: string) => id === 'A' ? a : room(id));
  await act(async () => current.selectRoom('A'));
  let sending!: Promise<void>;
  await act(async () => { sending = current.sendMessage('hello'); });
  await act(async () => current.selectRoom('B'));
  await act(async () => { send.reject(new Error('old room failed')); await sending; });
  expect(current.error).toBeNull();
  expect(current.isSending).toBe(false);
  expect(current.messages.map(m => m.text)).toEqual(['B']);
});

it('keeps the existing session when reselecting the joined room', async () => {
  await act(async () => current.selectRoom('A'));
  await act(async () => current.selectRoom('A'));
  expect(mocks.join).toHaveBeenCalledTimes(1);
  expect(current.messages.map(m => m.text)).toEqual(['A']);
});
it('re-joins the room when selectRoom is forced (identity rebind)', async () => {
  await act(async () => current.selectRoom('A'));
  await act(async () => current.selectRoom('A'));
  expect(mocks.join).toHaveBeenCalledTimes(1);
  await act(async () => current.selectRoom('A', { force: true }));
  expect(mocks.join).toHaveBeenCalledTimes(2);
});

it('resetSessions closes live sessions and clears room state (sign-out)', async () => {
  const a = room('A');
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  expect(current.messages.map((m) => m.text)).toEqual(['A']);
  await act(async () => current.resetSessions());
  expect(a.conn.close).toHaveBeenCalled();
  expect(current.messages).toEqual([]);
  expect(current.selectedRoomId).toBeNull();
  expect(current.selfAuthor).toBeNull();
});

it('does not show an obsolete join failure in the new room', async () => {
  const late = deferred<ReturnType<typeof room>>();
  mocks.join.mockImplementation((id: string) => id === 'A' ? late.promise : Promise.resolve(room(id)));
  let selecting!: Promise<void>;
  await act(async () => { selecting = current.selectRoom('A'); });
  await act(async () => current.selectRoom('B'));
  await act(async () => { late.reject(new Error('obsolete join')); await selecting; });
  expect(current.error).toBeNull();
  expect(current.messages.map(m => m.text)).toEqual(['B']);
});

it('keeps a live echo pending and merges it with the optimistic bubble', async () => {
  const published = deferred<Envelope>(); const a = room('A');
  a.session.post.mockReturnValue(published.promise);
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  let sending!: Promise<void>;
  await act(async () => { sending = current.sendMessage('hello'); });
  const echo = { msg_id: 'hello-id', author: current.selfAuthor, payload: { text: 'hello' } } as Envelope;
  await act(async () => {
    a.session.subscribeLive.mock.calls[0][0](echo);
    published.resolve(echo);
  });
  expect(current.messages.filter(m => m.text === 'hello')).toEqual([
    expect.objectContaining({ id: 'hello-id', status: 'pending' }),
  ]);
  // Removing the room cancels polling, allowing the pending send to finish.
  await act(async () => { current.removeRoom('A'); await sending; });
});

it('renders the confirming scroll without an additional history fetch', async () => {
  vi.useFakeTimers();
  const a = room('A');
  const envelope = { msg_id: 'confirmed-id', author: 'author', payload: { text: 'confirmed text' } } as Envelope;
  const initial = { envelope: { msg_id: 'A', author: 'A', payload: { text: 'A' } } as unknown as Envelope, redacted: false, scribes: ['scribe'] };
  a.session.post.mockResolvedValue(envelope);
  // The merged scroll carries the initial history AND the confirmation: the
  // receipt's own scroll is applied directly (no extra fetch).
  a.session.read.mockResolvedValue({ messages: [initial, { envelope, redacted: false, scribes: ['scribe'] }], coverage: new Map(), rejected: [], chainWarnings: [] });
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  let sending!: Promise<void>;
  await act(async () => { sending = current.sendMessage('confirmed text'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await sending; });
  // Stable order: the already-rendered history (A) stays; the confirmed
  // message appends. A partial confirming scroll never drops rendered items.
  expect(current.messages.map((m) => m.id)).toEqual(['A', 'confirmed-id']);
  expect(current.messages.find((m) => m.id === 'confirmed-id')?.status).toBe('scrolled');
  // refreshScroll reads the merged scroll directly (redaction ids), so the
  // views-only path is not used; the confirmation still applies the receipt
  // scroll without a second read.
  expect(a.session.readViews).not.toHaveBeenCalled();
  expect(current.isSending).toBe(false);
  expect(current.error).toBeNull();
});

it('measures relay storage at join time and folds the verdict per room', async () => {
  await act(async () => current.importLink('probe-room', 'Trollbox'));
  await act(async () => {});
  expect(mocks.probe).toHaveBeenCalledTimes(1);
  expect(mocks.probe.mock.calls[0][0]).toMatchObject({ relayUrl: 'wss://relay.test/probe-room' });
  const cap = current.capabilities.get('probe-room');
  expect(cap?.storageVerdict).toBe('not-observed-storing');
  expect(cap?.version).toBe(1);
  expect(cap?.relayUrl).toBe('wss://relay.test/probe-room');
  expect(cap?.observedAt).not.toBeNull();
});

it('never probes rooms that do not opt in to the live-only check', async () => {
  mocks.probe.mockClear();
  await act(async () => current.importLink('plain-room'));
  await act(async () => {});
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(current.capabilities.has('plain-room')).toBe(false);
});

it('lands on unknown when the probe is rejected or crashes - never not-observed-storing', async () => {
  mocks.probe.mockReset().mockResolvedValue({ conclusive: false, storesEphemeral: true, accepted: false, liveDelivered: false });
  await act(async () => current.importLink('reject-room', 'Trollbox'));
  await act(async () => {});
  expect(current.capabilities.get('reject-room')?.storageVerdict).toBe('unknown');

  mocks.probe.mockReset().mockRejectedValue(new Error('boom'));
  await act(async () => current.importLink('crash-room', 'Trollbox'));
  await act(async () => {});
  expect(current.capabilities.get('crash-room')?.storageVerdict).toBe('unknown');
});

it('keeps the join flowing while the probe runs (probe failure never blocks chat)', async () => {
  let release!: (v: unknown) => void;
  mocks.probe.mockReset().mockReturnValue(new Promise((resolve) => { release = resolve; }));
  await act(async () => current.importLink('slow-room', 'Trollbox'));
  // Join completed and messages render even though the probe is still pending.
  expect(current.selectedRoomId).toBe('slow-room');
  expect(current.messages.map((m) => m.text)).toEqual(['slow-room']);
  await act(async () => release({ conclusive: true, storesEphemeral: true, liveDelivered: true }));
  expect(current.capabilities.get('slow-room')?.storageVerdict).toBe('stored');
});

it('records the joined room epoch in the capability document (epoch 0 is not null)', async () => {
  await act(async () => current.importLink('probe-room', 'Trollbox'));
  await act(async () => {});
  const cap = current.capabilities.get('probe-room');
  expect(cap?.storageVerdict).toBe('not-observed-storing');
  expect(cap?.epoch).toBe(0);
});

it('folds the joined epoch into a capability probe that resolves after the join', async () => {
  let release!: (v: unknown) => void;
  mocks.probe.mockReset().mockReturnValue(new Promise((resolve) => { release = resolve; }));
  await act(async () => current.importLink('slow-epoch-room', 'Trollbox'));
  // The probe started pre-join; the doc only lands when the probe resolves.
  expect(current.capabilities.get('slow-epoch-room')).toBeUndefined();
  await act(async () => release({ conclusive: true, storesEphemeral: false, liveDelivered: true }));
  const cap = current.capabilities.get('slow-epoch-room');
  expect(cap?.storageVerdict).toBe('not-observed-storing');
  expect(cap?.epoch).toBe(0);
});

it('updates the capability epoch when the room is re-joined at a new epoch', async () => {
  let epoch = 7;
  mocks.join.mockImplementation(async (id: string) => room(id, epoch));
  await act(async () => current.importLink('rekey-room', 'Trollbox'));
  await act(async () => {});
  expect(current.capabilities.get('rekey-room')?.epoch).toBe(7);
  epoch = 3;
  await act(async () => current.selectRoom('rekey-room', { force: true }));
  await act(async () => {});
  expect(current.capabilities.get('rekey-room')?.epoch).toBe(3);
});

it('never carries a stale epoch into a failed re-join (probe lands with null)', async () => {
  let fail = false;
  mocks.join.mockImplementation(async (id: string) => {
    if (fail) throw new Error('admission failed');
    return room(id, 9);
  });
  await act(async () => current.importLink('stale-room', 'Trollbox'));
  await act(async () => {});
  expect(current.capabilities.get('stale-room')?.epoch).toBe(9);
  fail = true;
  await act(async () => current.selectRoom('stale-room', { force: true }));
  await act(async () => {});
  // No live session: the re-measured document must not claim the old epoch.
  expect(current.capabilities.get('stale-room')?.epoch).toBeNull();
  expect(current.error).toContain('admission failed');
});

it('a superseded probe never overwrites a newer verdict (generation guard)', async () => {
  const stale = deferred<unknown>();
  const fresh = deferred<unknown>();
  let epoch = 7;
  mocks.join.mockImplementation(async (id: string) => room(id, epoch));
  mocks.probe.mockReset()
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(fresh.promise);
  await act(async () => current.importLink('gen-room', 'Trollbox'));
  // Re-join while the first probe is still in flight: a NEWER probe starts.
  epoch = 3;
  await act(async () => current.selectRoom('gen-room', { force: true }));
  // The newer probe resolves first with a storing verdict + the new epoch.
  await act(async () => fresh.resolve({ conclusive: true, storesEphemeral: true, liveDelivered: true, accepted: true }));
  expect(current.capabilities.get('gen-room')?.storageVerdict).toBe('stored');
  expect(current.capabilities.get('gen-room')?.epoch).toBe(3);
  // The superseded probe resolves LAST with the stale verdict - it must not fold.
  await act(async () => stale.resolve({ conclusive: true, storesEphemeral: false, liveDelivered: true, accepted: true }));
  expect(current.capabilities.get('gen-room')?.storageVerdict).toBe('stored');
  expect(current.capabilities.get('gen-room')?.epoch).toBe(3);
});

it('a probe for a removed room never folds and does not leave the flag stuck', async () => {
  const pending = deferred<unknown>();
  mocks.probe.mockReset().mockReturnValueOnce(pending.promise);
  await act(async () => current.importLink('doomed-room', 'Trollbox'));
  expect(current.capabilityProbeInFlight).toBe(true);
  await act(async () => current.removeRoom('doomed-room'));
  // The probe resolves AFTER the room was removed: its verdict must not fold
  // (the room no longer exists), and the shared flag must clear.
  await act(async () => pending.resolve({ conclusive: true, storesEphemeral: true, liveDelivered: true, accepted: true }));
  expect(current.capabilities.has('doomed-room')).toBe(false);
  expect(current.capabilityProbeInFlight).toBe(false);
});

it('a re-import during a pending probe cannot be overwritten by the stale result', async () => {
  const stale = deferred<unknown>();
  const fresh = deferred<unknown>();
  mocks.probe.mockReset().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
  await act(async () => current.importLink('reimport-room', 'Trollbox'));
  await act(async () => current.removeRoom('reimport-room'));
  await act(async () => current.importLink('reimport-room', 'Trollbox'));
  await act(async () => fresh.resolve({ conclusive: true, storesEphemeral: true, liveDelivered: true, accepted: true }));
  expect(current.capabilities.get('reimport-room')?.storageVerdict).toBe('stored');
  // The removed room's stale probe resolves LAST - it must not fold or clear
  // the newer probe's state.
  await act(async () => stale.resolve({ conclusive: true, storesEphemeral: false, liveDelivered: true, accepted: true }));
  expect(current.capabilities.get('reimport-room')?.storageVerdict).toBe('stored');
});

it('a superseded probe does not clear the in-flight flag while a newer probe runs', async () => {
  const stale = deferred<unknown>();
  const fresh = deferred<unknown>();
  mocks.probe.mockReset()
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(fresh.promise);
  await act(async () => current.importLink('flag-room', 'Trollbox'));
  await act(async () => current.selectRoom('flag-room', { force: true }));
  await act(async () => stale.resolve({ conclusive: true, storesEphemeral: false, liveDelivered: true, accepted: true }));
  expect(current.capabilityProbeInFlight).toBe(true); // the newer probe is still running
  await act(async () => fresh.resolve({ conclusive: true, storesEphemeral: true, liveDelivered: true, accepted: true }));
  expect(current.capabilityProbeInFlight).toBe(false);
});

// ─── vsk:4 §6.1: admission consumes the banlist at join ───────────────────

import { buildBanEditionEvent } from './banEditions';
import { finalizeEvent, generateSecretKey, getPublicKey } from '@/baofund/community/crypto.js';

it('refuses the join when THIS session key is on the room banlist (typed BanJoinRejected, room closed)', async () => {
  // The session key is derived from authorSecretKey (all-1s fixture).
  const sessionPubkey = getPublicKey(new Uint8Array(32).fill(1));
  const modSk = generateSecretKey(); // holds `ban` under the role fold
  // The fold verifies signatures, so the ROLE edition is signed by the key
  // that becomes the room's governance (founder stand-in) via the fixture.
  const roleSk = generateSecretKey();
  const signedRoleEdition = finalizeEvent({
    kind: 3308, created_at: 100, content: '',
    tags: [
      ['vsk', '1'], ['room', 'banned-room'], ['epoch', '0'], ['catv', '1'],
      ['role', 'moderator', '1'],
      ['perm', 'moderator', 'ban'],
      ['member', 'moderator', getPublicKey(modSk)],
    ],
  }, roleSk);

  const banEdition = buildBanEditionEvent(modSk, {
    roomId: 'banned-room', epoch: 0, target: sessionPubkey, createdAt: 200,
  });

  mocks.join.mockImplementationOnce(() => ({
    conn: {
      close: vi.fn(),
      query: vi.fn(async (filter: { kinds?: number[] }) =>
        filter.kinds?.includes(3308) ? [signedRoleEdition, banEdition] : []),
      subscribe: vi.fn(() => vi.fn()),
    },
    joined: { authorSecretKey: new Uint8Array(32).fill(1), governance: getPublicKey(roleSk), epoch: 0 },
    session: {
      subscribeLive: vi.fn((_cb: (env: Envelope) => void) => vi.fn()),
      subscribeTyping: vi.fn(() => vi.fn()), subscribeMentions: vi.fn(() => vi.fn()),
      subscribeReactions: vi.fn(() => vi.fn()), readViews: vi.fn(async () => views('x')), read: vi.fn<() => Promise<MergeResult>>(), post: vi.fn(),
    },
  }));

  await act(async () => { await current.importLink('banned-room'); });
  await act(async () => {});
  expect(current.error).toContain('banned');
  expect(current.rooms.some((r) => r.roomId === 'banned-room' && (r as unknown as { connected?: boolean }).connected)).toBe(false);
  // The scroll was NEVER read: the door closed before any room content flowed.
  expect(current.messages.filter((m) => m.id === 'x')).toEqual([]);
});

it('shows no room content when a banned join is refused mid-handshake', async () => {
  const sessionPubkey = getPublicKey(new Uint8Array(32).fill(1));
  const roleSk = generateSecretKey();
  const roleEdition = finalizeEvent({
    kind: 3308, created_at: 100, content: '',
    tags: [
      ['vsk', '1'], ['room', 'mid-ban'], ['epoch', '0'], ['catv', '1'],
      ['role', 'moderator', '1'],
      ['perm', 'moderator', 'ban'],
      ['member', 'moderator', sessionPubkey],
    ],
  }, roleSk);
  const banEdition = buildBanEditionEvent(roleSk, {
    roomId: 'mid-ban', epoch: 0, target: sessionPubkey, createdAt: 200,
  });
  const query = deferred<unknown[]>();
  const liveCbs: Array<(env: Envelope) => void> = [];
  mocks.join.mockImplementationOnce(() => ({
    conn: { close: vi.fn(), query: vi.fn(() => query.promise), subscribe: vi.fn(() => vi.fn()) },
    joined: { authorSecretKey: new Uint8Array(32).fill(1), governance: getPublicKey(roleSk), epoch: 0 },
    session: {
      subscribeLive: vi.fn((cb: (env: Envelope) => void) => { liveCbs.push(cb); return vi.fn(); }),
      subscribeTyping: vi.fn(() => vi.fn()), subscribeMentions: vi.fn(() => vi.fn()),
      subscribeReactions: vi.fn(() => vi.fn()), readViews: vi.fn(async () => views('x')),
      read: vi.fn<() => Promise<MergeResult>>(), post: vi.fn(),
    },
  }) as never);

  let joining!: Promise<void>;
  await act(async () => { joining = current.importLink('mid-ban'); await Promise.resolve(); });
  // A live envelope lands while the admission query is still in flight.
  await act(async () => {
    liveCbs[0]?.({ msg_id: 'c'.repeat(32), author: 'e'.repeat(64), payload: { text: 'secret' } } as Envelope);
  });
  expect(current.messages.map((m) => m.text)).toEqual(['secret']);

  await act(async () => { query.resolve([roleEdition, banEdition]); await joining; });
  expect(current.error).toContain('banned');
  // The door was refused: none of the room's content may remain rendered.
  expect(current.messages).toEqual([]);
});

it('a room with no banlist still joins normally (no false eviction)', async () => {
  mocks.join.mockImplementationOnce(() => room('clean-room'));
  await act(async () => { await current.importLink('clean-room'); });
  await act(async () => {});
  expect(current.selectedRoomId).toBe('clean-room');
  expect(current.error).toBeNull();
});

it('defaults import both public doors for a member', async () => {
  mocks.publicRooms.mockResolvedValue([
    { roomId: 'room-trollbox', name: 'Trollbox', link: 'trollbox-link' },
    { roomId: 'room-public', name: 'Public Chat', link: 'public-link' },
  ]);
  await act(async () => { await current.ensureDefaultRooms({} as never, true); });
  expect(mocks.stored.some((r) => r.name === 'Trollbox')).toBe(true);
  expect(mocks.stored.some((r) => r.name === 'Public Chat')).toBe(true);
});

it('guest defaults import ONLY the requested public door', async () => {
  mocks.publicRooms.mockResolvedValue([
    { roomId: 'room-trollbox', name: 'Trollbox', link: 'trollbox-link' },
    { roomId: 'room-public', name: 'Public Chat', link: 'public-link' },
  ]);
  await act(async () => {
    await current.ensureDefaultRooms({} as never, true, { onlyRoomName: 'Trollbox' });
  });
  expect(mocks.stored.some((r) => r.name === 'Trollbox')).toBe(true);
  expect(mocks.stored.some((r) => r.name === 'Public Chat')).toBe(false);
});

it('lands in the freshly imported public door (no stale rooms closure)', async () => {
  // Fresh browser: the hook mounted with an empty room list, then the default
  // import arrives. Landing must activate the imported meta directly -
  // selectRoom's closure would still see the empty pre-import state.
  mocks.stored = [];
  mocks.publicRooms.mockResolvedValue([
    { roomId: 'trollbox-link', name: 'Trollbox', link: 'trollbox-link' },
  ]);
  await act(async () => {
    await current.ensureDefaultRooms({} as never, false, { onlyRoomName: 'Trollbox' });
  });
  await act(async () => {});
  expect(current.selectedRoomId).toBe('trollbox-link');
  expect(mocks.join).toHaveBeenCalled();
});

// ─── deep-hunt D1: control authority, identity collisions, stale state ────

function controlRoom(id: string, opts: {
  query: (filter: { kinds?: number[] }) => Promise<unknown[]>;
  governance: string;
  onPublish?: (event: unknown) => void;
  authorSecretKey?: Uint8Array;
}) {
  const base = room(id);
  base.conn.query = vi.fn(async (filter: { kinds?: number[] }) => opts.query(filter)) as never;
  base.conn.subscribe = vi.fn(() => vi.fn()) as never;
  (base.conn as unknown as { publish: (event: unknown) => Promise<void> }).publish = vi.fn(async (event: unknown) => { opts.onPublish?.(event); });
  const joined = { ...base.joined, governance: opts.governance, ...(opts.authorSecretKey ? { authorSecretKey: opts.authorSecretKey } : {}) };
  return { ...base, joined };
}

it('folds a kick published by a kick-only perm holder (authority must mirror mayKick)', async () => {
  const sessionPubkey = getPublicKey(new Uint8Array(32).fill(1));
  const roleSk = generateSecretKey();
  const target = getPublicKey(generateSecretKey());
  // `greeter` has no catalog perms; the edition declares ONLY `kick`, so the
  // session holds kick but NOT ban. The fold must authorize its kick editions.
  const kickEdition = finalizeEvent({
    kind: 3308, created_at: 100, content: '',
    tags: [
      ['vsk', '1'], ['room', 'kick-room'], ['epoch', '0'], ['catv', '1'],
      ['role', 'greeter', '3'],
      ['perm', 'greeter', 'kick'],
      ['member', 'greeter', sessionPubkey],
    ],
  }, roleSk);
  const published: unknown[] = [];
  mocks.join.mockImplementationOnce(() => controlRoom('kick-room', {
    query: async (filter) => (filter.kinds?.includes(3308) ? [kickEdition] : []),
    governance: getPublicKey(roleSk),
    onPublish: (e) => published.push(e),
  }) as never);

  await act(async () => { await current.importLink('kick-room'); });
  await act(async () => {});
  expect(current.mayKick('kick-room', target)).toBe(true);
  await act(async () => { await current.kickAuthor(target); });
  expect(published).toHaveLength(1);
  const kickEvent = published[0] as { tags: string[][] };
  expect(kickEvent.tags.some((t) => t[0] === 'expiration')).toBe(true);
  // The kick must be recognized (temporarily banned) for every folder.
  expect(current.bans.get('kick-room')?.banned.has(target)).toBe(true);
});

it('does not let a different author shadow a rendered message by reusing its msg_id', async () => {
  const a = room('A');
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  const live = a.session.subscribeLive.mock.calls[0][0] as (env: Envelope) => void;
  const myAuthor = current.selfAuthor!;
  const mine = { msg_id: 'c'.repeat(32), author: myAuthor, payload: { text: 'mine' } } as Envelope;
  await act(async () => { live(mine); });
  const spoofed = { msg_id: 'c'.repeat(32), author: 'd'.repeat(64), payload: { text: 'spoofed' } } as Envelope;
  await act(async () => { live(spoofed); });
  // The attacker's envelope is a distinct protocol message (different author):
  // it renders as its own item instead of overwriting the first.
  expect(current.messages.filter((m) => m.id === 'c'.repeat(32)).map((m) => [m.author, m.text]))
    .toEqual([[myAuthor, 'mine'], ['d'.repeat(64), 'spoofed']]);
});

it('a failed control query on rejoin never leaves stale ban authority', async () => {
  const sessionPubkey = getPublicKey(new Uint8Array(32).fill(1));
  const founderSk = generateSecretKey();
  const founderPub = getPublicKey(founderSk);
  const target = getPublicKey(generateSecretKey());
  const roleEdition = finalizeEvent({
    kind: 3308, created_at: 100, content: '',
    tags: [
      ['vsk', '1'], ['room', 'stale-room'], ['epoch', '0'], ['catv', '1'],
      ['role', 'moderator', '1'],
      ['perm', 'moderator', 'ban'],
      ['member', 'moderator', sessionPubkey],
    ],
  }, founderSk);
  mocks.join
    .mockImplementationOnce(() => controlRoom('stale-room', {
      query: async (filter) => (filter.kinds?.includes(3308) ? [roleEdition] : []),
      governance: founderPub,
    }) as never)
    .mockImplementationOnce(() => controlRoom('stale-room', {
      query: async () => { throw new Error('relay offline'); },
      governance: founderPub,
    }) as never);

  await act(async () => { await current.importLink('stale-room'); });
  await act(async () => {});
  expect(current.mayBan('stale-room', target)).toBe(true);

  await act(async () => { current.removeRoom('stale-room'); });
  await act(async () => { await current.importLink('stale-room'); });
  await act(async () => {});
  // No control edition was folded for THIS session: authority must be denied,
  // not inherited from the previous session's fold.
  expect(current.mayBan('stale-room', target)).toBe(false);
  expect(current.roles.get('stale-room')?.status).not.toBe('ok');
});

it('refuses role management when the top edition catalog is unknown (fail closed)', async () => {
  const sessionPubkey = getPublicKey(new Uint8Array(32).fill(1));
  const target = getPublicKey(generateSecretKey());
  // catv:9 is not in this client's catalog: the fold renders `?` and
  // enforces NOTHING - not even for the founder, whose UI gate already
  // refuses (`mayManageRoles`) but whose publish path did not.
  const unknownEdition = finalizeEvent({
    kind: 3308, created_at: 100, content: '',
    tags: [
      ['vsk', '1'], ['room', 'catv-room'], ['epoch', '0'], ['catv', '9'],
      ['role', 'wizard', '1'],
      ['perm', 'wizard', 'ban'],
      ['member', 'wizard', sessionPubkey],
    ],
  }, new Uint8Array(32).fill(1));
  mocks.join.mockImplementationOnce(() => controlRoom('catv-room', {
    query: async (filter) => (filter.kinds?.includes(3308) ? [unknownEdition] : []),
    governance: sessionPubkey,
  }) as never);

  await act(async () => { await current.importLink('catv-room'); });
  await act(async () => {});
  expect(current.roles.get('catv-room')?.unknownCatalog).toBe(true);
  expect(current.mayManageRoles('catv-room')).toBe(false);
  await expect(current.grantRole(target)).rejects.toThrow(/unknown catalog/);
});

it('toggles this author\'s reaction off (unreact) when the scroll shows it', async () => {
  const target = 'a'.repeat(32);
  const self = getPublicKey(new Uint8Array(32).fill(1));
  const a = room('A');
  const withReaction = {
    timeline: [
      { envelope: { msg_id: 'A', author: 'A', payload: { text: 'A' } }, redacted: false },
      { envelope: { msg_id: 'b'.repeat(32), author: self, payload: { reaction: '⚡', target } }, redacted: false },
    ],
    roster: new Map(), reactions: new Map(), threadIndex: { threads: new Map(), orphans: [] },
  } as unknown as ScrollViews;
  a.session.readViews.mockResolvedValue(withReaction);
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));

  // The scroll shows THIS author's ⚡: the tap must retract it (unreact), not
  // add another `remove:false` reaction (the library's react() is add-only).
  a.session.readViews.mockResolvedValue(views('A'));
  await act(async () => { await current.toggleReaction(target, '⚡'); });
  expect(a.session.unreact).toHaveBeenCalledWith(target, '⚡');
  expect(a.session.react).not.toHaveBeenCalled();

  // The reaction is gone now: the next tap adds it back.
  await act(async () => { await current.toggleReaction(target, '⚡'); });
  expect(a.session.react).toHaveBeenCalledWith(target, '⚡');
  expect(a.session.unreact).toHaveBeenCalledTimes(1);
});

it('postToRoom posts to the JOINED room quietly (no bubble, no scroll-apply) and skips unjoined rooms', async () => {
  vi.useFakeTimers();
  const a = room('A');
  const envelope = { msg_id: 'note-id', author: 'x'.repeat(64), payload: { text: 'release note' } } as Envelope;
  a.session.post.mockResolvedValue(envelope);
  a.session.read.mockResolvedValue({ messages: [{ envelope, redacted: false, scribes: ['scribe'] }], coverage: new Map(), rejected: [], chainWarnings: [] });
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  const renderedBefore = current.messages.map((m) => m.id);
  let posting!: Promise<boolean>;
  await act(async () => { posting = current.postToRoom('A', 'release note'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  const ok = await posting;
  expect(a.session.post).toHaveBeenCalledTimes(1);
  expect(ok).toBe(true);
  // Quiet path: the rendered list is UNCHANGED (no optimistic bubble, no
  // confirmation scroll applied over what the user is reading).
  expect(current.messages.map((m) => m.id)).toEqual(renderedBefore);
  expect(current.error).toBeNull();
  // Single-live-session (WS3 option C): a stored-but-not-live room is not
  // joined, so the note is skipped (false) rather than erroring.
  let ok2: boolean | undefined;
  await act(async () => { ok2 = await current.postToRoom('not-joined', 'x'); });
  expect(ok2).toBe(false);
  expect(current.error).toBeNull();
});

it('postToRoom returns false on receipt timeout and leaves no error or sending state', async () => {
  vi.useFakeTimers();
  const a = room('A');
  a.session.post.mockResolvedValue({ msg_id: 'z', author: 'a', payload: { text: 'x' } } as Envelope);
  // Never confirms: read keeps returning an unrelated timeline.
  a.session.read.mockResolvedValue({ messages: [], coverage: new Map(), rejected: [], chainWarnings: [] });
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  let posting!: Promise<boolean>;
  await act(async () => { posting = current.postToRoom('A', 'note'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
  const ok = await posting;
  expect(ok).toBe(false);
  expect(current.error).toBeNull();
  expect(current.isSending).toBe(false);
});

it('resetSessions clears mention badges from the signed-out session (mentions-only contract)', async () => {
  const a = room('A');
  mocks.join.mockResolvedValue(a);
  await act(async () => current.selectRoom('A'));
  const mentionCb = (a.session.subscribeMentions.mock.calls[0] as unknown as [string, (m: { roomId: string; from: string; text: string }) => void])[1];
  await act(async () => { mentionCb({ roomId: 'A', from: 'f'.repeat(64), text: 'hi' }); });
  expect(current.mentionUnread.get('A')).toBe(1);
  await act(async () => { current.resetSessions(); });
  expect(current.mentionUnread.size).toBe(0);
  // WS3 option C: the hook no longer exposes message unread counts at all.
  expect('unread' in current).toBe(false);
});
