/**
 * dmStore - per-identity local store for text DMs on the NIP-17 lane.
 *
 * ADR-dm-calls phase 1 (text DMs): the relay-visible side of a DM is a
 * kind-1059 gift wrap (built/opened by @bao/community `dm.ts`). This module
 * is the LOCAL side: one bounded, versioned localStorage slot per identity -
 *
 *   baofund:dm:<pubkey-lowercase> = { version: 1, messages: DmRecord[] }
 *
 * Storage invariants (mirror the wallet/rail store rules):
 *   - per-identity ONLY: an invalid or absent pubkey reads and writes
 *     NOTHING - there is deliberately no global fallback slot;
 *   - corrupt JSON, a foreign version or a non-array `messages` degrade to
 *     EMPTY (never a throw);
 *   - malformed individual records are dropped on load, duplicate wrap ids
 *     are collapsed (a resubscribe may replay relay history);
 *   - the store is bounded (newest DM_STORE_LIMIT records win).
 *
 * Records are keyed by the OUTER wrap id - the relay-visible handle - so a
 * redelivered wrap can never appear twice, and an outgoing message dedupes
 * against its own echo.
 */

import { IDENTITY_HEX } from '../lib/activeIdentity';

export const DM_STORE_BASE = 'baofund:dm';
export const DM_STORE_VERSION = 1;
/** Bounded store: keep the newest N messages (oldest evicted first). */
export const DM_STORE_LIMIT = 500;
/** Longest text a DM may carry (composer + parser + agent verbs share it). */
export const DM_MAX_TEXT = 4000;

const WRAP_ID_HEX = /^[0-9a-f]{64}$/i;

export interface DmRecord {
  /** Outer kind-1059 event id (the relay-visible dedupe handle). */
  id: string;
  /** Counterparty identity pubkey (lowercase 64-hex). */
  peer: string;
  direction: 'in' | 'out';
  text: string;
  /** Rumor created_at - the real send time (the outer wrap is forward-jittered). */
  createdAt: number;
  /** Local read marker (set by markThreadRead; unread = no readAt). */
  readAt?: number;
}

export interface DmThread {
  peer: string;
  /** Ascending by createdAt. */
  messages: DmRecord[];
  lastAt: number;
  unread: number;
}

/** The minimal storage surface (localStorage in the browser; a Map-backed
 *  stub in tests). */
export interface DmStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage when the host provides one; null in node/agent contexts
 *  (the agent verbs never touch the local store). */
