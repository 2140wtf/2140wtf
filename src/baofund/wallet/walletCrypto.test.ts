import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptWalletState, encryptWalletState, isEncryptedWalletState } from './walletCrypto';


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

  // (Migration case removed in the 2140 vendored copy: the current fund
  // implementation re-seals on the next wallet WRITE, not during hydration,
  // and the fund repo's wallet-write suite covers the seal. The no-loss read
  // contract is pinned by the test above.)

});
