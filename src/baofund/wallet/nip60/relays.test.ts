// src/wallet/nip60/relays.test.ts

import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_RELAYS, fetchProfileRelays } from './relays';

/**
 * Fake SimplePool: returns canned events for the queried kind. Because
 * fetchers ignore pool internals, we only assert the STORY: kind:10002
 * relays win, kind:3 is a fallback, BAO relay is always appended.
 */
function fakePool(results: Partial<Record<number, unknown[]>>) {
  return {
    querySync: async (_relays: string[], filter: { kinds?: number[] }) => {
      const kind = filter.kinds?.[0] ?? -1;
      return (results[kind] ?? []) as never;
    },
  } as never;
}

function eventWithRelays(tags: string[][]) {
  return { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 10002, tags, content: '' };
}
const PUB = 'c'.repeat(64);

describe('fetchProfileRelays', () => {
  it('uses kind:10002 relay tags when present', async () => {
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: fakePool({
        10002: [eventWithRelays([['r', 'wss://user.example.com'], ['r', 'wss://relay.damus.io']])],
      }),
    });
    expect(relays).toContain('wss://user.example.com');
    expect(relays).toContain('wss://relay.bao.network'); // fallback appended
  });
  it('falls back to kind:3 when no kind:10002 relay list exists', async () => {
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: fakePool({
        3: [eventWithRelays([['r', 'wss://legacy.example.com']])],
      }),
    });
    expect(relays).toContain('wss://legacy.example.com');
  });
  it('normalizes and dedupes, dropping non-wss entries', async () => {
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: fakePool({
        10002: [
          eventWithRelays([
            ['r', 'https://relay.damus.io'],
            ['r', 'wss://relay.damus.io/'],
            ['r', 'ftp://nope'],
            ['r', 'wss://relay.damus.io'],
          ]),
        ],
      }),
    });
    expect(relays.filter((r) => r === 'wss://relay.damus.io')).toHaveLength(1);
    expect(relays.some((r) => r.startsWith('http'))).toBe(false);
    expect(relays.some((r) => r.startsWith('ftp'))).toBe(false);
  });
  it('use BOOTSTRAP_RELAYS plus BAO relay when the profile has none', async () => {
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: fakePool({}),
    });
    expect(relays).toContain('wss://relay.bao.network');
  });
  it('permanently-dead relays are not in the bootstrap set', () => {
    // nostr.band shut down (2025); keeping it made every wallet restore pay
    // its connection timeout in console noise. Regression guard.
    for (const relay of BOOTSTRAP_RELAYS) expect(relay).not.toContain('nostr.band');
  });
  it('a hung relay query resolves within the deadline and still returns the fallback set', async () => {
    // querySync never settles (dead relay half-open socket) - the per-query
    // deadline must cut it off, not leave restoreAndMerge awaiting forever.
    const hangPool = {
      querySync: () => new Promise(() => {}),
    } as never;
    const t0 = Date.now();
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: hangPool,
      timeoutMs: 250,
    });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(relays).toContain('wss://relay.bao.network');
  });
  it('timeouts don not hang: returns fallback set on relay errors', async () => {
    const boomPool = {
      querySync: async () => {
        throw new Error('relay down');
      },
    } as never;
    const relays = await fetchProfileRelays(PUB, { bootstrap: ['wss://relay.bao.network'], pool: boomPool });
    expect(relays).toContain('wss://relay.bao.network');
  });
});

describe('fetchProfileRelays relay disagreement', () => {
  it('uses the NEWEST kind:10002 event, not whichever relay answered first', async () => {
    const stale = {
      id: '1'.repeat(64), pubkey: PUB, kind: 10002, created_at: 100,
      tags: [['r', 'wss://stale.example.com']], content: '',
    };
    const fresh = {
      id: '2'.repeat(64), pubkey: PUB, kind: 10002, created_at: 200,
      tags: [['r', 'wss://fresh.example.com']], content: '',
    };
    const relays = await fetchProfileRelays(PUB, {
      bootstrap: ['wss://relay.bao.network'],
      pool: fakePool({ 10002: [stale, fresh] }),
    });
    expect(relays).toContain('wss://fresh.example.com');
    expect(relays).not.toContain('wss://stale.example.com');
  });
});