export function defaultDmStorage(): DmStorageLike | null {
  try {
    return (globalThis as { localStorage?: DmStorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** `baofund:dm:<pubkey-lowercase>` - null for anything that is not an identity. */
export function dmSlotKey(pubkey: unknown): string | null {
  return typeof pubkey === 'string' && IDENTITY_HEX.test(pubkey)
    ? `${DM_STORE_BASE}:${pubkey.toLowerCase()}`
    : null;
}

/** Strict record validation: one deviation drops the record (the slot is
 *  untrusted input - another tab, another build, a hand edit). */
export function sanitizeDmRecord(value: unknown): DmRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || !WRAP_ID_HEX.test(r.id)) return null;
  if (typeof r.peer !== 'string' || !IDENTITY_HEX.test(r.peer)) return null;
  if (r.direction !== 'in' && r.direction !== 'out') return null;
  if (typeof r.text !== 'string' || r.text.trim().length === 0 || r.text.length > DM_MAX_TEXT) return null;
  if (typeof r.createdAt !== 'number' || !Number.isSafeInteger(r.createdAt) || r.createdAt <= 0) return null;
  const record: DmRecord = {
    id: r.id.toLowerCase(),
    peer: r.peer.toLowerCase(),
    direction: r.direction,
    text: r.text,
    createdAt: r.createdAt,
  };
  if (r.readAt !== undefined) {
    if (typeof r.readAt !== 'number' || !Number.isSafeInteger(r.readAt) || r.readAt <= 0) return null;
    record.readAt = r.readAt;
  }
  return record;
}

function byCreatedAt(a: DmRecord, b: DmRecord): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Read this identity's DM records (oldest first). Invalid pubkey / missing
 *  storage / corrupt slot -> []. Never throws. */
export function loadDmRecords(pubkey: unknown, storage: DmStorageLike | null = defaultDmStorage()): DmRecord[] {
  const key = dmSlotKey(pubkey);
  if (!key || !storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const file = parsed as Record<string, unknown>;
    if (file.version !== DM_STORE_VERSION || !Array.isArray(file.messages)) return [];
    const seen = new Set<string>();
    const records: DmRecord[] = [];
    for (const item of file.messages) {
      const record = sanitizeDmRecord(item);
      if (!record || seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
    records.sort(byCreatedAt);
    return records.slice(-DM_STORE_LIMIT);
  } catch {
    return [];
  }
}

function writeRecords(key: string, records: DmRecord[], storage: DmStorageLike): void {
  storage.setItem(key, JSON.stringify({ version: DM_STORE_VERSION, messages: records }));
}

type DmStoreListener = (pubkey: string) => void;
const listeners = new Set<DmStoreListener>();

/** Subscribe to local store writes (localStorage `storage` events never fire
 *  in the writing tab, so writers notify their own UI through this channel). */
export function onDmStoreChange(listener: DmStoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cached external-store snapshot per identity (`useSyncExternalStore` needs
 *  a STABLE reference between writes). Invalidated by every write. */
export interface DmSnapshot {
  threads: DmThread[];
  unread: number;
}

export const EMPTY_DM_SNAPSHOT: DmSnapshot = { threads: [], unread: 0 };
const snapshotCache = new Map<string, DmSnapshot>();

/** Stable-snapshot read of the identity's threads + unread count. */
export function dmSnapshot(pubkey: unknown): DmSnapshot {
  const key = dmSlotKey(pubkey);
  if (!key) return EMPTY_DM_SNAPSHOT;
  let snapshot = snapshotCache.get(key);
  if (!snapshot) {
    snapshot = { threads: dmThreads(pubkey), unread: dmUnreadCount(pubkey) };
    snapshotCache.set(key, snapshot);
  }
  return snapshot;
}

function notify(pubkey: string): void {
  snapshotCache.delete(`${DM_STORE_BASE}:${pubkey}`);
  for (const listener of listeners) {
    try {
      listener(pubkey);
    } catch {
      /* a broken listener must never break a store write */
    }
  }
}

/**
 * Append one record (dedupe by wrap id, bound enforced, idempotent).
 * Returns whether the record was appended. Invalid pubkey/record -> no-op.
 */
export function appendDmRecord(
  pubkey: unknown,
  value: unknown,
  storage: DmStorageLike | null = defaultDmStorage(),
): { appended: boolean; record: DmRecord | null } {
  const key = dmSlotKey(pubkey);
  const record = sanitizeDmRecord(value);
  if (!key || !record || !storage) return { appended: false, record: null };
  const records = loadDmRecords(pubkey, storage);
  if (records.some((r) => r.id === record.id)) return { appended: false, record };
  records.push(record);
  records.sort(byCreatedAt);
  writeRecords(key, records.slice(-DM_STORE_LIMIT), storage);
  notify(key.slice(DM_STORE_BASE.length + 1));
  return { appended: true, record };
}

/** True when this wrap id is already stored for the identity. */
export function hasDmRecord(
  pubkey: unknown,
  id: string,
  storage: DmStorageLike | null = defaultDmStorage(),
): boolean {
  return loadDmRecords(pubkey, storage).some((r) => r.id === id.toLowerCase());
}

/**
 * Mark every incoming message of `peer` as read. Returns how many records
 * were marked. Invalid pubkey/peer or no storage -> 0 (fail closed).
 */
export function markThreadRead(
  pubkey: unknown,
  peer: unknown,
  readAt: number = Math.floor(Date.now() / 1000),
  storage: DmStorageLike | null = defaultDmStorage(),
): number {
  const key = dmSlotKey(pubkey);
  if (!key || typeof peer !== 'string' || !IDENTITY_HEX.test(peer) || !storage) return 0;
  if (!Number.isSafeInteger(readAt) || readAt <= 0) return 0;
  const normalizedPeer = peer.toLowerCase();
  let marked = 0;
  const records = loadDmRecords(pubkey, storage).map((record) => {
    if (record.direction === 'in' && record.peer === normalizedPeer && record.readAt === undefined) {
      marked += 1;
      return { ...record, readAt };
    }
    return record;
  });
  if (marked === 0) return 0;
  writeRecords(key, records, storage);
  notify(key.slice(DM_STORE_BASE.length + 1));
  return marked;
}

/** Threading = group by peer. Threads are ordered by newest activity first. */
export function dmThreads(pubkey: unknown, storage: DmStorageLike | null = defaultDmStorage()): DmThread[] {
  const grouped = new Map<string, DmRecord[]>();
  for (const record of loadDmRecords(pubkey, storage)) {
    const list = grouped.get(record.peer);
    if (list) list.push(record);
    else grouped.set(record.peer, [record]);
  }
  const threads: DmThread[] = [];
  for (const [peer, messages] of grouped) {
    const last = messages[messages.length - 1];
    threads.push({
      peer,
      messages,
      lastAt: last.createdAt,
      unread: messages.filter((m) => m.direction === 'in' && m.readAt === undefined).length,
    });
  }
  threads.sort((a, b) => b.lastAt - a.lastAt || (a.peer < b.peer ? -1 : 1));
  return threads;
}

/** Total unread incoming messages for the identity. */
export function dmUnreadCount(pubkey: unknown, storage: DmStorageLike | null = defaultDmStorage()): number {
  return loadDmRecords(pubkey, storage).filter((r) => r.direction === 'in' && r.readAt === undefined).length;
}
