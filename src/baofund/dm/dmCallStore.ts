/**
 * dmCallStore - per-identity local stores for DM calls (ADR-dm-calls §4).
 *
 * Four bounded, versioned localStorage slots per identity:
 *
 *   baofund:dmcall:policy:<pubkey-lowercase> = { version, callsEnabled,
 *                                                missedNotice, whoMayRing,
 *                                                updatedAt }
 *   baofund:dmcall:blocks:<pubkey-lowercase> = { version, hex[], updatedAt }
 *   baofund:dmcall:log:<pubkey-lowercase>    = { version, entries[] }
 *   baofund:dmcall:seen:<pubkey-lowercase>   = { version, ids[] }
 *
 * This module owns ONLY the policy/blocks/log slots (the naming the ADR
 * fixes); budgets and cool-downs live in `dmCallGuard.ts` under
 * `baofund:dmcall:guard:<pubkey-lowercase>`. The `seen` slot is the inbound
 * wrap-id dedupe set for the call layer (relay replays are idempotent).
 *
 * Storage invariants (mirror dmStore / the wallet store rules):
 *   - per-identity ONLY: an invalid or absent pubkey reads and writes
 *     NOTHING - there is deliberately no global fallback slot;
 *   - corrupt JSON, a foreign version or a wrong-typed field degrade to
 *     DEFAULTS / EMPTY (never a throw);
 *   - the block list is lowercase, deduped, capped; the call log is bounded
 *     (newest entries win); malformed entries are dropped on load;
 *   - the policy defaults are fail-closed: `callsEnabled: false` (opt-in by
 *     the ADR) and `whoMayRing: 'nobody'`.
 */

import { IDENTITY_HEX } from '../lib/activeIdentity';
import type { DmStorageLike } from './dmStore';

export const DM_CALL_POLICY_BASE = 'baofund:dmcall:policy';
export const DM_CALL_BLOCKS_BASE = 'baofund:dmcall:blocks';
export const DM_CALL_LOG_BASE = 'baofund:dmcall:log';
export const DM_CALL_SEEN_BASE = 'baofund:dmcall:seen';
export const DM_CALL_STORE_VERSION = 1;

/** Cap on the local block list (a bounded list, like every local store). */
export const DM_CALL_BLOCK_LIMIT = 200;
/** Cap on the local call log (newest entries win). */
export const DM_CALL_LOG_LIMIT = 100;
/** Cap on the inbound wrap-id dedupe set. */
export const DM_CALL_SEEN_LIMIT = 200;

/** Who may ring this identity. `follows` / `mutuals` are evaluated against
 *  a follows oracle; with no oracle data both fail CLOSED (nobody rings). */
export const WHO_MAY_RING = ['nobody', 'follows', 'mutuals', 'anyone'] as const;
export type WhoMayRing = (typeof WHO_MAY_RING)[number];

export interface DmCallPolicy {
  version: typeof DM_CALL_STORE_VERSION;
  /** Opt-in, default OFF (ADR owner input: no ringing unless enabled). */
  callsEnabled: boolean;
  /** Opt-in missed-call notice (default OFF - it weakens the
   *  allowed-timeout/silent-drop indistinguishability, per the ADR). */
  missedNotice: boolean;
  whoMayRing: WhoMayRing;
  updatedAt: number;
}

export const DEFAULT_DM_CALL_POLICY: DmCallPolicy = {
  version: DM_CALL_STORE_VERSION,
  callsEnabled: false,
  missedNotice: false,
  whoMayRing: 'nobody',
  updatedAt: 0,
};

export type DmCallLogOutcome = 'answered' | 'declined' | 'busy' | 'missed' | 'cancelled';

export interface DmCallLogEntry {
  /** The other party (lowercase 64-hex). */
  peer: string;
  /** 'in' = this identity was the callee, 'out' = the caller. */
  direction: 'in' | 'out';
  outcome: DmCallLogOutcome;
  /** When the call/ring ended (unix seconds). */
  at: number;
  /** Talk time for 'answered' entries. */
  durationSec?: number;
}

export interface DmCallStoreSnapshot {
  policy: DmCallPolicy;
  blocks: string[];
  log: DmCallLogEntry[];
}

