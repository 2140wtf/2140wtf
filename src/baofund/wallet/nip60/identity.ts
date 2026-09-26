// src/wallet/nip60/identity.ts
//
// Identity for the portable wallet: a BIP-39 seed phrase derives the Nostr
// identity key (BAO-namespaced), and a NIP-60 signer wraps it (NIP-44 +
// signing). Logging in with the SAME seed in any app yields the same
// identity pubkey → the same kind:10002 relays + NIP-60 wallet config →
// the same balance across apps and devices.
//
// NIP-60 parity note: the vendored @/baofund/cashu-wallet/lib/cashu/index keeps the original
// derivation info-strings (e.g. 'ditto:cashu:walletkey:v1') INTENTIONALLY -
// changing them would derive different keys than existing 2140/bao.markets
// wallets and break cross-app wallet recovery. The package is MIT (BAO).

import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createNip60Signer, type Nip60Signer, type Nip60EventTemplate } from '@/baofund/cashu-wallet/lib/cashu/index';

export type { Nip60Signer };
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { Event as NostrEvent } from 'nostr-tools/pure';

const IDENTITY_INFO = 'baofund:identity:v1';

/** Derive the 32-byte identity private key from a BIP-39 seed phrase. */
export function deriveIdentityPrivkey(seedPhrase: string): Uint8Array {
  const trimmed = seedPhrase.trim().toLowerCase();
  if (!validateMnemonic(trimmed, wordlist)) throw new Error('Invalid BIP-39 seed phrase');
  const seed = mnemonicToSeedSync(trimmed);
  const digest = sha256(new Uint8Array([...new TextEncoder().encode(IDENTITY_INFO), ...seed]));
  return digest;
}

/** NIP-60 signer (identity role) from a seed phrase - full wallet sync. */
export function createSeedIdentitySigner(seedPhrase: string): Nip60Signer {
  return createNip60Signer(deriveIdentityPrivkey(seedPhrase));
}

export function newSeedPhrase(bits: 128 | 256 = 256): string {
  // Strong entropy by default: 24 words / 256 bits. A 12-word (128-bit)
  // mnemonic is below the 256-bit floor we want for on-chain Nostr nsecs;
  // the seed phrase is the single point of failure for wallet recovery -
  // weak entropy would let an offline attacker brute-force it.
  return generateMnemonic(wordlist, bits);
}

/** Minimal NostrSigner adapter over window.nostr (NIP-07). */
export interface BrowserNostr {
  getPublicKey: () => Promise<string>;
  signEvent: (event: Nip60EventTemplate) => Promise<NostrEvent>;
  nip44?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
}

export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { nostr?: unknown }).nostr);
}

/**
 * NIP-60 identity signer for a browser-extension (NIP-07) login. Wallet
 * token sync still requires the seed phrase (decrypting the published wallet
 * config needs NIP-44, which only some extensions expose) - NIP-07 gives
 * identity + relays; seed gives the full wallet.
 */
export function createNip07IdentitySigner(nostr: BrowserNostr): Nip60Signer {
  return {
    pubkey: '',
    nip44Encrypt: async (pubkey, plaintext) => {
      if (!nostr.nip44) return null;
      try {
        return await nostr.nip44.encrypt(pubkey, plaintext);
      } catch {
        return null;
      }
    },
    nip44Decrypt: async (pubkey, ciphertext) => {
      if (!nostr.nip44) return null;
      try {
        return await nostr.nip44.decrypt(pubkey, ciphertext);
      } catch {
        return null;
      }
    },
    signEvent: async (template) => {
      try {
        return await nostr.signEvent(template);
      } catch {
        return null;
      }
    },
  };
}

export async function nip07Pubkey(nostr: BrowserNostr): Promise<string> {
  const pubkey = await nostr.getPublicKey();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('NIP-07 returned an invalid pubkey');
  return pubkey;
}

/** Deterministic wallet key (fresh BAO wallets) from the identity key. */
export function deriveFreshWalletKey(identityPrivkey: Uint8Array): Uint8Array {
  return sha256(new Uint8Array([...new TextEncoder().encode('baofund:walletkey:v1'), ...identityPrivkey]));
}

export function pubkeyOf(privkey: Uint8Array): string {
  return getPublicKey(privkey);
}

export { bytesToHex, hexToBytes, finalizeEvent, getPublicKey };
export type { Nip60EventTemplate };
