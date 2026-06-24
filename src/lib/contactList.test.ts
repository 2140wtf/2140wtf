import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent, NPool } from '@nostrify/nostrify';
import { fetchContactList } from './contactList';
import type { NIndexedDB } from '@nostrify/indexeddb';

function makeContactList(createdAt: number, pubkeys: string[]): NostrEvent {
  return {
    id: `id-${createdAt}`,
    pubkey: 'author-pubkey',
    kind: 3,
    created_at: createdAt,
    tags: pubkeys.map((pk) => ['p', pk]),
    content: '',
    sig: 'sig',
  };
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

describe('fetchContactList', () => {
  it('returns the relay event when it is newer than the cache', async () => {
    const cached = makeContactList(1000, ['aaa']);
    const relay = makeContactList(2000, ['bbb']);
    const store = mockStore(cached);
    const nostr = mockNostr([relay]);

    const result = await fetchContactList(nostr, store, 'author-pubkey');
    expect(result).toEqual(relay);
  });

  it('returns the cached event when it is newer than the relay event', async () => {
    const cached = makeContactList(2000, ['aaa']);
    const relay = makeContactList(1000, ['bbb']);
    const store = mockStore(cached);
    const nostr = mockNostr([relay]);

    const result = await fetchContactList(nostr, store, 'author-pubkey');
    expect(result).toEqual(cached);
  });

  it('falls back to the cached event on relay error', async () => {
    const cached = makeContactList(2000, ['aaa']);
    const store = mockStore(cached);
    const nostr = {
      query: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as NPool;

    const result = await fetchContactList(nostr, store, 'author-pubkey');
    expect(result).toEqual(cached);
  });

  it('returns the newest relay event when multiple relays respond', async () => {
    const older = makeContactList(1000, ['aaa']);
    const newer = makeContactList(2000, ['bbb']);
    const store = mockStore(null);
    const nostr = mockNostr([older, newer]);

    const result = await fetchContactList(nostr, store, 'author-pubkey');
    expect(result).toEqual(newer);
  });

  it('returns null when neither relays nor cache have an event', async () => {
    const store = mockStore(null);
    const nostr = mockNostr([]);

    const result = await fetchContactList(nostr, store, 'author-pubkey');
    expect(result).toBeNull();
  });
});
