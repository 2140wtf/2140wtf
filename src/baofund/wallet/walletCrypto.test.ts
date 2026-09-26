import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptWalletState, encryptWalletState, isEncryptedWalletState } from './walletCrypto';
import { hydrateStoredWallet, loadStoredWallet } from './cashuWallet';

const STORAGE_KEY = 'bao-fund-wallet';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('walletCrypto: at-rest sealing', () => {
  it('round-trips a wallet payload through XChaCha20-Poly1305', () => {
    const plain = JSON.stringify({ mintUrl: 'https://mint.example.com', proofs: [{ secret: 'abc' }] });
    const sealed = encryptWalletState(plain);
    expect(sealed.startsWith('bfw1.')).toBe(true);
    expect(sealed).not.toContain('abc'); // ciphertext, not clear text
    expect(isEncryptedWalletState(sealed)).toBe(true);
    expect(decryptWalletState(sealed)).toBe(plain);
  });

  it('returns legacy clear text unchanged so upgrades do not lose funds', () => {
    const legacy = JSON.stringify({ mintUrl: 'https://mint.example.com', proofs: [] });
    expect(isEncryptedWalletState(legacy)).toBe(false);
    expect(decryptWalletState(legacy)).toBe(legacy);
  });

  it('fails closed (null) when a sealed blob is tampered with', () => {
    const sealed = encryptWalletState(JSON.stringify({ proofs: [{ secret: 's' }] }));
    // Flip a character in the ciphertext body.
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A');
    expect(decryptWalletState(tampered)).toBeNull();
  });

  it('re-seals a legacy clear-text wallet on boot (migration)', async () => {
    const legacy = JSON.stringify({ mintUrl: 'https://mint.example.com', proofs: [], mints: {} });
    localStorage.setItem(STORAGE_KEY, legacy);
    await hydrateStoredWallet();
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored && isEncryptedWalletState(stored)).toBe(true);
    // Data survives the migration.
    expect(loadStoredWallet().mintUrl).toBe('https://mint.example.com');
  });
});
