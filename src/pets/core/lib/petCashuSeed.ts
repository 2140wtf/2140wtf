import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const PET_CASHU_INFO_PREFIX = '2140pets:cashu:';

/**
 * Derive a pet-specific BIP-39 mnemonic from the user's Cashu seed phrase.
 *
 * Formula: HKDF-SHA256(
 *   ikm = BIP-39 entropy of userSeedPhrase,
 *   salt = empty,
 *   info = "2140pets:cashu:" + petD,
 *   L = 16 bytes
 * ) → entropyToMnemonic → 12-word phrase
 *
 * Each pet gets an independent seed, so a compromise of one pet wallet does
 * not affect the user's main Cashu wallet or other pets.
 */
export function derivePetCashuMnemonic(userSeedPhrase: string, petD: string): string {
  const userEntropy = mnemonicToEntropy(userSeedPhrase.trim(), wordlist);
  const derivedEntropy = hkdf(sha256, userEntropy, new Uint8Array(0), `${PET_CASHU_INFO_PREFIX}${petD}`, 16);
  return entropyToMnemonic(derivedEntropy, wordlist);
}

/**
 * Build the localStorage namespace for a pet Cashu wallet.
 */
export function petCashuStorageNamespace(petD: string): string {
  return `pets:cashu:${petD}`;
}

/**
 * Build the Nostr backup d-tag for a pet Cashu wallet.
 */
export function petCashuBackupDTag(petD: string): string {
  return `freedomid:cashu:pet:${petD}`;
}
