// src/baofund/auth/useAuth.tsx
//
// Adapter that exposes the BAO Fund chat stack's `useAuth()` contract on top
// of 2140wtf's Nostrify login (`useCurrentUser` + `useLoginActions`).
//
// The ported chat code (ChatPanel, ChatContext) was written against bao_fund_it's
// own AuthProvider. Rather than fork a second sign-in system into this app, this
// hook projects the signed-in Nostrify user into the shape the chat expects:
//   - `signer` is a `BaoSigner` (signEvent) over the active Nostrify signer,
//   - `pubkey` / `status` mirror the login state,
//   - `logout` delegates to the app's login actions.
//
// `seedIdentityHex` returns null: 2140wtf's nsec login does not hand the raw
// seed to this layer, so the chat's per-room member identity falls back to the
// device-scoped random key (`source: 'stored'`) instead of a seed-derived one.

import { useCallback, useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { bytesToHex } from '@noble/hashes/utils.js';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useUserSeckey } from '@/hooks/useUserSeckey';
import {
  createIdentityNip60Signer,
  type Nip60Signer,
} from '@/baofund/cashu-wallet/lib/cashu/cashuNip60';

import type { BaoSigner } from '../relay/guestIdentity';

export type AuthMethod = 'nip07' | 'passkey' | 'nip46' | 'seed' | null;

export interface BaoAuthCtx {
  status: 'loading' | 'signed-out' | 'ready';
  method: AuthMethod;
  pubkey: string | null;
  /** Signer for the current identity - null when signed out. */
  signer: BaoSigner | null;
  /** Full NIP-60 signer (pubkey + NIP-44 encrypt/decrypt + signEvent) for the
   *  portable wallet. Derived from the Nostrify signer when it supports NIP-44. */
  nip60Signer: Nip60Signer | null;
  /** Raw identity secrets for the wallet-backup file; none available here
   *  (2140wtf's login never exposes the nsec to this layer). */
  identitySecrets: () => { nsec: string | null; seedPhrase: string | null };
  /** Hex identity privkey for seed logins; null here (see file header). */
  seedIdentityHex: () => string | null;
  logout: () => void;
}

export function useAuth(): BaoAuthCtx {
  const { user } = useCurrentUser();
  const { logout: nostrifyLogout } = useLoginActions();

  const signer = useMemo<BaoSigner | null>(() => {
    if (!user) return null;
    return {
      signEvent: (event) => user.signer.signEvent(event),
    };
  }, [user]);

  const nip60Signer = useMemo<Nip60Signer | null>(() => {
    if (!user) return null;
    try {
      // Nostrify's signer is shape-compatible with the NIP-60 signer contract
      // (signEvent + optional nip44); createIdentityNip60Signer returns nulls
      // for methods without NIP-44, which the wallet surfaces honestly.
      return createIdentityNip60Signer({
        pubkey: user.pubkey,
        signer: user.signer as unknown as Parameters<typeof createIdentityNip60Signer>[0]['signer'],
      });
    } catch {
      return null;
    }
  }, [user]);

  const identitySecrets = useCallback(
    (): { nsec: string | null; seedPhrase: string | null } => ({ nsec: null, seedPhrase: null }),
    [],
  );

  // The nsec login key IS the identity key, so the deterministic testnet-rail
  // derivation and the court settlement can use it directly. Extension/bunker
  // logins cannot expose a key and return null (the rail cards then offer the
  // created/imported wallet path).
  const seckey = useUserSeckey();
  const seedIdentityHex = useCallback(
    (): string | null => (seckey ? bytesToHex(seckey) : null),
    [seckey],
  );

  const logout = useCallback((): void => {
    void nostrifyLogout();
  }, [nostrifyLogout]);

  return {
    status: user ? 'ready' : 'signed-out',
    method: null,
    pubkey: user?.pubkey ?? null,
    signer,
    nip60Signer,
    identitySecrets,
    seedIdentityHex,
    logout,
  };
}
