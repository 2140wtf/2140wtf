import { useCallback, useEffect, useRef, useState } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { deriveBaoCashuMnemonic } from '@/lib/cashu/cashu';
import { secureStorage } from '@/lib/secureStorage';

const seedStorageKey = (pubkey: string) => `2140_bao_seed_${pubkey}`;
const SEED_OP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    // Attach handlers directly to the underlying promise so the timeout branch
    // never leaves the original rejection unhandled if the timer fires first.
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

export interface UseBaoCashuSeedResult {
  seedPhrase: string | undefined;
  loading: boolean;
  error: string | null;
  available: boolean;
  /** True if the seed was generated for the first time this session. */
  isNew: boolean;
  retry: () => void;
  regenerate: () => void;
}

/**
 * Generate or load the deterministic BAO Cashu seed phrase for the current user.
 *
 * The seed is derived from the user's main Cashu seed via HKDF, then encrypted
 * with NIP-44 to the user's own pubkey and stored in secure storage. On native
 * builds this uses the iOS Keychain / Android Keystore; on web it falls back to
 * localStorage. This gives every device that knows the main seed the same BAO
 * wallet, while keeping the BAO seed encrypted at rest.
 */
export function useBaoCashuSeed(userSeedPhrase: string | undefined): UseBaoCashuSeedResult {
  const { user } = useCurrentUser();
  const [seedPhrase, setSeedPhrase] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const retryRef = useRef(retryToken);
  retryRef.current = retryToken;

  const retry = useCallback(() => setRetryToken((t) => t + 1), []);
  const regenerate = useCallback(async () => {
    const pubkey = user?.pubkey;
    if (pubkey) {
      try {
        await secureStorage.removeItem(seedStorageKey(pubkey));
      } catch {
        // ignore storage errors
      }
    }
    setRetryToken((t) => t + 1);
  }, [user?.pubkey]);

  useEffect(() => {
    const pubkey = user?.pubkey;
    const nip44 = user?.signer?.nip44;

    if (!pubkey || !nip44 || !userSeedPhrase) {
      setSeedPhrase(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const currentToken = retryRef.current;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const key = seedStorageKey(pubkey);
        const ciphertext = await withTimeout(
          secureStorage.getItem(key),
          SEED_OP_TIMEOUT_MS,
          'Load ₿AO seed',
        );

        if (ciphertext) {
          const decrypted = await withTimeout(
            nip44.decrypt(pubkey, ciphertext),
            SEED_OP_TIMEOUT_MS,
            'Decrypt ₿AO seed',
          );
          if (!cancelled && currentToken === retryRef.current) {
            setSeedPhrase(decrypted);
            setIsNew(false);
          }
        } else {
          const mnemonic = deriveBaoCashuMnemonic(userSeedPhrase);
          const encrypted = await withTimeout(
            nip44.encrypt(pubkey, mnemonic),
            SEED_OP_TIMEOUT_MS,
            'Encrypt ₿AO seed',
          );
          await withTimeout(
            secureStorage.setItem(key, encrypted),
            SEED_OP_TIMEOUT_MS,
            'Save ₿AO seed',
          );
          if (!cancelled && currentToken === retryRef.current) {
            setSeedPhrase(mnemonic);
            setIsNew(true);
          }
        }
      } catch (err: unknown) {
        if (!cancelled && currentToken === retryRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load or create ₿AO seed');
          setSeedPhrase(undefined);
          setIsNew(false);
        }
      } finally {
        if (!cancelled && currentToken === retryRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.pubkey, user?.signer?.nip44, userSeedPhrase, retryToken]);

  return {
    seedPhrase,
    loading,
    error,
    available: !!seedPhrase,
    isNew,
    retry,
    regenerate,
  };
}
