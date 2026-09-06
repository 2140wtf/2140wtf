import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const PET_CASHU_INFO_PREFIX = '2140pets:cashu:';

export function derivePetCashuMnemonic(userSeedPhrase: string, petD: string): string {
  // Input hygiene + zeroization parity with deriveBaoCashuMnemonic (round 25):
  // explicit empty guard, bounded input, and secret buffers zeroed after use
  // instead of lingering in the heap until GC.
  const trimmed = userSeedPhrase.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid seed phrase');
  }
  if (trimmed.length > 2000) {
    throw new Error('Seed phrase too long');
  }
  const userEntropy = mnemonicToEntropy(trimmed, wordlist);
  try {
    const derivedEntropy = hkdf(
      sha256,
      userEntropy,
      new Uint8Array(0),
      new TextEncoder().encode(`${PET_CASHU_INFO_PREFIX}${petD}`),
      16,
    );
    try {
      return entropyToMnemonic(derivedEntropy, wordlist);
    } finally {
      derivedEntropy.fill(0);
    }
  } finally {
    userEntropy.fill(0);
  }
}

export function petCashuStorageNamespace(petD: string): string {
  return `pets:cashu:${petD}`;
}

export function petCashuBackupDTag(petD: string): string {
  return `freedomid:cashu:pet:${petD}`;
}
