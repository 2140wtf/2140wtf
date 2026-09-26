/**
 * At-rest encryption for the local BAO wallet's browser storage.
 *
 * The wallet persists its proofs (bearer funds), recovery seed and in-flight
 * journal to `localStorage`; storing them as clear text let any same-origin
 * script (or XSS) read the money directly (CodeQL
 * `js/clear-text-storage-of-sensitive-data`). This module seals the JSON with
 * XChaCha20-Poly1305 under a per-install 256-bit key before it is written.
 *
 * Scope and honest limits:
 *  - The key is generated on first use and kept in the same browser store, so
 *    this is protection at rest (casual disk/profile inspection, accidental
 *    logging, backup scraping), NOT against a live XSS in the same origin.
 *  - The stronger, login-bound design is the app's own NIP-44 wallet
 *    (`src/lib/cashu/*`); this ported wallet is anonymous, so a device key is
 *    the only key available without changing its sign-in requirements.
 *  - A stored value without the `bfw1.` prefix is legacy clear text: it is
 *    returned as-is and re-sealed on the next write, so upgrades migrate
 *    without losing funds. A prefixed value that fails authentication returns
 *    null — callers fail closed rather than silently emptying the wallet.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { bytesToBase64, base64ToBytes } from '../lib/cashu/base64';

/** Per-install data-encryption key (hex/base64 of 32 random bytes). */
const WALLET_DEK_STORAGE = 'bao-fund-wallet-dek';
/** Version prefix so legacy clear text is distinguishable from sealed blobs. */
const BLOB_PREFIX = 'bfw1.';
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

function getOrCreateWalletDek(): Uint8Array {
  try {
    const stored = localStorage.getItem(WALLET_DEK_STORAGE);
    if (stored) {
      const dek = base64ToBytes(stored);
      if (dek.length === KEY_BYTES) return dek;
    }
    const fresh = randomBytes(KEY_BYTES);
    localStorage.setItem(WALLET_DEK_STORAGE, bytesToBase64(fresh));
    return fresh;
  } catch {
    // Storage unavailable (private mode / quota): use an ephemeral key. The
    // write below will also fail, so nothing is persisted in clear text.
    return randomBytes(KEY_BYTES);
  }
}

/** True when `stored` is a sealed wallet blob (not legacy clear text). */
export function isEncryptedWalletState(stored: string): boolean {
  return stored.startsWith(BLOB_PREFIX);
}

/** Seal a wallet JSON string. Returns a `bfw1.<base64(nonce‖ciphertext)>` blob. */
export function encryptWalletState(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(getOrCreateWalletDek(), nonce).encrypt(
    new TextEncoder().encode(plaintext),
  );
  const sealed = new Uint8Array(nonce.length + ciphertext.length);
  sealed.set(nonce, 0);
  sealed.set(ciphertext, nonce.length);
  return BLOB_PREFIX + bytesToBase64(sealed);
}

/**
 * Open a stored wallet value. Legacy clear text is returned unchanged (and
 * should be re-sealed on write). A sealed blob that cannot be authenticated
 * returns null so callers can fail closed.
 */
export function decryptWalletState(stored: string): string | null {
  if (!isEncryptedWalletState(stored)) return stored;
  try {
    const sealed = base64ToBytes(stored.slice(BLOB_PREFIX.length));
    if (sealed.length <= NONCE_BYTES) return null;
    const nonce = sealed.slice(0, NONCE_BYTES);
    const ciphertext = sealed.slice(NONCE_BYTES);
    return new TextDecoder().decode(xchacha20poly1305(getOrCreateWalletDek(), nonce).decrypt(ciphertext));
  } catch {
    return null;
  }
}
