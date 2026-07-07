import type { NLoginType } from '@nostrify/react/login';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrSigner } from '@nostrify/types';
import { nip19 } from 'nostr-tools';

/**
 * Encrypted login-blob storage adapter for @nostrify/react's NostrLoginProvider.
 *
 * The JSON login array (which contains nsec / clientNsec secrets) is encrypted
 * with NIP-44 self-encryption before being written to the underlying backend.
 * This protects the secrets at rest on web builds where the backend falls back
 * to plaintext localStorage.
 *
 * Because the encryption key is itself one of the logins being encrypted, cold
 * starts cannot decrypt an existing encrypted blob without help. To preserve
 * the happy-path login experience across reloads, the plaintext blob is also
 * cached in sessionStorage for the lifetime of the tab. Closing the tab clears
 * the cache and the user must authenticate again.
 *
 * Plaintext values written by earlier app versions are detected on read,
 * encrypted, rewritten, and returned so the migration is transparent.
 */

const STORAGE_VERSION = 1;
const SESSION_CACHE_PREFIX = 'nostr:login-session:';

interface EncryptedLoginBlob {
  v: number;
  /** Public key (hex) used to encrypt the blob. */
  pubkey: string;
  /** NIP-44 ciphertext of the JSON login array. */
  ciphertext: string;
}

/**
 * Minimal storage interface expected by @nostrify/react's NostrLoginProvider.
 */
interface NLoginStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

/** Underlying backend interface. Matches NLoginStorage plus removeItem. */
interface StorageBackend {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

function isPlaintextLogins(raw: string): boolean {
  return raw.trimStart().startsWith('[');
}

function getEncryptableSecret(logins: NLoginType[]): string | undefined {
  for (const login of logins) {
    if (login.type === 'nsec') return login.data.nsec;
    if (login.type === 'bunker') return login.data.clientNsec;
  }
  return undefined;
}

async function signerFromSecret(secret: string): Promise<NSecSigner | undefined> {
  try {
    const decoded = nip19.decode(secret);
    if (decoded.type !== 'nsec') return undefined;
    return new NSecSigner(decoded.data);
  } catch {
    return undefined;
  }
}

async function signerForLogins(logins: NLoginType[]): Promise<NostrSigner | undefined> {
  const secret = getEncryptableSecret(logins);
  if (!secret) return undefined;
  return signerFromSecret(secret);
}

async function encryptLogins(logins: NLoginType[], signer: NostrSigner): Promise<string> {
  const pubkey = await signer.getPublicKey();
  const plaintext = JSON.stringify(logins);
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 encryption');
  }
  const ciphertext = await signer.nip44.encrypt(pubkey, plaintext);
  const wrapper: EncryptedLoginBlob = { v: STORAGE_VERSION, pubkey, ciphertext };
  return JSON.stringify(wrapper);
}

async function decryptLogins(raw: string, signer: NostrSigner): Promise<NLoginType[]> {
  const wrapper: EncryptedLoginBlob = JSON.parse(raw);
  if (wrapper.v !== STORAGE_VERSION) {
    throw new Error(`Unsupported encrypted login version: ${wrapper.v}`);
  }
  if (!signer.nip44) {
    throw new Error('Signer does not support NIP-44 decryption');
  }
  const pubkey = await signer.getPublicKey();
  const plaintext = await signer.nip44.decrypt(pubkey, wrapper.ciphertext);
  return JSON.parse(plaintext) as NLoginType[];
}

function sessionCacheKey(storageKey: string): string {
  return `${SESSION_CACHE_PREFIX}${storageKey}`;
}

function readSessionCache(storageKey: string): string | null {
  try {
    return sessionStorage.getItem(sessionCacheKey(storageKey));
  } catch {
    return null;
  }
}

function writeSessionCache(storageKey: string, value: string): void {
  try {
    sessionStorage.setItem(sessionCacheKey(storageKey), value);
  } catch {
    // Ignore sessionStorage failures (e.g., private mode).
  }
}

export interface CreateEncryptedLoginStorageOptions {
  /**
   * Optional signer source. When provided, decryption on load uses this signer
   * instead of relying on the tab session cache. The callback may be async.
   */
  getSigner?: () => NostrSigner | undefined | Promise<NostrSigner | undefined>;
}

/**
 * Wrap a storage backend so that the persisted login blob is encrypted with
 * NIP-44 self-encryption.
 *
 * @param backend Storage backend implementing getItem/setItem/removeItem.
 * @param options Optional signer source for explicit decryption.
 */
export function createEncryptedLoginStorage(
  backend: StorageBackend,
  options: CreateEncryptedLoginStorageOptions = {},
): NLoginStorage {
  const { getSigner } = options;

  return {
    async getItem(key: string): Promise<string | null> {
      const raw = await Promise.resolve(backend.getItem(key));
      if (!raw) return null;

      // Legacy plaintext login blob: migrate transparently.
      if (isPlaintextLogins(raw)) {
        try {
          const logins: NLoginType[] = JSON.parse(raw);
          let signer = await getSigner?.();
          if (!signer) {
            signer = await signerForLogins(logins);
          }
          if (signer) {
            const encrypted = await encryptLogins(logins, signer);
            await Promise.resolve(backend.setItem(key, encrypted));
            writeSessionCache(key, raw);
          }
        } catch (error) {
          console.warn('Failed to migrate plaintext login storage:', error);
        }
        return raw;
      }

      // Encrypted blob: try the explicit signer first, then fall back to the
      // tab session cache. If neither is available, return an empty login list
      // so the user is prompted to authenticate again.
      try {
        const signer = await getSigner?.();
        if (signer) {
          const logins = await decryptLogins(raw, signer);
          const plaintext = JSON.stringify(logins);
          writeSessionCache(key, plaintext);
          return plaintext;
        }
      } catch (error) {
        console.warn('Failed to decrypt login storage with explicit signer:', error);
      }

      const cached = readSessionCache(key);
      if (cached) return cached;

      return '[]';
    },

    async setItem(key: string, value: string): Promise<void> {
      try {
        const logins: NLoginType[] = JSON.parse(value);
        let signer = await getSigner?.();
        if (!signer) {
          signer = await signerForLogins(logins);
        }
        if (signer) {
          const encrypted = await encryptLogins(logins, signer);
          await Promise.resolve(backend.setItem(key, encrypted));
          writeSessionCache(key, value);
          return;
        }
      } catch (error) {
        console.warn('Failed to encrypt login storage:', error);
      }

      // Fallback for extension-only logins or encryption failures: write
      // plaintext so the app remains usable. This is no worse than the legacy
      // behavior on web.
      await Promise.resolve(backend.setItem(key, value));
      writeSessionCache(key, value);
    },
  };
}
