/**
 * baoCommunity - the fund's thin wrapper over @bao/community. Pure parts
 * tested here (rooms persistence, payload convention, link parsing).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadFundRooms,
  addFundRoom,
  removeFundRoom,
  roomMetaFromLink,
  encodeTextPayload,
  decodeTextPayload,
  ROOMS_STORAGE_KEY,
} from './baoCommunity';
import { createJoinLink } from '@/baofund/community/client.js';

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

let storage: Storage;
beforeEach(() => { storage = memStorage(); });

function link(roomId: string, opts: Parameters<typeof createJoinLink>[3] = {}): string {
  return createJoinLink('fund.local', 'ab'.repeat(32), roomId, { relay: 'wss://relay.example', ...opts });
}

describe('rooms persistence', () => {
  it('load/save round-trips and dedupes by roomId', () => {
    expect(loadFundRooms(storage)).toEqual([]);
    const a = roomMetaFromLink(link('room-a'), 'alpha');
    addFundRoom(a, storage);
    const b = roomMetaFromLink(link('room-b'), 'beta');
    addFundRoom(b, storage);
    expect(loadFundRooms(storage)).toHaveLength(2);
    // re-adding the same room replaces (fresh link wins)
    const a2 = roomMetaFromLink(link('room-a'), 'alpha-v2');
    addFundRoom(a2, storage);
    const rooms = loadFundRooms(storage);
    expect(rooms).toHaveLength(2);
    expect(rooms.find((r) => r.roomId === 'room-a')?.name).toBe('alpha-v2');
  });

  it('removeFundRoom removes; corrupt storage loads as empty', () => {
    addFundRoom(roomMetaFromLink(link('room-a')), storage);
    removeFundRoom('room-a', storage);
    expect(loadFundRooms(storage)).toEqual([]);
    storage.setItem(ROOMS_STORAGE_KEY, '{garbage');
    expect(loadFundRooms(storage)).toEqual([]);
  });

  it('drops poisoned entries whose stored roomId does not match the link (identity re-derived)', () => {
    const meta = roomMetaFromLink(link('room-a'));
    addFundRoom(meta, storage);
    // Tamper: a stored roomId that the link does NOT derive.
    const raw = JSON.parse(storage.getItem(ROOMS_STORAGE_KEY)!) as Array<Record<string, unknown>>;
    raw[0]!.roomId = 'evil-room';
    storage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(raw));
    // The link is the durable handle: the poisoned roomId must not survive.
    const rooms = loadFundRooms(storage);
    expect(rooms).toHaveLength(0);
  });

  it('strips a legacy live-only opt-in persisted by older versions', () => {
    const meta = roomMetaFromLink(link('room-a'), 'Trollbox');
    addFundRoom(meta, storage);
    const raw = JSON.parse(storage.getItem(ROOMS_STORAGE_KEY)!) as Array<Record<string, unknown>>;
    raw[0]!.storageObservation = true;
    storage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(raw));
    const rooms = loadFundRooms(storage);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.storageObservation).toBeUndefined();
  });

  it('drops entries whose link no longer parses (malformed) instead of crashing', () => {
    const meta = roomMetaFromLink(link('room-a'));
    addFundRoom(meta, storage);
    const raw = JSON.parse(storage.getItem(ROOMS_STORAGE_KEY)!) as Array<Record<string, unknown>>;
    raw[0]!.link = 'not-a-join-link';
    storage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(raw));
    expect(loadFundRooms(storage)).toEqual([]);
  });
});

describe('roomMetaFromLink', () => {
  it('extracts privacy surface (shielded, invite, audience) from the fragment', () => {
    const l = link('room-x', { shield: 'cd'.repeat(32), linkId: 'inv-9', maxUses: 1, expiresAt: 1_800_000_000, audience: 'agent', label: 'agent:post' });
    const meta = roomMetaFromLink(l);
    expect(meta.roomId).toBe('room-x');
    expect(meta.shielded).toBe(true);
    expect(meta.inviteId).toBe('inv-9');
    expect(meta.maxUses).toBe(1);
    expect(meta.expiresAt).toBe(1_800_000_000);
    expect(meta.audience).toBe('agent');
  });

  it('never arms the live-only storage check on the public rooms', () => {
    const other = roomMetaFromLink(link('room-x'), 'Side Room');
    expect(other.storageObservation).toBeUndefined();
    const trollbox = roomMetaFromLink(link('room-t'), 'Trollbox');
    expect(trollbox.storageObservation).toBeUndefined();
  });

  it('throws on a malformed link (UI surfaces a clean error)', () => {
    expect(() => roomMetaFromLink('https://fund.local/chat/join')).toThrow();
  });
});

describe('payload convention', () => {
  it('encode/decode round-trips; foreign payloads decode to null', () => {
    expect(decodeTextPayload(encodeTextPayload('hello'))).toBe('hello');
    expect(decodeTextPayload({ notText: 1 })).toBeNull();
    expect(decodeTextPayload('string')).toBeNull();
    expect(decodeTextPayload(null)).toBeNull();
  });
});
