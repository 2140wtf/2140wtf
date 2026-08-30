import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNip05Cache,
  deleteNip05Cached,
  getNip05Cached,
  getNip05FailureCached,
  NIP05_FAILURE_TTL,
  setNip05Cached,
  setNip05FailureCached,
} from './nip05Cache';

const ID = 'user@example.com';
const OTHER_ID = 'other@example.com';
const PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

describe('nip05Cache negative results', () => {
  beforeEach(async () => {
    await clearNip05Cache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('distinguishes "never looked up" from "known-failed recently"', async () => {
    expect(getNip05FailureCached(ID)).toBeUndefined();
    await setNip05FailureCached(ID);
    expect(getNip05FailureCached(ID)?.failedAt).toBeTypeOf('number');
  });

  it('keeps entries independent per identifier', async () => {
    await setNip05FailureCached(ID);
    expect(getNip05FailureCached(OTHER_ID)).toBeUndefined();
  });

  it('preserves a previous positive result when a failure is recorded', async () => {
    await setNip05Cached(ID, PUBKEY);
    await setNip05FailureCached(ID);
    // A transient failure must not evict the known-good pubkey.
    expect(getNip05Cached(ID)?.pubkey).toBe(PUBKEY);
    expect(getNip05FailureCached(ID)).toBeDefined();
  });

  it('clears the negative entry when a lookup later succeeds', async () => {
    await setNip05FailureCached(ID);
    await setNip05Cached(ID, PUBKEY);
    expect(getNip05FailureCached(ID)).toBeUndefined();
    expect(getNip05Cached(ID)?.pubkey).toBe(PUBKEY);
  });

  it('deleteNip05Cached removes both the positive and negative entry', async () => {
    await setNip05Cached(ID, PUBKEY);
    await setNip05FailureCached(ID);
    await deleteNip05Cached(ID);
    expect(getNip05Cached(ID)).toBeUndefined();
    expect(getNip05FailureCached(ID)).toBeUndefined();
  });

  it('expires failures after the 15-minute TTL (retry allowed again)', async () => {
    // Only Date is faked: fake-indexeddb schedules its internal work on real
    // timers, and the cache's TTL logic reads Date.now() — so mocking the full
    // timer set hangs the IndexedDB write, while faking just Date keeps the
    // DB writes flowing and the TTL math controllable.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const base = new Date('2026-01-01T00:00:00Z').getTime();
      vi.setSystemTime(base);
      await setNip05FailureCached(ID);

      // Just before the TTL → still known-failed.
      vi.setSystemTime(base + NIP05_FAILURE_TTL - 1);
      expect(getNip05FailureCached(ID)).toBeDefined();

      // At/after the TTL → treated as never-failed; callers may refetch.
      vi.setSystemTime(base + NIP05_FAILURE_TTL);
      expect(getNip05FailureCached(ID)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});