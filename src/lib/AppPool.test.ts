import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/types';
import type { NPool, NStore } from '@nostrify/nostrify';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

import { AppPool } from './AppPool';

const sk = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const _pubkey = getPublicKey(sk);

function createValidEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return finalizeEvent(
    {
      kind: 1,
      created_at: 1000,
      tags: [],
      content: 'hello',
      ...overrides,
    },
    sk,
  );
}

function _createEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  const event = createValidEvent(overrides);
  return {
    ...event,
    ...overrides,
  };
}

function createInvalidEvent(validEvent: NostrEvent): NostrEvent {
  const clone = JSON.parse(JSON.stringify(validEvent)) as NostrEvent;
  clone.sig = clone.sig.slice(0, -1) + (clone.sig.slice(-1) === '0' ? '1' : '0');
  return clone;
}

function createMockPool(events: NostrEvent[]): NPool {
  return {
    query: vi.fn().mockResolvedValue(events),
    event: vi.fn().mockResolvedValue(undefined),
    req: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield ['EVENT', 'sub', event] as unknown as import('@nostrify/types').NostrRelayEVENT;
      }
    }),
    relay: vi.fn(),
    group: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as NPool;
}

function createMockStore(): NStore {
  return {
    query: vi.fn().mockResolvedValue([]),
    event: vi.fn().mockResolvedValue(undefined),
    req: vi.fn().mockImplementation(async function* () {}),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as NStore;
}

describe('AppPool verification', () => {
  it('drops unverified events from query results before caching', async () => {
    const validEvent = createValidEvent();
    const invalidEvent = createInvalidEvent(validEvent);
    const pool = createMockPool([validEvent, invalidEvent]);
    const store = createMockStore();
    const app = new AppPool(pool, store);

    const result = await app.query([{ kinds: [1], limit: 10 }]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(validEvent.id);
  });

  it('does not cache unverified events from event()', async () => {
    const validEvent = createValidEvent();
    const invalidEvent = createInvalidEvent(validEvent);
    const pool = createMockPool([]);
    const store = createMockStore();
    const app = new AppPool(pool, store);
    app.setLoggedInPubkeys([invalidEvent.pubkey]);

    await app.event(invalidEvent);

    expect(pool.event).toHaveBeenCalledWith(invalidEvent, undefined);
    expect(store.event).not.toHaveBeenCalled();
  });

  it('does not cache unverified events from req()', async () => {
    const validEvent = createValidEvent();
    const invalidEvent = createInvalidEvent(validEvent);
    const pool = createMockPool([validEvent, invalidEvent]);
    const store = createMockStore();
    const app = new AppPool(pool, store);
    app.setLoggedInPubkeys([validEvent.pubkey]);

    const messages: unknown[] = [];
    for await (const msg of app.req([{ kinds: [1], limit: 10 }])) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(store.event).toHaveBeenCalledTimes(1);
    expect(store.event).toHaveBeenCalledWith(validEvent);
  });
});
