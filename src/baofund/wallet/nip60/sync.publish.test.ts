// src/wallet/nip60/sync.publish.test.ts
//
// NIP-60 stale-relay resurrection defense: a mint that drops to ZERO must get
// a superseding empty token event (tombstone). The per-identity published-mint
// set that drives the tombstone must survive a failed publish - dropping it on
// a transient relay error means no later run ever retries, and the pre-spend
// event stays on the relay to resurrect spent proofs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishAllTokenEvents, type Nip60Signer, type Nip60SyncApi } from './sync';

const IDENTITY = 'a'.repeat(64);
const publishedMintsKey = (pubkey: string): string =>
  `bao-fund:nip60:publishedMints:${pubkey.toLowerCase()}`;

function makeWalletSigner(pubkey = IDENTITY): Nip60Signer {
  return {
    pubkey,
    nip44Encrypt: vi.fn(async (_pk: string, plaintext: string) => plaintext),
    nip44Decrypt: vi.fn(async (_pk: string, ciphertext: string) => ciphertext),
    signEvent: vi.fn(async (t: { kind: number; created_at: number; tags: string[][]; content: string }) => ({
      ...t,
      id: 'e'.repeat(64),
      pubkey,
      sig: '0'.repeat(128),
    })),
  } as unknown as Nip60Signer;
}

function makeApi(walletSigner: Nip60Signer): Nip60SyncApi {
  return {
    signer: walletSigner,
    relays: ['wss://relay.example'],
    publish: vi.fn(async () => null),
    query: vi.fn(async () => []),
    queryRelays: vi.fn(async () => []),
    publishToRelays: vi.fn(async () => null),
  } as unknown as Nip60SyncApi;
}

describe('publishAllTokenEvents - zero-mint tombstones', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a zero mint queued for the tombstone retry when the relay rejects the publish', async () => {
    localStorage.setItem(publishedMintsKey(IDENTITY), JSON.stringify(['https://signet.example.com']));
    const walletSigner = makeWalletSigner();
    const api = makeApi(walletSigner);

    const published = await publishAllTokenEvents(api, walletSigner, {
      'https://mint.example.com': [{ secret: 's1', amount: 5 }],
    });

    expect(published).toBe(0);
    const tracked = JSON.parse(localStorage.getItem(publishedMintsKey(IDENTITY)) ?? '[]') as string[];
    // The funded mint stays tracked AND the mint whose tombstone failed must
    // remain so the next republish retries the supersede.
    expect(tracked).toContain('https://mint.example.com');
    expect(tracked).toContain('https://signet.example.com');
  });

  it('drops the zero mint once its tombstone is accepted', async () => {
    localStorage.setItem(publishedMintsKey(IDENTITY), JSON.stringify(['https://signet.example.com']));
    const walletSigner = makeWalletSigner();
    const api = makeApi(walletSigner);
    (api.publish as ReturnType<typeof vi.fn>).mockResolvedValue('e'.repeat(64));

    const published = await publishAllTokenEvents(api, walletSigner, {
      'https://mint.example.com': [{ secret: 's1', amount: 5 }],
    });

    expect(published).toBe(2);
    const tracked = JSON.parse(localStorage.getItem(publishedMintsKey(IDENTITY)) ?? '[]') as string[];
    expect(tracked).toEqual(['https://mint.example.com']);
  });
});
