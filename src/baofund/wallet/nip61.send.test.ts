import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { Amount, deriveKeysetId, getEncodedToken } from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1.js';

// Partial mock: keep real crypto (finalizeEvent), stub the relay pool.
const publishImpl = vi.fn((): Promise<void>[] => [Promise.resolve()]);
const closeImpl = vi.fn();
vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    SimplePool: class {
      publish = publishImpl;
      close = closeImpl;
    },
  };
});

import { sendNutzap } from './nip61';

const SK = '1111111111111111111111111111111111111111111111111111111111111111';
const RECIPIENT = 'aa'.repeat(32);
const MINT = 'https://mint.example';
const PROOFS = [{ id: '00aa', amount: 1000, secret: 's1', C: 'c1' }];
const TOKEN = getEncodedToken({ mint: MINT, proofs: PROOFS as never, unit: 'sat' });

/**
 * A NUT-02 v2 keyset: 66-hex id (version byte 01) whose tokens carry the
 * 16-char SHORT form. cashu-ts 4.x cannot decode one without the full id, so
 * this is the exact shape that used to fail the nutzap send path.
 */
function v2Keyset(): { keys: Record<string, string>; id: string } {
  const keys: Record<string, string> = {};
  let slot = 1n;
  for (let a = 1; a <= 1024; a *= 2, slot += 1n) {
    keys[String(a)] = secp256k1.Point.BASE.multiply(slot).toHex(true);
  }
  return { keys, id: deriveKeysetId(keys, { unit: 'sat' }) };
}
const V2_KEYSET = v2Keyset();
const V2_SHORT = V2_KEYSET.id.slice(0, 16);
const V2_TOKEN = getEncodedToken({
  mint: MINT,
  proofs: [{ id: V2_SHORT, amount: Amount.from(1000), secret: 's2', C: 'c2' }],
  unit: 'sat',
});

const signer = {
  signEvent: async (t: { kind: number; created_at: number; tags: string[][]; content: string }) =>
    finalizeEvent(t, hexToBytes(SK)) as never,
};

describe('sendNutzap', () => {
  beforeEach(() => {
    publishImpl.mockClear().mockImplementation((): Promise<void>[] => [Promise.resolve()]);
    closeImpl.mockClear();
  });

  it('publishes a verified kind:9321 nutzap pinned to the recipient', async () => {
    const res = await sendNutzap({
      recipientPubkey: RECIPIENT,
      token: TOKEN,
      mint: MINT,
      signer,
      relays: ['wss://relay.bao.network'],
      // v0/v1 tokens decode without keysets: this fetch must never run.
      fetchKeysetIds: async () => { throw new Error('should not fetch keysets for a v0/v1 token'); },
    });
    expect(res.publishedTo).toEqual(['wss://relay.bao.network']);
    const call = publishImpl.mock.calls[0] as unknown as [string[], import('nostr-tools').NostrEvent];
    const ev = call[1];
    expect(ev.kind).toBe(9321);
    expect(ev.tags).toContainEqual(['p', RECIPIENT]);
    expect(ev.tags).toContainEqual(['u', MINT]);
    expect(ev.tags.some((t: string[]) => t[0] === 'proof')).toBe(true);
    // signature verifies against the sender key
    const { verifyEvent } = await import('nostr-tools');
    expect(verifyEvent(ev)).toBe(true);
  });

  it('rejects non-hex recipients and non-wss relays', async () => {
    await expect(sendNutzap({ recipientPubkey: 'nothex', token: TOKEN, mint: MINT, signer, relays: ['wss://r'] })).rejects.toThrow(/64-char/);
    await expect(sendNutzap({ recipientPubkey: RECIPIENT, token: TOKEN, mint: MINT, signer, relays: ['http://insecure'] })).rejects.toThrow(/wss/);
    expect(publishImpl).not.toHaveBeenCalled();
  });

  it('throws when NO relay accepts (caller falls back to manual delivery)', async () => {
    publishImpl.mockImplementation((): Promise<void>[] => [Promise.reject(new Error('closed'))]);
    await expect(sendNutzap({ recipientPubkey: RECIPIENT, token: TOKEN, mint: MINT, signer, relays: ['wss://relay.bao.network'] }))
      .rejects.toThrow(/No relay accepted/);
  });

  it('decodes a v2-keyed token with the mint keyset ids and publishes the FULL ids', async () => {
    const res = await sendNutzap({
      recipientPubkey: RECIPIENT,
      token: V2_TOKEN,
      mint: MINT,
      signer,
      relays: ['wss://relay.bao.network'],
      fetchKeysetIds: async (mintUrl) => {
        expect(mintUrl).toBe(MINT);
        return [V2_KEYSET.id];
      },
    });
    expect(res.publishedTo).toEqual(['wss://relay.bao.network']);
    const ev = (publishImpl.mock.calls[0] as unknown as [string[], import('nostr-tools').NostrEvent])[1];
    expect(ev.kind).toBe(9321);
    const proofTag = ev.tags.find((t: string[]) => t[0] === 'proof');
    expect(proofTag).toBeTruthy();
    // The short v2 id in the token was mapped to the mint's full keyset id.
    expect((JSON.parse(proofTag![1]!) as { id: string }).id).toBe(V2_KEYSET.id);
  });

  it('fails closed on a v2 token when the mint keyset fetch fails (nothing published)', async () => {
    await expect(sendNutzap({
      recipientPubkey: RECIPIENT,
      token: V2_TOKEN,
      mint: MINT,
      signer,
      relays: ['wss://relay.bao.network'],
      fetchKeysetIds: async () => { throw new Error('mint offline'); },
    })).rejects.toThrow(/mint offline/);
    expect(publishImpl).not.toHaveBeenCalled();
  });

  it('fails closed on a v2 token when the mint reports no keysets', async () => {
    await expect(sendNutzap({
      recipientPubkey: RECIPIENT,
      token: V2_TOKEN,
      mint: MINT,
      signer,
      relays: ['wss://relay.bao.network'],
      fetchKeysetIds: async () => [],
    })).rejects.toThrow(/No keyset ids/);
    expect(publishImpl).not.toHaveBeenCalled();
  });
});
