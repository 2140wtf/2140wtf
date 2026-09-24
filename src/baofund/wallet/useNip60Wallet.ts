// src/wallet/useNip60Wallet.ts
//
// Portable mainnet Cashu wallet hook: seed (or NIP-07) login → the user's
// own relays (kind:10002) → NIP-60 restore (incl. adopting a wallet the
// identity already uses in 2140 / bao.markets) → proofs merged into the
// same local wallet the app UI shows → publishes config + token events back
// to the user's relays so the wallet follows the user across apps/devices.

import { useCallback, useEffect, useRef, useState } from 'react';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { claimNutzaps as runClaimLoop, type ParsedNutzap } from './nip61';
import {
  createSeedIdentitySigner,
  deriveFreshWalletKey,
  deriveIdentityPrivkey,
  newSeedPhrase,
  pubkeyOf,
  type Nip60Signer,
} from './nip60/identity';
import { passkeyLogin, passkeyAvailable } from './nip60/passkeyLogin';
import { fetchProfileRelays } from './nip60/relays';
import {
  clearNip60IdentityState,
  makeSyncApi,
  publishAllTokenEvents,
  publishWalletConfig,
  restoreWalletForIdentity,
  type Nip60SyncApi,
} from './nip60/sync';
import {
  listStoredMints,
  loadStoredWallet,
  mergeStoredProofs,
  onStoreChange,
  receiveIntoStoredWallet,
  switchStoredMint,
  totalStoredBalance,
} from './cashuWallet';
import { parseMine } from './nip61';
import { errorMessage } from '../lib/errors';

export type Nip60Status = 'off' | 'loading' | 'ready' | 'error';

export interface Nip60WalletState {
  status: Nip60Status;
  error: string | null;
  identityPubkey: string | null;
  relays: string[];
  mints: string[];
  activeMint: string | null;
  walletPubkey: string | null;
  adopted: boolean;
  proofCount: number;
  balanceSats: number;
  lastSyncAt: number | null;
  seed: string | null;
}

// Identity-scoped wallet spend keys. A single global slot let a NEW identity
// adopt the PREVIOUS identity's NIP-60 wallet (same wallet pubkey, mutually
// recoverable/spendable token events) when the wallet hook's own logout had
// not run. `useAuth.logout` removes the same per-pubkey key.
const WALLET_KEY_PREFIX = 'baofund:nip60:walletkey:';
const walletKeyFor = (identityPubkey: string): string => `${WALLET_KEY_PREFIX}${identityPubkey.toLowerCase()}`;

function persistWalletKey(identityPubkey: string, hex: string): void {
  try {
    localStorage.setItem(walletKeyFor(identityPubkey), hex);
  } catch {
    /* privacy-safe fallback: key exists only for this session */
  }
}
function loadWalletKeyHex(identityPubkey: string): string | null {
  try {
    return localStorage.getItem(walletKeyFor(identityPubkey));
  } catch {
    return null;
  }
}
function clearWalletKey(identityPubkey: string | null): void {
  if (!identityPubkey) return;
  try {
    localStorage.removeItem(walletKeyFor(identityPubkey));
  } catch {
    /* noop */
  }
}

/** Parse a validated 64-hex privkey; null when absent or malformed. */
function parseHexPrivkey(hex: string | null | undefined): Uint8Array | null {
  return hex && /^[0-9a-f]{64}$/.test(hex) ? hexToBytes(hex) : null;
}