export const EMPTY_DM_CALL_SNAPSHOT: DmCallStoreSnapshot = {
  policy: DEFAULT_DM_CALL_POLICY,
  blocks: [],
  log: [],
};

function slot(pubkey: unknown, base: string): string | null {
  return typeof pubkey === 'string' && IDENTITY_HEX.test(pubkey) ? `${base}:${pubkey.toLowerCase()}` : null;
}

/** `baofund:dmcall:policy:<pubkey-lowercase>` - null for a non-identity. */
export function dmCallPolicySlot(pubkey: unknown): string | null {
  return slot(pubkey, DM_CALL_POLICY_BASE);
}

/** `baofund:dmcall:blocks:<pubkey-lowercase>` - null for a non-identity. */
export function dmCallBlocksSlot(pubkey: unknown): string | null {
  return slot(pubkey, DM_CALL_BLOCKS_BASE);
}

/** `baofund:dmcall:log:<pubkey-lowercase>` - null for a non-identity. */
export function dmCallLogSlot(pubkey: unknown): string | null {
  return slot(pubkey, DM_CALL_LOG_BASE);
}

/** `baofund:dmcall:seen:<pubkey-lowercase>` - null for a non-identity. */
export function dmCallSeenSlot(pubkey: unknown): string | null {
  return slot(pubkey, DM_CALL_SEEN_BASE);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function readJson(key: string, storage: DmStorageLike): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Policy ─────────────────────────────────────────────────────────────────

/** Validate one parsed policy object; any deviation fails back to defaults. */
export function sanitizeDmCallPolicy(value: unknown): DmCallPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (p.version !== DM_CALL_STORE_VERSION) return null;
  if (typeof p.callsEnabled !== 'boolean' || typeof p.missedNotice !== 'boolean') return null;
  if (typeof p.whoMayRing !== 'string' || !(WHO_MAY_RING as readonly string[]).includes(p.whoMayRing)) return null;
  if (typeof p.updatedAt !== 'number' || !Number.isSafeInteger(p.updatedAt) || p.updatedAt < 0) return null;
  return {
    version: DM_CALL_STORE_VERSION,
    callsEnabled: p.callsEnabled,
    missedNotice: p.missedNotice,
    whoMayRing: p.whoMayRing as WhoMayRing,
    updatedAt: p.updatedAt,
  };
}

/** Read this identity's call policy. Invalid pubkey / missing storage /
 *  corrupt slot -> the fail-closed defaults. Never throws. */
export function loadDmCallPolicy(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): DmCallPolicy {
  const key = dmCallPolicySlot(pubkey);
  if (!key || !storage) return DEFAULT_DM_CALL_POLICY;
  const file = readJson(key, storage);
  return (file && sanitizeDmCallPolicy(file)) ?? DEFAULT_DM_CALL_POLICY;
}

/** Merge a policy patch and persist it. Invalid pubkey -> no-op. */
export function saveDmCallPolicy(
  pubkey: unknown,
  patch: Partial<Pick<DmCallPolicy, 'callsEnabled' | 'missedNotice' | 'whoMayRing'>>,
  storage: DmStorageLike | null = defaultStorage(),
): DmCallPolicy {
  const key = dmCallPolicySlot(pubkey);
  if (!key || !storage) return DEFAULT_DM_CALL_POLICY;
  const current = loadDmCallPolicy(pubkey, storage);
  const next: DmCallPolicy = {
    version: DM_CALL_STORE_VERSION,
    callsEnabled: patch.callsEnabled ?? current.callsEnabled,
    missedNotice: patch.missedNotice ?? current.missedNotice,
    whoMayRing: patch.whoMayRing ?? current.whoMayRing,
    updatedAt: nowSec(),
  };
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep the in-memory result, nothing persisted */
  }
  notify(pubkey);
  return next;
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

function sanitizeBlocks(hexes: unknown): string[] {
  if (!Array.isArray(hexes)) return [];
  const out: string[] = [];
  for (const value of hexes) {
    if (typeof value !== 'string' || !IDENTITY_HEX.test(value)) continue;
    const pk = value.toLowerCase();
    if (out.includes(pk)) continue;
    out.push(pk);
    if (out.length >= DM_CALL_BLOCK_LIMIT) break;
  }
  return out;
}

/** Read this identity's block list (lowercase, deduped, order preserved).
 *  Invalid pubkey / missing storage / corrupt slot -> []. Never throws. */
