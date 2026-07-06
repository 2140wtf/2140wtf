import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent, NPool } from '@nostrify/nostrify';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';

import { fetchFreshEvent } from './fetchFreshEvent';
import type { NIndexedDB } from '@nostrify/indexeddb';

const sk = generateSecretKey();
const PK = getPublicKey(sk);

function makeEvent(createdAt: number, content = ''): NostrEvent {
  return finalizeEvent(
    {
      kind: 10000,
      created_at: createdAt,
      tags: [],
      content,
    },
    sk,
  );
}

function mockStore(event: NostrEvent | null): NIndexedDB {
  return {
    query: vi.fn().mockResolvedValue(event ? [event] : []),
    event: vi.fn().mockResolvedValue(undefined),
  } as unknown as NIndexedDB;
}

function mockNostr(events: NostrEvent[]): NPool {
  return {
    query: vi.fn().mockResolvedValue(events),
  } as unknown as NPool;
}

describe('fetchFreshEvent', () => {
  it('returns the relay event when it is newer than the cache', async () => {
    const cached = makeEvent(1000);
    const relay = makeEvent(2000);
    const store = mockStore(cached);
    const nostr = mockNostr([relay]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] }, { store });
    expect(result).toEqual(relay);
  });

  it('returns the cached event when it is newer than the relay event', async () => {
    const cached = makeEvent(2000);
    const relay = makeEvent(1000);
    const store = mockStore(cached);
    const nostr = mockNostr([relay]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] }, { store });
    expect(result).toEqual(cached);
  });

  it('falls back to the cached event on a relay miss', async () => {
    const cached = makeEvent(2000);
    const store = mockStore(cached);
    const nostr = mockNostr([]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] }, { store });
    expect(result).toEqual(cached);
  });

  it('returns null when neither relays nor cache have an event', async () => {
    const store = mockStore(null);
    const nostr = mockNostr([]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] }, { store });
    expect(result).toBeNull();
  });

  it('returns the newest relay event across multiple responses', async () => {
    const older = makeEvent(1000);
    const newer = makeEvent(2000);
    const _store = mockStore(null);
    const nostr = mockNostr([older, newer]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] });
    expect(result).toEqual(newer);
  });

  it('ignores the store when no store option is provided', async () => {
    const cached = makeEvent(2000);
    const _store = mockStore(cached);
    const nostr = mockNostr([]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] });
    expect(result).toBeNull();
    expect(_store.query).not.toHaveBeenCalled();
  });

  it('uses the cache as a floor so mutations never build from an empty baseline', async () => {
    // Simulate a relay hiccup: relay returns nothing, but cache has the list.
    const cached = makeEvent(1500, 'existing-mutes');
    const store = mockStore(cached);
    const nostr = mockNostr([]);

    const result = await fetchFreshEvent(nostr, { kinds: [10000], authors: [PK] }, { store });
    expect(result).toEqual(cached);
  });
});