export function useNip60Wallet() {
  const [state, setState] = useState<Nip60WalletState>({
    status: 'off',
    error: null,
    identityPubkey: null,
    relays: [],
    mints: [],
    activeMint: null,
    walletPubkey: null,
    adopted: false,
    proofCount: 0,
    balanceSats: 0,
    lastSyncAt: null,
    seed: null,
  });
  const apiRef = useRef<Nip60SyncApi | null>(null);
  const walletSignerRef = useRef<Nip60Signer | null>(null);
  const identityPrivkeyRef = useRef<Uint8Array | null>(null);
  /** Wallet spend key (hex) - needed to swap P2PK-locked nutzap proofs. */
  const walletPrivkeyRef = useRef<string | null>(null);
  const identitySignerRef = useRef<Nip60Signer | null>(null);
  // Pubkey tracked in a REF (set synchronously) - refresh() must never read
  // it from React state: attachIdentity calls refresh before the state
  // update lands, which silently no-op'd the whole bind (the #9 bug).
  const identityPubkeyRef = useRef<string | null>(null);

  const patch = useCallback((p: Partial<Nip60WalletState>) => {
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  const syncFromStored = useCallback(() => {
    const stored = loadStoredWallet();
    const summaries = listStoredMints();
    patch({
      proofCount: summaries.reduce((acc, m) => acc + m.proofCount, 0),
      balanceSats: totalStoredBalance(),
      mints: summaries.map((m) => m.mintUrl),
      activeMint: stored.mintUrl,
    });
  }, [patch]);

  const publishCurrent = useCallback(async (api: Nip60SyncApi, walletSigner: Nip60Signer) => {
    const stored = loadStoredWallet();
    // Publish EVERY mint's proofs, not just the active one: NIP-60 restore
    // on another device must see the whole multi-mint wallet.
    const byMint: Record<string, unknown[]> = {};
    for (const [mintUrl, bucket] of Object.entries(stored.mints)) {
      if (bucket.proofs.length > 0) byMint[mintUrl] = bucket.proofs;
    }
    await publishAllTokenEvents(api, walletSigner, byMint);
    patch({ lastSyncAt: Date.now() });
  }, [patch]);

  /**
   * Shared restore core: resolve relays → sync api → NIP-60 restore (known /
   * adopted / fresh key) → merge into the local app wallet. Used verbatim by
   * loginWithSeed and refresh.
   */
  const restoreAndMerge = useCallback(
    async (identitySigner: Nip60Signer) => {
      const identityPubkey = identityPubkeyRef.current;
      if (!identityPubkey) throw new Error('Identity not attached');
      const relays = await fetchProfileRelays(identityPubkey);
      const api = makeSyncApi(identitySigner, relays);
      apiRef.current = api;

      // Wallet key: previously persisted (this app), a foreign published
      // one (adopted), or a fresh derived key. The fresh key is unavailable
      // for authenticator-bound identities - restoreCrossApp then decides.
      const knownKey = parseHexPrivkey(loadWalletKeyHex(identityPubkey));
      const freshKey = identityPrivkeyRef.current
        ? deriveFreshWalletKey(identityPrivkeyRef.current)
        : null;
      const { restored, walletSigner, walletPrivkey } = await restoreWalletForIdentity(
        identitySigner,
        api,
        (knownKey ?? freshKey) as Uint8Array,
      );
      walletSignerRef.current = walletSigner;
      // Stash the raw spend key so the NIP-61 loop can sign P2PK swaps.
      walletPrivkeyRef.current = walletPrivkey
        ? Array.from(walletPrivkey).map((b) => b.toString(16).padStart(2, '0')).join('')
        : null;

      // Merge restored proofs into the local app wallet through the Stored
      // Wallet's serialized queue. The single-mint store guard lives inside
      // mergeStoredProofs: existing local proofs pin the active mint
      // (switching to a relay-config-led mint would orphan every local proof
      // - they live only in this browser); fresh devices adopt the restored
      // config's first mint. Union is deduped by secret (local wins).
      const ordered: Record<string, unknown[]> = {};
      for (const mint of restored.mints) ordered[mint] = restored.proofsByMint[mint] ?? [];
      const { activeMint } = await mergeStoredProofs(ordered, restored.mints[0]);

      return { relays, api, restored, walletSigner, walletPrivkey, fallbackMintUrl: activeMint };
    },
    [],
  );

  /** Refresh: re-resolve relays and restore again (picks up other devices). */
  const refresh = useCallback(async () => {
    const identitySigner = identitySignerRef.current;
    if (!identityPubkeyRef.current || !identitySigner) return;
    patch({ status: 'loading', error: null });
    try {
      const { relays, api, walletSigner } = await restoreAndMerge(identitySigner);
      await publishCurrent(api, walletSigner);
      patch({
        status: 'ready',
        relays,
        walletPubkey: walletSigner.pubkey,
      });
      syncFromStored();
    } catch (err) {
      patch({ status: 'error', error: errorMessage(err) });
    }
  }, [patch, publishCurrent, syncFromStored, restoreAndMerge]);

  /**
   * Select the active mint for the whole wallet (the internal Cashu wallet
   * and this portable view share one multi-mint store). Adds the mint when
   * new; a public https URL is required.
   */
  const setActiveMint = useCallback(
    async (mintUrl: string) => {
      patch({ error: null });
      try {
        await switchStoredMint(mintUrl);
        syncFromStored();
      } catch (err) {
        patch({ status: 'error', error: errorMessage(err) });
      }
    },
    [patch, syncFromStored],
  );

  /** The current NIP-60 wallet spend key (hex), when the wallet is bound. */
  const getWalletKeyHex = useCallback((): string | null => walletPrivkeyRef.current, []);

  /**
   * Import a wallet spend key from an encrypted backup file: persist it for
   * THIS identity and re-run the NIP-60 restore so the relay-published
   * proofs follow the restored key. Returns false when no identity is bound
   * or the key is malformed (the file layer verified it already).
   */
  const applyImportedWalletKey = useCallback(
    async (walletKeyHex: string): Promise<boolean> => {
      const pubkey = identityPubkeyRef.current;
      if (!pubkey || typeof walletKeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(walletKeyHex)) return false;
      persistWalletKey(pubkey, walletKeyHex.toLowerCase());
      await refresh();
      return true;
    },
    [refresh],
  );

  /**
   * Bind the wallet to an EXTERNAL identity (e.g. the global auth signer).
   * The wallet syncs and publishes NIP-60 events under THAT pubkey, so the
   * wallet follows the authenticated user - never a second, different key.
   */
  const attachIdentity = useCallback(
    async (
      signer: Nip60Signer,
      identityPubkey: string,
      identityPrivkeyHex?: string | null,
    ) => {
      identitySignerRef.current = signer;
      identityPubkeyRef.current = identityPubkey;
      identityPrivkeyRef.current = parseHexPrivkey(identityPrivkeyHex);
      patch({ identityPubkey });
      await refresh();
    },
    [patch, refresh],
  );

  /** Login with a seed phrase → identity key → user relays → NIP-60 sync. */
  const loginWithSeed = useCallback(
    async (phrase?: string) => {
      const seed = (phrase ?? newSeedPhrase()).trim();
      if (!seed) return;
      patch({ status: 'loading', error: null });
      try {
        identityPrivkeyRef.current = deriveIdentityPrivkey(seed);
        const identitySigner = createSeedIdentitySigner(seed);
        const identityPubkey = identitySigner.pubkey;
        identityPubkeyRef.current = identityPubkey;

        const { relays, api, restored, walletSigner, walletPrivkey, fallbackMintUrl } =
          await restoreAndMerge(identitySigner);
        persistWalletKey(identityPubkey, bytesToHex(walletPrivkey));

        // Publish config (identity) + token events (wallet) so it travels.
        // The config's mint list is the full multi-mint store after merge.
        const configMints = listStoredMints().map((m) => m.mintUrl);
        await publishWalletConfig(api, [
          {
            id: 'default',
            privkey: bytesToHex(walletPrivkey),
            mints: configMints.length ? configMints : [fallbackMintUrl],
          },
        ]);
        await publishCurrent(api, walletSigner);

        patch({
          status: 'ready',
          identityPubkey,
          relays,
          walletPubkey: walletSigner.pubkey,
          adopted: restored.adoptedWalletPubkey === walletSigner.pubkey,
          seed,
        });
        syncFromStored();
      } catch (err) {
        patch({ status: 'error', error: errorMessage(err) });
      }
    },
    [patch, publishCurrent, syncFromStored, restoreAndMerge],
  );

  /** Passkey login (WebAuthn PRF → deterministic Nostr identity). */
  const loginWithPasskey = useCallback(async () => {
    patch({ status: 'loading', error: null });
    try {
      const identity = await passkeyLogin();
      identitySignerRef.current = identity.signer;
      identityPubkeyRef.current = identity.pubkey;
      identityPrivkeyRef.current = null; // key lives in the authenticator
      patch({ identityPubkey: identity.pubkey, seed: null });
    } catch (err) {
      patch({ status: 'error', error: errorMessage(err) });
      return;
    }
    // refresh() picks up from identityPubkey + identitySignerRef.
    await refresh();
  }, [patch, refresh]);

  /** Scan the user's relays for incoming NIP-61 nutzaps addressed to us. */
  /** Scan for incoming nutzaps. `null` when the RELAY QUERY FAILED - the
   *  caller must not render that as "no nutzaps" (it disables Claim and
   *  hides real funds). An empty array means "reached the relay, none". */
  const scanNutzaps = useCallback(async (): Promise<ParsedNutzap[] | null> => {
    const api = apiRef.current;
    const walletSigner = walletSignerRef.current;
    if (!api?.queryRelays || !walletSigner) return null;
    try {
      const events = await api.queryRelays(api.relays, {
        kinds: [9321],
        '#p': [walletSigner.pubkey],
        limit: 100,
      });
      // Parse via the real vendored parser and keep only events actually
      // addressed to our wallet key (the #p filter is a hint, not a proof).
      return events
        .map((ev) => parseMine(ev, walletSigner.pubkey))
        .filter((p): p is ParsedNutzap => p !== null);
    } catch {
      return null;
    }
  }, []);

  /**
   * Full NIP-61 claim loop: scan → swap at mint → merge into the local
   * wallet → mark claimed. Idempotent across runs; P2PK-locked proofs are
   * signed with the wallet spend key when we hold it.
   */
  const claimNutzaps = useCallback(async (): Promise<{ claimed: number; sats: number; skippedOtherMint: number; failures: string[] }> => {
    const api = apiRef.current;
    const walletSigner = walletSignerRef.current;
    if (!api || !walletSigner) throw new Error('Wallet not ready');
    const stored = loadStoredWallet();
    const res = await runClaimLoop({
      query: async () => {
        // The claim loop parses raw events itself - query the relays
        // directly rather than double-parsing through scanNutzaps().
        return api.queryRelays!(api.relays, {
          kinds: [9321],
          '#p': [walletSigner.pubkey],
          limit: 100,
        });
      },
      walletPubkey: walletSigner.pubkey,
      activeMint: stored.mintUrl,
      // Multi-mint: claim nutzaps from every mint this wallet already knows.
      // An unknown mint is skipped (never auto-adopted from an incoming
      // event) and surfaced to the user, who adds it explicitly.
      knownMints: listStoredMints().map((m) => m.mintUrl),
      // Atomic claim: swap + persist run inside the Stored Wallet's
      // serialized queue, so an in-flight spend or another tab can't
      // interleave; the loop's merge step just mirrors the committed state.
      receive: (tokenStr, opts) => receiveIntoStoredWallet(tokenStr, opts).then((r) => r.received),
      mergeProofs: async () => {
        syncFromStored();
      },
      privkeyHex: walletPrivkeyRef.current,
    });
    if (res.claimed > 0) await refresh();
    return { claimed: res.claimed, sats: res.sats, skippedOtherMint: res.skippedOtherMint, failures: res.failures };
  }, [refresh, syncFromStored]);

  const logout = useCallback(() => {
    const pubkey = identityPubkeyRef.current;
    if (pubkey) clearNip60IdentityState(pubkey);
    clearWalletKey(pubkey);
    walletSignerRef.current = null;
    apiRef.current = null;
    identityPrivkeyRef.current = null;
    identitySignerRef.current = null;
    identityPubkeyRef.current = null;
    setState({
      status: 'off',
      error: null,
      identityPubkey: null,
      relays: [],
      mints: [],
      activeMint: null,
      walletPubkey: null,
      adopted: false,
      proofCount: 0,
      balanceSats: totalStoredBalance(),
      lastSyncAt: null,
      seed: null,
    });
  }, []);

  // Keep balance in sync with the local wallet whenever it changes - sends,
  // receives, NIP-60 merges, or a write from another tab - via push
  // notification from the Stored Wallet module (no polling). A committed
  // spend/receive must also be REPUBLISHED (debounced) or the relay keeps a
  // stale pre-spend event that the next restore would resurrect.
  const republishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => onStoreChange(() => {
    syncFromStored();
    if (!apiRef.current || !walletSignerRef.current) return;
    if (republishTimer.current) clearTimeout(republishTimer.current);
    republishTimer.current = setTimeout(() => {
      const api = apiRef.current;
      const signer = walletSignerRef.current;
      if (api && signer) void publishCurrent(api, signer).catch(() => undefined);
    }, 2_000);
  }), [syncFromStored, publishCurrent]);
  useEffect(() => () => {
    if (republishTimer.current) clearTimeout(republishTimer.current);
  }, []);

  return {
    ...state,
    loginWithSeed,
    loginWithPasskey,
    attachIdentity,
    setActiveMint,
    getWalletKeyHex,
    applyImportedWalletKey,
    passkeyAvailable,
    refresh,
    scanNutzaps,
    claimNutzaps,
    logout,
    getRawSeed: () => state.seed,
    isSignedIn: state.status === 'ready',
  };
}

export { pubkeyOf };
