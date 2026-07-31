import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { encodeEventAddress } from './encodeEvent';

const PUBKEY = 'a'.repeat(64);

function fakeEvent(kind: number, tags: string[][] = []): NostrEvent {
  return {
    id: 'b'.repeat(64),
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind,
    tags,
    content: 'hello',
    sig: 'c'.repeat(128),
  };
}

const HINTS = ['wss://relay.one', 'wss://relay.two'];

describe('encodeEventAddress relay hints', () => {
  it('embeds relay hints in a nevent for regular kinds', () => {
    const encoded = encodeEventAddress(fakeEvent(1), HINTS);
    const decoded = nip19.decode(encoded);
    expect(decoded.type).toBe('nevent');
    const data = decoded.data as { id: string; author?: string; relays?: string[] };
    expect(data.id).toBe('b'.repeat(64));
    expect(data.author).toBe(PUBKEY);
    expect(data.relays).toEqual(HINTS);
  });

  it('embeds relay hints in an naddr for addressable kinds', () => {
    const encoded = encodeEventAddress(fakeEvent(30023, [['d', 'my-article']]), HINTS);
    const decoded = nip19.decode(encoded);
    expect(decoded.type).toBe('naddr');
    const data = decoded.data as { identifier: string; relays?: string[] };
    expect(data.identifier).toBe('my-article');
    expect(data.relays).toEqual(HINTS);
  });

  it('omits the relays field when no hints are given', () => {
    const encoded = encodeEventAddress(fakeEvent(1));
    const decoded = nip19.decode(encoded);
    const data = decoded.data as { relays?: string[] };
    expect(data.relays ?? []).toEqual([]);
  });

  it('treats an empty hints array as no hints', () => {
    const encoded = encodeEventAddress(fakeEvent(1), []);
    const decoded = nip19.decode(encoded);
    const data = decoded.data as { relays?: string[] };
    expect(data.relays ?? []).toEqual([]);
  });
});
