import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DM_MAX_TEXT,
  DM_STORE_LIMIT,
  appendDmRecord,
  defaultDmStorage,
  dmSlotKey,
  dmThreads,
  dmUnreadCount,
  hasDmRecord,
  loadDmRecords,
  markThreadRead,
  onDmStoreChange,
  type DmRecord,
  type DmStorageLike,
} from './dmStore';

const IDENTITY_A = 'aa'.repeat(32);
const IDENTITY_B = 'bb'.repeat(32);
const PEER_A = '11'.repeat(32);
const PEER_B = '22'.repeat(32);

let idCounter = 0;
function wrapId(): string {
  idCounter += 1;
  return idCounter.toString(16).padStart(64, '0');
}

function record(overrides: Partial<DmRecord> = {}): DmRecord {
  return {
    id: wrapId(),
    peer: PEER_A,
    direction: 'in',
    text: 'hello',
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

/** Map-backed storage stand-in for the localStorage surface. */
function fakeStorage(): DmStorageLike & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => map,
  };
}

beforeEach(() => {
  localStorage.clear();
  idCounter = 0;
});

describe('dmStore — slot + validation', () => {
  it('keys slots per identity and reads nothing for an invalid pubkey', () => {
    expect(dmSlotKey(IDENTITY_A)).toBe(`baofund:dm:${IDENTITY_A}`);
    expect(dmSlotKey(IDENTITY_A.toUpperCase())).toBe(`baofund:dm:${IDENTITY_A}`);
    for (const bad of [null, undefined, '', 'npub1xyz', 'aa'.repeat(31), 'zz'.repeat(32), 42]) {
      expect(dmSlotKey(bad)).toBeNull();
    }
    const storage = fakeStorage();
    // Invalid pubkeys read NOTHING and write NOTHING (no global fallback slot).
    expect(loadDmRecords('not-a-pubkey', storage)).toEqual([]);
    expect(appendDmRecord('not-a-pubkey', record(), storage)).toEqual({ appended: false, record: null });
    expect(markThreadRead('not-a-pubkey', PEER_A, 1, storage)).toBe(0);
    expect(storage.dump().size).toBe(0);
  });

  it('drops malformed records on load and dedupes by wrap id', () => {
    const storage = fakeStorage();
    const good = record();
    const slot = `baofund:dm:${IDENTITY_A}`;
    storage.setItem(slot, JSON.stringify({
      version: 1,
      messages: [
        good,
        good, // duplicate wrap id
        null,
        'nope',
        { ...good, id: 'short' },
        { ...good, id: wrapId(), peer: 'not-hex' },
        { ...good, id: wrapId(), direction: 'sideways' },
        { ...good, id: wrapId(), text: '' },
        { ...good, id: wrapId(), text: 'x'.repeat(DM_MAX_TEXT + 1) },
        { ...good, id: wrapId(), createdAt: -5 },
        { ...good, id: wrapId(), readAt: 'yesterday' },
      ],
    }));
    const loaded = loadDmRecords(IDENTITY_A, storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(good.id);
    // Case-insensitive id/peer normalization on read.
    storage.setItem(slot, JSON.stringify({
      version: 1,
      messages: [{ ...good, id: good.id.toUpperCase(), peer: PEER_A.toUpperCase() }],
    }));
    expect(loadDmRecords(IDENTITY_A, storage)[0]).toMatchObject({ peer: PEER_A });
  });

  it('degrades corrupt slots to empty and refuses foreign versions', () => {
    const storage = fakeStorage();
    const slot = `baofund:dm:${IDENTITY_A}`;
    for (const raw of ['{oops', '[]', '"str"', 'null', JSON.stringify({ version: 2, messages: [record()] }), JSON.stringify({ version: 1, messages: {} })]) {
      storage.setItem(slot, raw);
      expect(loadDmRecords(IDENTITY_A, storage)).toEqual([]);
    }
    // A corrupt slot never throws and never blocks a fresh append.
    expect(appendDmRecord(IDENTITY_A, record(), storage).appended).toBe(true);
    expect(loadDmRecords(IDENTITY_A, storage)).toHaveLength(1);
  });
});

describe('dmStore — per-identity isolation', () => {
  it('never leaks records across identities', () => {
    const storage = fakeStorage();
    appendDmRecord(IDENTITY_A, record({ text: 'for A' }), storage);
    expect(loadDmRecords(IDENTITY_A, storage)).toHaveLength(1);
    expect(loadDmRecords(IDENTITY_B, storage)).toEqual([]);
    expect(dmUnreadCount(IDENTITY_B, storage)).toBe(0);
    appendDmRecord(IDENTITY_B, record({ text: 'for B', peer: PEER_B }), storage);
    expect(loadDmRecords(IDENTITY_A, storage)).toHaveLength(1);
    expect(loadDmRecords(IDENTITY_B, storage)[0].text).toBe('for B');
    expect(storage.dump().size).toBe(2);
  });
});

describe('dmStore — bounds + threading + unread', () => {
  it('bounds the store to the newest DM_STORE_LIMIT records', () => {
    const storage = fakeStorage();
    for (let i = 0; i < DM_STORE_LIMIT + 40; i += 1) {
      appendDmRecord(IDENTITY_A, record({ text: `m${i}`, createdAt: 1_700_000_000 + i }), storage);
    }
    const loaded = loadDmRecords(IDENTITY_A, storage);
    expect(loaded).toHaveLength(DM_STORE_LIMIT);
    expect(loaded[0].text).toBe('m40');
    expect(loaded[loaded.length - 1].text).toBe(`m${DM_STORE_LIMIT + 39}`);
  });

  it('groups threads by peer, newest activity first, with unread counts', () => {
    const storage = fakeStorage();
    appendDmRecord(IDENTITY_A, record({ peer: PEER_A, text: 'a1', createdAt: 100 }), storage);
    appendDmRecord(IDENTITY_A, record({ peer: PEER_B, text: 'b1', createdAt: 200 }), storage);
    appendDmRecord(IDENTITY_A, record({ peer: PEER_A, direction: 'out', text: 'a2', createdAt: 300 }), storage);
    appendDmRecord(IDENTITY_A, record({ peer: PEER_B, text: 'b2', createdAt: 150 }), storage);
    const threads = dmThreads(IDENTITY_A, storage);
    expect(threads.map((t) => t.peer)).toEqual([PEER_A, PEER_B]);
    expect(threads[0].messages.map((m) => m.text)).toEqual(['a1', 'a2']);
    expect(threads[0].unread).toBe(1);
    // Outgoing messages are never unread; PEER_B has two incoming.
    expect(threads[1].unread).toBe(2);
    expect(dmUnreadCount(IDENTITY_A, storage)).toBe(3);
  });

  it('marks a thread read (incoming only), counts once, and notifies listeners', () => {
    const storage = fakeStorage();
    const seen: string[] = [];
    const off = onDmStoreChange((pubkey) => seen.push(pubkey));
    appendDmRecord(IDENTITY_A, record({ peer: PEER_A, createdAt: 100 }), storage);
    appendDmRecord(IDENTITY_A, record({ peer: PEER_A, direction: 'out', createdAt: 200 }), storage);
    expect(markThreadRead(IDENTITY_A, PEER_A.toUpperCase(), 999, storage)).toBe(1);
    expect(markThreadRead(IDENTITY_A, PEER_A, 1000, storage)).toBe(0);
    expect(dmUnreadCount(IDENTITY_A, storage)).toBe(0);
    expect(dmThreads(IDENTITY_A, storage)[0].messages[0].readAt).toBe(999);
    // The outgoing record keeps its own read marker semantics (never set).
    expect(dmThreads(IDENTITY_A, storage)[0].messages[1].readAt).toBeUndefined();
    expect(seen).toEqual([IDENTITY_A, IDENTITY_A, IDENTITY_A]);
    off();
    appendDmRecord(IDENTITY_A, record({ peer: PEER_B, createdAt: 400 }), storage);
    expect(seen).toEqual([IDENTITY_A, IDENTITY_A, IDENTITY_A]);
    // A store write for another identity never notifies this one's listener id.
    expect(seen).not.toContain(IDENTITY_B);
  });

  it('append is idempotent by wrap id and reports dedupe', () => {
    const storage = fakeStorage();
    const first = record();
    expect(appendDmRecord(IDENTITY_A, first, storage).appended).toBe(true);
    expect(appendDmRecord(IDENTITY_A, first, storage).appended).toBe(false);
    expect(loadDmRecords(IDENTITY_A, storage)).toHaveLength(1);
    expect(hasDmRecord(IDENTITY_A, first.id, storage)).toBe(true);
    expect(hasDmRecord(IDENTITY_A, wrapId(), storage)).toBe(false);
  });

  it('notifies via the writer and survives a listener throw', () => {
    const storage = fakeStorage();
    const boom = vi.fn(() => {
      throw new Error('listener bug');
    });
    const ok = vi.fn();
    const off1 = onDmStoreChange(boom);
    const off2 = onDmStoreChange(ok);
    expect(appendDmRecord(IDENTITY_A, record(), storage).appended).toBe(true);
    expect(boom).toHaveBeenCalledWith(IDENTITY_A);
    expect(ok).toHaveBeenCalledWith(IDENTITY_A);
    off1();
    off2();
  });

  it('uses localStorage by default in a browser-like host', () => {
    expect(defaultDmStorage()).toBe(localStorage);
    appendDmRecord(IDENTITY_A, record());
    expect(localStorage.getItem(`baofund:dm:${IDENTITY_A}`)).toContain('"version":1');
  });
});
