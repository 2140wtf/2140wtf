import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const PET_CASHU_INFO_PREFIX = '2140pets:cashu:';

export function derivePetCashuMnemonic(userSeedPhrase: string, petD: string): string {
  const userEntropy = mnemonicToEntropy(userSeedPhrase.trim(), wordlist);
  const derivedEntropy = hkdf(sha256, userEntropy, new Uint8Array(0), new TextEncoder().encode(`${PET_CASHU_INFO_PREFIX}${petD}`), 16);
  return entropyToMnemonic(derivedEntropy, wordlist);
}

export function petCashuStorageNamespace(petD: string): string {
  return `pets:cashu:${petD}`;
}

export function petCashuBackupDTag(petD: string): string {
  return `freedomid:cashu:pet:${petD}`;
}