export function loadDmCallBlocks(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): string[] {
  const key = dmCallBlocksSlot(pubkey);
  if (!key || !storage) return [];
  const file = readJson(key, storage);
  if (!file || file.version !== DM_CALL_STORE_VERSION) return [];
  return sanitizeBlocks(file.hex);
}

function writeBlocks(key: string, blocks: string[], storage: DmStorageLike): void {
  try {
    storage.setItem(key, JSON.stringify({ version: DM_CALL_STORE_VERSION, hex: blocks, updatedAt: nowSec() }));
  } catch {
    /* storage unavailable: nothing persisted */
  }
}

/** True when `peer` is on this identity's block list. Invalid inputs -> false. */
export function isDmCallBlocked(pubkey: unknown, peer: unknown, storage: DmStorageLike | null = defaultStorage()): boolean {
  if (typeof peer !== 'string' || !IDENTITY_HEX.test(peer)) return false;
  return loadDmCallBlocks(pubkey, storage).includes(peer.toLowerCase());
}

/** Add `peer` to the block list (idempotent). Invalid pubkey/peer -> no-op. */
export function addDmCallBlock(
  pubkey: unknown,
  peer: unknown,
  storage: DmStorageLike | null = defaultStorage(),
): string[] {
  const key = dmCallBlocksSlot(pubkey);
  if (!key || !storage || typeof peer !== 'string' || !IDENTITY_HEX.test(peer)) return loadDmCallBlocks(pubkey, storage);
  const peerPk = peer.toLowerCase();
  const blocks = loadDmCallBlocks(pubkey, storage);
  if (!blocks.includes(peerPk)) {
    blocks.push(peerPk);
    writeBlocks(key, blocks.slice(-DM_CALL_BLOCK_LIMIT), storage);
    notify(pubkey);
  }
  return loadDmCallBlocks(pubkey, storage);
}

/** Remove `peer` from the block list. Invalid pubkey/peer -> no-op. */
export function removeDmCallBlock(
  pubkey: unknown,
  peer: unknown,
  storage: DmStorageLike | null = defaultStorage(),
): string[] {
  const key = dmCallBlocksSlot(pubkey);
  if (!key || !storage || typeof peer !== 'string' || !IDENTITY_HEX.test(peer)) return loadDmCallBlocks(pubkey, storage);
  const peerPk = peer.toLowerCase();
  const blocks = loadDmCallBlocks(pubkey, storage).filter((pk) => pk !== peerPk);
  writeBlocks(key, blocks, storage);
  notify(pubkey);
  return loadDmCallBlocks(pubkey, storage);
}

// ─── Call log ───────────────────────────────────────────────────────────────

const LOG_OUTCOMES: readonly DmCallLogOutcome[] = ['answered', 'declined', 'busy', 'missed', 'cancelled'];

export function sanitizeDmCallLogEntry(value: unknown): DmCallLogEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.peer !== 'string' || !IDENTITY_HEX.test(e.peer)) return null;
  if (e.direction !== 'in' && e.direction !== 'out') return null;
  if (typeof e.outcome !== 'string' || !(LOG_OUTCOMES as readonly string[]).includes(e.outcome)) return null;
  if (typeof e.at !== 'number' || !Number.isSafeInteger(e.at) || e.at <= 0) return null;
  const entry: DmCallLogEntry = {
    peer: e.peer.toLowerCase(),
    direction: e.direction,
    outcome: e.outcome as DmCallLogOutcome,
    at: e.at,
  };
  if (e.durationSec !== undefined) {
    if (typeof e.durationSec !== 'number' || !Number.isSafeInteger(e.durationSec) || e.durationSec < 0) return null;
    entry.durationSec = e.durationSec;
  }
  return entry;
}

/** Read this identity's call log (oldest first). Invalid pubkey / corrupt
 *  slot -> []. Never throws. */
export function loadDmCallLog(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): DmCallLogEntry[] {
  const key = dmCallLogSlot(pubkey);
  if (!key || !storage) return [];
  const file = readJson(key, storage);
  if (!file || file.version !== DM_CALL_STORE_VERSION || !Array.isArray(file.entries)) return [];
  const entries: DmCallLogEntry[] = [];
  for (const item of file.entries) {
    const entry = sanitizeDmCallLogEntry(item);
    if (entry) entries.push(entry);
  }
  return entries.slice(-DM_CALL_LOG_LIMIT);
}

