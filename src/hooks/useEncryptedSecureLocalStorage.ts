import { useCallback, useEffect, useRef, useState } from 'react';
import type { NostrSigner } from '@nostrify/types';

import { useSecureLocalStorage } from './useSecureLocalStorage';

/**
 * Hook that stores a JSON-serializable value in secure storage encrypted with
 * NIP-44 self-encryption.
 *
 * This is a thin wrapper around {@link useSecureLocalStorage} that stores an
 * encrypted ciphertext string and transparently decrypts it after reading. It
 * also migrates legacy plaintext values on first read: if the stored value is
 * still plaintext JSON, it is encrypted and rewritten before use.
 *
 * When no signer is available (logged out), the hook behaves like a plain
 * in-memory state: it returns the default value and does not persist writes.
 * Because storage keys are user-scoped, switching accounts automatically
 * re-reads the correct encrypted payload once the new user's signer is ready.
 */
export function useEncryptedSecureLocalStorage<T>(
  key: string,
  defaultValue: T,
  nip44: NostrSigner['nip44'] | undefined,
  pubkey: string,
): readonly [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [stored, setStored] = useSecureLocalStorage<unknown>(key, null);
  const [state, setState] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);

  // Refs for values that are logically stable but may have changing references
  // (e.g., defaultValue created inline, setStored from an un-memoized hook).
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;
  const setStoredRef = useRef(setStored);
  setStoredRef.current = setStored;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (stored === null) {
        if (!cancelled) {
          setState(defaultValueRef.current);
          setReady(true);
        }
        return;
      }

      if (!nip44) {
        if (!cancelled) {
          setState(defaultValueRef.current);
          setReady(true);
        }
        return;
      }

      try {
        let ciphertext: string;

        if (typeof stored === 'string') {
          if (isPlaintextJson(stored)) {
            // Legacy plaintext string: encrypt in place and rewrite storage.
            ciphertext = await nip44.encrypt(pubkey, stored);
            setStoredRef.current(ciphertext);
          } else {
            ciphertext = stored;
          }
        } else {
          // Legacy plaintext object/array left by an unencrypted storage hook.
          const plaintext = JSON.stringify(stored);
          ciphertext = await nip44.encrypt(pubkey, plaintext);
          setStoredRef.current(ciphertext);
        }

        const plaintext = await nip44.decrypt(pubkey, ciphertext);
        const parsed = JSON.parse(plaintext) as T;
        if (!cancelled) {
          setState(parsed);
        }
      } catch (error) {
        console.warn(`Failed to decrypt ${key}:`, error);
        if (!cancelled) {
          setState(defaultValueRef.current);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    setReady(false);
    load();

    return () => {
      cancelled = true;
    };
  }, [stored, nip44, pubkey, key]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = value instanceof Function ? (value as (p: T) => T)(prev) : value;
        if (next === prev) return prev;

        if (nip44) {
          nip44
            .encrypt(pubkey, JSON.stringify(next))
            .then((ciphertext) => {
              setStoredRef.current(ciphertext);
            })
            .catch((error) => {
              console.warn(`Failed to encrypt ${key}:`, error);
            });
        }

        return next;
      });
    },
    [nip44, pubkey, key],
  );

  return [state, setValue, ready] as const;
}

/** Returns true when a stored value looks like legacy plaintext JSON. */
function isPlaintextJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
