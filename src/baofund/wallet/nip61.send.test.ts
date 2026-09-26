import { describe, it, expect, beforeEach, vi } from 'vitest';
import { finalizeEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getEncodedToken } from 'cashu-ts3';

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
    const res = await sendNutzap({ recipientPubkey: RECIPIENT, token: TOKEN, mint: MINT, signer, relays: ['wss://relay.bao.network'] });
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
});
