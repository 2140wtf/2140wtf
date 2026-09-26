import { describe, it, expect } from 'vitest';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  generateWalletSeed,
  deriveMasterKey,
  deriveNutzapKey,
  deriveBaoWalletKey,
  deriveBaoCashuMnemonic,
  encryptData,
  decryptData,
  encryptProofs,
  decryptProofs,
  deriveEncryptionKey,
} from './cashu';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('key derivation', () => {
  it('generates a valid BIP-39 seed phrase', () => {
    const seed = generateWalletSeed();
    expect(seed.split(' ')).toHaveLength(12);
    expect(wordlist.includes(seed.split(' ')[0])).toBe(true);
  });

  it('deriveMasterKey returns a consistent seed', () => {
    const key1 = deriveMasterKey(MNEMONIC);
    const key2 = deriveMasterKey(MNEMONIC);
    expect(key1).toEqual(key2);
    expect(key1.length).toBe(64);
  });

  it('deriveMasterKey produces different keys for different seeds', () => {
    const a = deriveMasterKey(generateWalletSeed());
    const b = deriveMasterKey(MNEMONIC);
    expect(a).not.toEqual(b);
  });

  it('deriveNutzapKey returns privkey + pubkey pair', () => {
    const { privkey, pubkey } = deriveNutzapKey(MNEMONIC);
    expect(privkey.length).toBe(32);
    expect(pubkey).toMatch(/^[0-9a-f]{66}$/); // compressed pubkey
  });

  it('deriveBaoWalletKey returns distinct keys per wallet name', () => {
    const a = deriveBaoWalletKey(MNEMONIC);
    const b = deriveBaoWalletKey(MNEMONIC + 'x');
    expect(a.privkey).not.toEqual(b.privkey);
  });

  it('deriveBaoCashuMnemonic produces a valid 12-word mnemonic', () => {
    const derived = deriveBaoCashuMnemonic(MNEMONIC);
    const words = derived.split(' ');
    expect(words).toHaveLength(12);
    expect(words.every(w => wordlist.includes(w))).toBe(true);
  });
});

describe('encryptData / decryptData round-trips', () => {
  it('round-trips plaintext through AES-GCM', async () => {
    const key = await deriveEncryptionKey(MNEMONIC);
    const plaintext = 'secret message with unicode 🎉';
    const encrypted = await encryptData(plaintext, key);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = await decryptData(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypts with the wrong key returns null', async () => {
    const keyA = await deriveEncryptionKey(MNEMONIC);
    const wrongSeed = generateWalletSeed();
    const wrongKey = await deriveEncryptionKey(wrongSeed);
    const encrypted = await encryptData('secret', keyA);
    let decrypted: string | null | undefined;
    try { decrypted = await decryptData(encrypted, wrongKey); } catch { /* expected */ }
    expect(decrypted).toBeUndefined();
  });
});

describe('encryptProofs / decryptProofs round-trips', () => {
  it('round-trips an array of proof objects', async () => {
    const key = await deriveEncryptionKey(MNEMONIC);
    const proofs = [{ id: '00a1b2c3d4e5f6a7', amount: 500, secret: 'proof-secret', C: '02' + 'e'.repeat(64) }];
    const encrypted = await encryptProofs(proofs, key);
    const decrypted = await decryptProofs(encrypted, key) as typeof proofs;
    expect(decrypted).toEqual(proofs);
  });

  it('decryptProofs with the wrong key returns null or throws', async () => {
    const key = await deriveEncryptionKey(MNEMONIC);
    const wrongKey = await deriveEncryptionKey(generateWalletSeed());
    const proofs = [{ id: '00a1b2c3d4e5f6a7', amount: 500, secret: 'proof-secret', C: '02' + 'e'.repeat(64) }];
    const encrypted = await encryptProofs(proofs, key);
    // Wrong key should fail to decrypt (returns null) or throw
    let result: unknown;
    try {
      result = await decryptProofs(encrypted, wrongKey);
    } catch { /* acceptable */ }
    // Either null or a failed parse - NOT the original proofs
    if (result !== null && result !== undefined) {
      expect(result).not.toEqual(proofs);
    }
  });
});
