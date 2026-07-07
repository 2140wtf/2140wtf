import { vi } from 'vitest';

/**
 * Returns a minimal NIP-44 signer mock for tests.
 *
 * Encryption is a reversible prefix transform (`enc:${plaintext}`) so tests can
 * verify that values are encrypted before persistence while still being able to
 * inspect the original plaintext by stripping the prefix.
 */
export function makeNip44() {
  return {
    encrypt: vi.fn(async (_pubkey: string, plaintext: string) => `enc:${plaintext}`),
    decrypt: vi.fn(async (_pubkey: string, ciphertext: string) => {
      if (!ciphertext.startsWith('enc:')) throw new Error('bad ciphertext');
      return ciphertext.slice(4);
    }),
  };
}
