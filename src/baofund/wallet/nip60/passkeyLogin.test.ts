// src/wallet/nip60/passkeyLogin.test.ts
import { describe, expect, it } from 'vitest';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { createNip44IdentitySigner } from 'bao-signer/client';

const PRIV = hexToBytes('1'.repeat(64));
const PUB = getPublicKey(PRIV);

describe('createNip44IdentitySigner (spec-compliant, from bao-signer)', () => {
  it('produces an identity with pubkey + nsec', () => {
    const id = createNip44IdentitySigner(PRIV);
    expect(id.pubkey).toBe(PUB);
    expect(id.nsec.startsWith('nsec1')).toBe(true);
  });
  it('NIP-44 round-trips with the signer.nip44 surface', async () => {
    const a = createNip44IdentitySigner(PRIV);
    const bPriv = hexToBytes('2'.repeat(64));
    const b = createNip44IdentitySigner(bPriv);
    const cipher = await a.signer.nip44.encrypt(b.pubkey, 'wallet-config-secret');
    expect(cipher).toBeTruthy();
    const plain = await b.signer.nip44.decrypt(a.pubkey, cipher);
    expect(plain).toBe('wallet-config-secret');
  });
  it('signs events with the identity key', async () => {
    const id = createNip44IdentitySigner(PRIV);
    const ev = await id.signer.signEvent({ kind: 17375, content: 'x', tags: [], created_at: 1 });
    expect(ev.pubkey).toBe(PUB);
  });
});
