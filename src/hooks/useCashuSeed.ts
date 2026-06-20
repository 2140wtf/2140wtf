import { useCallback, useEffect, useRef, useState } from 'react';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { secureStorage } from '@/lib/secureStorage';

const seedStorageKey = (pubkey: string) => `2140_cashu_seed_${pubkey}`;
const SEED_OP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      });
    }),
  ]);
}

export interface UseCashuSeedResult {
  seedPhrase: string | undefined;
  loading: boolean;
  error: string | null;
  available: boolean;
  retry: () => void;
  regenerate: () => void;
}

export function useCashuSeed(): UseCashuSeedResult {
  const { user } = useCurrentUser();
  const [seedPhrase, setSeedPhrase] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    if (!pubkey || !nip44) {
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
          'Load Cashu seed',
        );

        if (ciphertext) {
          const decrypted = await withTimeout(
            nip44.decrypt(pubkey, ciphertext),
            SEED_OP_TIMEOUT_MS,
            'Decrypt Cashu seed',
          );
          if (!cancelled && currentToken === retryRef.current) setSeedPhrase(decrypted);
        } else {
          const mnemonic = generateMnemonic(wordlist, 128);
          const encrypted = await withTimeout(
            nip44.encrypt(pubkey, mnemonic),
            SEED_OP_TIMEOUT_MS,
            'Encrypt Cashu seed',
          );
          await withTimeout(
            secureStorage.setItem(key, encrypted),
            SEED_OP_TIMEOUT_MS,
            'Save Cashu seed',
          );
          if (!cancelled && currentToken === retryRef.current) setSeedPhrase(mnemonic);
        }
      } catch (err: unknown) {
        if (!cancelled && currentToken === retryRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load or create Cashu seed');
          setSeedPhrase(undefined);
        }
      } finally {
        if (!cancelled && currentToken === retryRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.pubkey, user?.signer?.nip44, retryToken]);

  return {
    seedPhrase,
    loading,
    error,
    available: !!seedPhrase,
    retry,
    regenerate,
  };
}
