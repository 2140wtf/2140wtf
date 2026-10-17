// dmCallStore: per-identity policy / blocks / log / seen slots. Invalid
// pubkeys touch NOTHING; corrupt slots degrade to defaults; the ADR's policy
// defaults are fail-closed (calls off, nobody may ring).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DM_CALL_POLICY,
  DM_CALL_BLOCK_LIMIT,
  DM_CALL_LOG_LIMIT,
  addDmCallBlock,
  appendDmCallLog,
  dmCallBlocksSlot,
  dmCallLogSlot,
  dmCallPolicySlot,
  dmCallSeenSlot,
  dmCallSnapshot,
  isDmCallBlocked,
  loadDmCallBlocks,
  loadDmCallLog,
  loadDmCallPolicy,
  loadDmCallSeen,
  onDmCallStoreChange,
  removeDmCallBlock,
  saveDmCallPolicy,
  saveDmCallSeen,
  sanitizeDmCallPolicy,
} from './dmCallStore';
import type { DmStorageLike } from './dmStore';

const ME = 'ab'.repeat(32);
const PEER_A = '11'.repeat(32);
const PEER_B = '22'.repeat(32);

function fakeStorage(): DmStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('dmCallStore — policy', () => {
  it('defaults are fail-closed and invalid pubkeys read/write nothing', () => {
    const storage = fakeStorage();
    expect(loadDmCallPolicy(ME, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    expect(loadDmCallPolicy('not-a-pubkey', storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    expect(loadDmCallPolicy(null, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    saveDmCallPolicy('not-a-pubkey', { callsEnabled: true }, storage);
    expect(storage.map.size).toBe(0);
    expect(dmCallPolicySlot('nope')).toBeNull();
    expect(dmCallPolicySlot(ME.toUpperCase())).toBe(`baofund:dmcall:policy:${ME}`);
  });

  it('persists per identity with merged patches', () => {
    const storage = fakeStorage();
    const saved = saveDmCallPolicy(ME, { callsEnabled: true, whoMayRing: 'anyone' }, storage);
    expect(saved.callsEnabled).toBe(true);
    expect(saved.whoMayRing).toBe('anyone');
    expect(saved.missedNotice).toBe(false);
    saveDmCallPolicy(ME, { missedNotice: true }, storage);
    expect(loadDmCallPolicy(ME, storage)).toMatchObject({ callsEnabled: true, missedNotice: true, whoMayRing: 'anyone' });
    // Another identity keeps its own defaults.
    expect(loadDmCallPolicy(PEER_A, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
  });

  it('corrupt / foreign-version / wrong-typed slots degrade to defaults', () => {
    const storage = fakeStorage();
    storage.setItem(`baofund:dmcall:policy:${ME}`, '{not json');
    expect(loadDmCallPolicy(ME, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    storage.setItem(`baofund:dmcall:policy:${ME}`, JSON.stringify({ version: 2, callsEnabled: true }));
    expect(loadDmCallPolicy(ME, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    storage.setItem(`baofund:dmcall:policy:${ME}`, JSON.stringify({ version: 1, callsEnabled: 'yes', missedNotice: false, whoMayRing: 'anyone', updatedAt: 1 }));
    expect(loadDmCallPolicy(ME, storage)).toEqual(DEFAULT_DM_CALL_POLICY);
    expect(sanitizeDmCallPolicy(null)).toBeNull();
    expect(sanitizeDmCallPolicy({ version: 1, callsEnabled: false, missedNotice: false, whoMayRing: 'hostile', updatedAt: 1 })).toBeNull();
    expect(sanitizeDmCallPolicy({ version: 1, callsEnabled: false, missedNotice: false, whoMayRing: 'nobody', updatedAt: -1 })).toBeNull();
  });
});

describe('dmCallStore — blocks', () => {
  it('adds, dedupes, removes; invalid inputs no-op', () => {
    const storage = fakeStorage();
    expect(loadDmCallBlocks(ME, storage)).toEqual([]);
    expect(addDmCallBlock(ME, PEER_A, storage)).toEqual([PEER_A]);
    addDmCallBlock(ME, PEER_A, storage);
    addDmCallBlock(ME, PEER_A.toUpperCase(), storage);
    expect(loadDmCallBlocks(ME, storage)).toEqual([PEER_A]);
    expect(isDmCallBlocked(ME, PEER_A.toUpperCase(), storage)).toBe(true);
    expect(isDmCallBlocked(ME, 'junk', storage)).toBe(false);
    expect(removeDmCallBlock(ME, PEER_A, storage)).toEqual([]);
    addDmCallBlock('junk', PEER_A, storage);
    addDmCallBlock(ME, 'junk', storage);
    expect(loadDmCallBlocks('junk', storage)).toEqual([]);
    expect(dmCallBlocksSlot(null)).toBeNull();
  });

  it('is bounded and drops malformed entries on load', () => {
    const storage = fakeStorage();
    for (let i = 0; i < DM_CALL_BLOCK_LIMIT + 25; i += 1) {
      addDmCallBlock(ME, i.toString(16).padStart(64, '0'), storage);
    }
    expect(loadDmCallBlocks(ME, storage)).toHaveLength(DM_CALL_BLOCK_LIMIT);
    storage.setItem(`baofund:dmcall:blocks:${ME}`, JSON.stringify({ version: 1, hex: ['junk', PEER_A, PEER_A], updatedAt: 1 }));
    expect(loadDmCallBlocks(ME, storage)).toEqual([PEER_A]);
  });
});

describe('dmCallStore — call log', () => {
  it('appends validated, bounded entries and survives corruption', () => {
    const storage = fakeStorage();
    expect(appendDmCallLog(ME, { peer: PEER_A, direction: 'out', outcome: 'missed', at: 100 }, storage)).toEqual({
      peer: PEER_A,
      direction: 'out',
      outcome: 'missed',
      at: 100,
    });
    appendDmCallLog(ME, { peer: PEER_B, direction: 'in', outcome: 'answered', at: 200, durationSec: 42 }, storage);
    expect(loadDmCallLog(ME, storage)).toHaveLength(2);
    // Malformed entries are refused, never persisted.
    expect(appendDmCallLog(ME, { peer: 'junk', direction: 'in', outcome: 'missed', at: 1 }, storage)).toBeNull();
    expect(appendDmCallLog(ME, { peer: PEER_A, direction: 'sideways', outcome: 'missed', at: 1 }, storage)).toBeNull();
    expect(appendDmCallLog(ME, { peer: PEER_A, direction: 'in', outcome: 'exploded', at: 1 }, storage)).toBeNull();
    expect(appendDmCallLog(ME, { peer: PEER_A, direction: 'in', outcome: 'missed', at: 0 }, storage)).toBeNull();
    expect(appendDmCallLog(ME, { peer: PEER_A, direction: 'in', outcome: 'answered', at: 1, durationSec: -1 }, storage)).toBeNull();
    expect(dmCallLogSlot(ME)).toBe(`baofund:dmcall:log:${ME}`);
    for (let i = 0; i < DM_CALL_LOG_LIMIT + 10; i += 1) {
      appendDmCallLog(ME, { peer: PEER_A, direction: 'in', outcome: 'missed', at: 1_000 + i }, storage);
    }
    expect(loadDmCallLog(ME, storage)).toHaveLength(DM_CALL_LOG_LIMIT);
    storage.setItem(`baofund:dmcall:log:${ME}`, '{oops');
    expect(loadDmCallLog(ME, storage)).toEqual([]);
  });
});

describe('dmCallStore — seen wrap ids', () => {
  it('persists a bounded dedupe set; malformed ids are dropped', () => {
    const storage = fakeStorage();
    const idA = 'cd'.repeat(32);
    const idB = 'ef'.repeat(32);
    saveDmCallSeen(ME, [idA, idB, 'junk', idA], storage);
    expect(loadDmCallSeen(ME, storage)).toEqual([idA, idB]);
    expect(dmCallSeenSlot(ME)).toBe(`baofund:dmcall:seen:${ME}`);
    const many = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(64, '0'));
    saveDmCallSeen(ME, many, storage);
    expect(loadDmCallSeen(ME, storage)).toHaveLength(200);
    expect(loadDmCallSeen(ME, storage).at(-1)).toBe(many.at(-1));
    storage.setItem(`baofund:dmcall:seen:${ME}`, JSON.stringify({ version: 1, ids: 'nope' }));
    expect(loadDmCallSeen(ME, storage)).toEqual([]);
  });
});

describe('dmCallStore — snapshots + notifications', () => {
  it('notifies subscribers per identity and returns fresh snapshots', () => {
    const storage = fakeStorage();
    const changed: string[] = [];
    const off = onDmCallStoreChange((pk) => changed.push(pk));
    const before = dmCallSnapshot(ME, storage);
    expect(before.policy.callsEnabled).toBe(false);
    saveDmCallPolicy(ME, { callsEnabled: true }, storage);
    const after = dmCallSnapshot(ME, storage);
    expect(after).not.toBe(before);
    expect(after.policy.callsEnabled).toBe(true);
    expect(changed).toEqual([ME]);
    // Stable between writes.
    expect(dmCallSnapshot(ME, storage)).toBe(after);
    off();
    saveDmCallPolicy(ME, { callsEnabled: false }, storage);
    expect(changed).toEqual([ME]);
  });
});