/** Append one call-log entry (bounded, newest win). Invalid pubkey or entry
 *  -> no-op. Returns the appended entry or null. */
export function appendDmCallLog(
  pubkey: unknown,
  value: unknown,
  storage: DmStorageLike | null = defaultStorage(),
): DmCallLogEntry | null {
  const key = dmCallLogSlot(pubkey);
  const entry = sanitizeDmCallLogEntry(value);
  if (!key || !entry || !storage) return null;
  const entries = [...loadDmCallLog(pubkey, storage), entry].slice(-DM_CALL_LOG_LIMIT);
  try {
    storage.setItem(key, JSON.stringify({ version: DM_CALL_STORE_VERSION, entries }));
  } catch {
    /* storage unavailable: nothing persisted */
  }
  notify(pubkey);
  return entry;
}

// ─── Seen wrap ids (call-layer dedupe) ──────────────────────────────────────

const WRAP_ID_HEX = /^[0-9a-f]{64}$/i;

/** Load the persisted inbound wrap-id set. */
export function loadDmCallSeen(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): string[] {
  const key = dmCallSeenSlot(pubkey);
  if (!key || !storage) return [];
  const file = readJson(key, storage);
  if (!file || file.version !== DM_CALL_STORE_VERSION || !Array.isArray(file.ids)) return [];
  const out: string[] = [];
  for (const id of file.ids) {
    if (typeof id === 'string' && WRAP_ID_HEX.test(id)) out.push(id.toLowerCase());
    if (out.length >= DM_CALL_SEEN_LIMIT) break;
  }
  return out;
}

/** Persist the inbound wrap-id set (bounded, newest win). Returns the set's
 *  accepted view. Invalid pubkey -> the empty set is echoed back. */
export function saveDmCallSeen(
  pubkey: unknown,
  ids: readonly string[],
  storage: DmStorageLike | null = defaultStorage(),
): string[] {
  const key = dmCallSeenSlot(pubkey);
  const clean: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && WRAP_ID_HEX.test(id) && !clean.includes(id.toLowerCase())) clean.push(id.toLowerCase());
  }
  const bounded = clean.slice(-DM_CALL_SEEN_LIMIT);
  if (!key || !storage) return bounded;
  try {
    storage.setItem(key, JSON.stringify({ version: DM_CALL_STORE_VERSION, ids: bounded }));
  } catch {
    /* storage unavailable: nothing persisted */
  }
  return bounded;
}

// ─── Snapshot + subscriptions (useSyncExternalStore) ────────────────────────

function defaultStorage(): DmStorageLike | null {
  try {
    return (globalThis as { localStorage?: DmStorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function dmCallStorage(): DmStorageLike | null {
  return defaultStorage();
}

type DmCallStoreListener = (pubkey: string) => void;
const listeners = new Set<DmCallStoreListener>();
const snapshotCache = new Map<string, DmCallStoreSnapshot>();

/** Subscribe to local call-store writes (writers notify their own UI; the
 *  localStorage `storage` event never fires in the writing tab). */
export function onDmCallStoreChange(listener: DmCallStoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable snapshot of policy + blocks + log for the identity (cached;
 *  invalidated by every write). */
export function dmCallSnapshot(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): DmCallStoreSnapshot {
  const key = slot(pubkey, DM_CALL_POLICY_BASE);
  if (!key) return EMPTY_DM_CALL_SNAPSHOT;
  let snapshot = snapshotCache.get(key);
  if (!snapshot) {
    snapshot = {
      policy: loadDmCallPolicy(pubkey, storage),
      blocks: loadDmCallBlocks(pubkey, storage),
      log: loadDmCallLog(pubkey, storage),
    };
    snapshotCache.set(key, snapshot);
  }
  return snapshot;
}

function notify(pubkey: unknown): void {
  const key = slot(pubkey, DM_CALL_POLICY_BASE);
  if (!key) return;
  snapshotCache.delete(key);
  const pk = key.slice(DM_CALL_POLICY_BASE.length + 1);
  for (const listener of listeners) {
    try {
      listener(pk);
    } catch {
      /* a broken listener must never break a store write */
    }
  }
}
