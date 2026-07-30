/**
 * Cashu wallet hook
 * Based on satoshi-pay-wallet's useWallet.js, adapted for TypeScript
 * Reference: https://github.com/Codepocketdev/satoshi-pay-wallet
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CashuMint, CashuWallet, getEncodedToken } from '@cashu/cashu-ts';
import { verifyEvent, nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/curves/utils.js';
import { hashToCurve } from '@cashu/cashu-ts/crypto/common';
import type { MintQuoteResponse, MeltQuoteResponse, Bolt12MeltQuoteResponse } from '@cashu/cashu-ts';
import type { NostrEvent } from '@nostrify/nostrify';
import { NRelay1 } from '@nostrify/nostrify';
import {
  deriveMasterKey,
  deriveEncryptionKey,
  deriveLegacyEncryptionKey,
  deriveNip60WalletKey,
  DEFAULT_MINTS,
  decodeCashuToken,
  isAllowedMintUrl,
  normalizeMintUrl,
  safeNormalizeMintUrl,
  normalizeProofWitnessForEncode,
  MAX_PROOF_FIELD_LENGTH,
  MAX_MINT_FEE_PPM,
  isFeeWithinMaxPpm,
  hashDecodedToken,
  validateReceivedProofs,
} from '@/lib/cashu/cashu';
import {
  createCashuStorage,
  type CashuStorage,
  type RecoveryEntry,
  type PendingNutzapEntry,
  type Transaction,
  type StoredMint,
} from '@/lib/cashu/storage';
import { useAppContext } from '@/hooks/useAppContext';
import { devLog } from '@/lib/cashu/devLog';
import { deriveNutzapKey } from '@/lib/cashu/cashu';
import { buildMultisigEscrowLock, type MultisigEscrowLockRequest } from '@/lib/cashu/escrowMultisig';
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  createNip60Signer,
  buildWalletConfigPayload,
  buildWalletConfigEvent,
  buildTokenEvent,
  buildDeletionEvent,
  buildHistoryEvent,
  buildNutzapInfoEvent,
  buildNutzapEvent,
  buildNutzapRedemptionHistoryEvent,
  parseTokenEvent,
  parseNutzapInfoEvent,
  parseNutzapEvent,
  restoreNip60Wallet,
  computeContentHash,
  loadLastWalletConfigHash,
  saveLastWalletConfigHash,
  loadLastNutzapInfoHash,
  saveLastNutzapInfoHash,
  loadLastTokenEventId,
  saveLastTokenEventId,
  loadLastTokenEventHash,
  saveLastTokenEventHash,
  restoreCrossAppNip60Wallet,
  resolveMintAlias,
  WALLET_CONFIG_KIND,
  TOKEN_KIND,
  NUTZAP_INFO_KIND,
  NUTZAP_KIND,
  type Nip60SyncApi,
  type Nip60WalletConfig,
} from '@/lib/cashu/cashuNip60';
/* eslint-enable @typescript-eslint/no-unused-vars */
import { createMintFetch } from '@/lib/cashu/cashuFetch';
import { stringToBase64 } from '@/lib/cashu/base64';
import { type CashuBackupPayload } from '@/lib/cashu/cashuBackup';
import { BAO_MARKETS_RELAY } from '@/lib/baoRelayMarkets';

export interface CashuWalletState {
  wallet: CashuWallet | null;
  mintUrl: string;
  allMints: Array<{ name: string; url: string }>;
  mintInfo: any;
  balances: Record<string, number>;
  totalBalance: number;
  transactions: Transaction[];
  seedPhrase: string;
  isNewWallet: boolean;
  showSeedBackup: boolean;
  loading: boolean;
  error: string;
  success: string;
  backupStatus: 'idle' | 'syncing' | 'synced' | 'failed';
  lastBackupAt: number | null;
  nutzaps: NostrEvent[];
}

/**
 * Result of a nutzap send:
 * - 'sent': the nutzap event was published — payment delivered.
 * - 'pending': the mint swap already committed (the sats left your wallet)
 *   but the nutzap event could not be published; it is saved and auto-retried.
 *   Do NOT retry the payment — it will very likely land.
 * - 'failed': nothing was committed — safe to retry.
 */
export type NutzapSendResult =
  /** Published; carries the Nutzap event id so callers can reference the zap. */
  | { status: 'sent'; eventId: string }
  /** Sats committed but the event is queued for auto-retry; no event id yet. */
  | { status: 'pending' }
  /** Nothing was committed; the caller may retry. */
  | { status: 'failed' };

/**
 * The 2140 treasury publishes its kind:10019 Nutzap info only to BAO's relay
 * (and lists only that relay in it). BAO's relay is not an app default relay,
 * so when a recipient's Nutzap info isn't found on the app relays we query
 * this relay directly before giving up.
 */
const TREASURY_INFO_FALLBACK_RELAY = 'wss://relay.bao.network';

export interface CashuWalletActions {
  setMintUrl: (url: string) => void;
  addCustomMint: (name: string, url: string) => void;
  removeCustomMint: (url: string) => void;
  handleSeedBackupConfirm: () => Promise<void>;
  calculateAllBalances: () => Promise<void>;
  receiveToken: (tokenStr: string, privkey?: string) => Promise<number>;
  sendToken: (amount: number, memo?: string, recipientPubkey?: string, mintUrlOverride?: string) => Promise<string | null>;
  /**
   * True when the most recent sendToken failure may have committed at the
   * mint (timeout, dropped response, or post-commit validation). Callers
   * with an automatic retry MUST check this first: retrying after an
   * ambiguous failure can double-spend from the remaining proofs.
   */
  wasLastSendAmbiguous: () => boolean;
  sendLockedToken: (amount: number, recipientPubkey: string, memo?: string, mintUrlOverride?: string) => Promise<string | null>;
  /**
   * Send a 2-of-3 multisig escrow-locked token (the ₿AO escrow primitive):
   * locked to {partyA, partyB, operator} with n_sigs=2, a refund locktime, and
   * the depositor's own key as refund signer. The lock is validated BEFORE the
   * wallet is debited.
   */
  sendMultisigLockedToken: (amount: number, lock: MultisigEscrowLockRequest, memo?: string, mintUrlOverride?: string) => Promise<string | null>;
  receiveLockedToken: (tokenStr: string, privkey: string) => Promise<number>;
  /** Sweep a token locked to THIS wallet's NIP-60 P2PK key (kind-10019 pubkey). Returns sats received (0 on failure). */
  sweepWalletLockedToken: (tokenStr: string) => Promise<number>;
  /** Read-only accessor for this wallet's NIP-60 P2PK pubkey (x-only hex), null before wallet init. */
  getWalletP2pkPubkey: () => string | null;
  requestInvoice: (amount: number, description?: string) => Promise<MintQuoteResponse | null>;
  mintFromQuote: (quoteId: string, amount: number) => Promise<void>;
  payInvoice: (invoice: string) => Promise<{ success: boolean; amount: number; preimage?: string; pending?: boolean; quote?: MeltQuoteResponse }>;
  payBolt12: (offer: string, amountSats: number) => Promise<{ success: boolean; amount: number; pending?: boolean; quote?: Bolt12MeltQuoteResponse }>;
  sendNutzap: (amount: number, recipientNpubOrNprofile: string, mintUrl: string, opts?: { memo?: string; zappedEvent?: { id: string; kind: number; relay?: string } }) => Promise<NutzapSendResult>;
  receiveNutzap: (event: NostrEvent) => Promise<void>;
  checkMintQuote: (quote: MintQuoteResponse) => Promise<MintQuoteResponse | null>;
  checkMeltQuote: (quote: MeltQuoteResponse) => Promise<MeltQuoteResponse | null>;
  clearError: () => void;
  clearSuccess: () => void;
  restoreFromBackup: (payload: CashuBackupPayload) => Promise<void>;
}

/* ── Module-scope helpers ─────────────────────────────────── */

const VALID_PROOF_STATES = new Set(['UNSPENT', 'PENDING', 'SPENT']);

/** Matches createMintFetch's per-request timeout: a timed-out mint call can
 *  stay live this long, so recovery must not trust a spent-state check (or
 *  give up on a late response) before it has elapsed. */
const MINT_FETCH_TIMEOUT_MS = 120_000;

const PENDING_RECEIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_RECEIVE_MAX_ATTEMPTS = 5;

const readProofStoreTimestamp = (mintUrl: string, namespace: string): number => {
  try {
    const raw = localStorage.getItem(`${namespace}proof_store_ts_${stringToBase64(mintUrl)}`);
    const ts = raw ? Number(raw) : NaN;
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
};

/**
 * Generic FIFO mutex for wallet operations that spend or mint proofs.
 * Exported for unit testing; the public hook interface is unchanged.
 */
export async function acquireMutex(mutexRef: { current: Promise<void> | null }): Promise<() => void> {
  while (mutexRef.current) {
    await mutexRef.current;
  }
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = () => {
      if (mutexRef.current === promise) {
        mutexRef.current = null;
      }
      resolve();
    };
  });
  mutexRef.current = promise;
  return release;
}

/** Normalize a relay URL for set comparison (trailing slash/case insensitive). */
function normalizeRelayUrlForCompare(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

/** Publish an event to specific relay URLs via one-shot connections.
 *  Returns the subset of URLs that accepted the event. Best-effort: a relay
 *  that rejects, times out, or is unreachable is simply absent from the
 *  result — callers decide whether that warrants a retry. */
async function publishEventToRelayUrls(event: NostrEvent, urls: string[]): Promise<string[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const relay = new NRelay1(url);
      try {
        await relay.event(event, { signal: AbortSignal.timeout(8_000) });
        return url;
      } finally {
        try { await relay.close(); } catch { /* ignore close errors */ }
      }
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

export interface UseCashuWalletOptions {
  backupCashuState?: (payload: CashuBackupPayload) => Promise<string | null>;
  restoreCashuState?: () => Promise<CashuBackupPayload | null>;
  nip60Sync?: Nip60SyncApi;
  defaultMints?: Array<{ name: string; url: string }>;
  deriveWalletKey?: (seedPhrase: string) => { privkey: Uint8Array; pubkey: string };
  walletLabel?: string;
  /** Optional BAO wallet config to include in the combined kind:17375 event. */
  baoWalletConfig?: Nip60WalletConfig;
  /** Whether to publish the kind:17375 wallet config. Set to false for secondary wallets (e.g. BAO) when a combined config is published elsewhere. */
  publishWalletConfig?: boolean;
  /** When false the wallet stays idle. Defaults to true. */
  enabled?: boolean;
  /** localStorage key prefix. Defaults to "freedomid_". */
  storageNamespace?: string;
}

export function useCashuWallet(
  externalSeed?: string,
  options?: UseCashuWalletOptions,
): CashuWalletState & CashuWalletActions {
  const { config } = useAppContext();
  const defaultMintsInput = options?.defaultMints;
  const defaultMintsKey = JSON.stringify(defaultMintsInput);
  const defaultMints = useMemo(
    () => defaultMintsInput ?? DEFAULT_MINTS,
    // Deep-stable dependency so callers can pass a fresh array literal each
    // render without re-triggering wallet initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultMintsKey],
  );
  const deriveWalletKey = useMemo(() => options?.deriveWalletKey ?? deriveNip60WalletKey, [options?.deriveWalletKey]);
  const _walletLabel = options?.walletLabel ?? 'Cashu';
  const enabled = options?.enabled !== false;
  const [wallet, setWallet] = useState<CashuWallet | null>(null);
  const [mintUrl, setMintUrlState] = useState<string>(defaultMints[0]?.url || '');
  const [customMints, setCustomMints] = useState<Array<{ name: string; url: string }>>([]);

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [totalBalance, setTotalBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nutzaps, setNutzaps] = useState<NostrEvent[]>([]);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle');
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const seedPhraseRef = useRef('');
  const bip39SeedRef = useRef<Uint8Array | null>(null);
  const encKeyRef = useRef<CryptoKey | null>(null);
  const legacyEncKeyRef = useRef<CryptoKey | null>(null);
  const getEncKey = (): CryptoKey => {
    const key = encKeyRef.current;
    if (!key) throw new Error('Wallet not initialized');
    return key;
  };
  const getBip39Seed = (): Uint8Array => {
    const seed = bip39SeedRef.current;
    if (!seed) throw new Error('Wallet seed not available');
    return seed;
  };
  const [isNewWallet, setIsNewWallet] = useState(false);
  const [showSeedBackup, setShowSeedBackup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const initNonceRef = useRef(0);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const backupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletCacheRef = useRef<Map<string, CashuWallet>>(new Map());
  const backupCashuStateRef = useRef(options?.backupCashuState);
  const restoreCashuStateRef = useRef(options?.restoreCashuState);
  const nip60SyncRef = useRef(options?.nip60Sync);
  const baoWalletConfigRef = useRef(options?.baoWalletConfig);
  useEffect(() => { backupCashuStateRef.current = options?.backupCashuState; }, [options?.backupCashuState]);
  useEffect(() => { restoreCashuStateRef.current = options?.restoreCashuState; }, [options?.restoreCashuState]);
  useEffect(() => { nip60SyncRef.current = options?.nip60Sync; }, [options?.nip60Sync]);
  useEffect(() => { baoWalletConfigRef.current = options?.baoWalletConfig; }, [options?.baoWalletConfig]);
  const storageNamespaceRef = useRef(options?.storageNamespace ?? 'freedomid_');
  useEffect(() => { storageNamespaceRef.current = options?.storageNamespace ?? 'freedomid_'; }, [options?.storageNamespace]);
  const storageRef = useRef<CashuStorage>(createCashuStorage(options?.storageNamespace ?? 'freedomid_'));
  const nip60WalletKeyRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const nip60RestoredRef = useRef(false);
  /** Wallet key recovered from the identity's cross-app NIP-60 config (BAO
   * demo wallet only): when bao.markets published a kind:17375 config for this
   * identity, its wallet key becomes this wallet's NIP-60 signing key so token
   * events converge on the same author both apps read. */
  const crossAppWalletKeyRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const isBaoNamespaceRef = useRef(storageNamespaceRef.current.startsWith('freedomid_bao_'));
  const processedNutzapIdsRef = useRef<Set<string>>(new Set());
  const pendingNutzapInFlightRef = useRef(false);
  const lastSeedRef = useRef<string>('');
  const balanceVersionRef = useRef(0);
  /** ONE mutex serializing every wallet op that read-modify-writes a per-mint
   *  proof store (receiveToken, sendToken, payInvoice, payBolt12,
   *  mintFromQuote, sendNutzap, receiveNutzap). The cross-tab proof lock does
   *  NOT serialize same-tab operations, and per-op-type mutexes let a
   *  relay-triggered receiveNutzap interleave with a mid-flight payInvoice:
   *  both compute their final store from a stale read and the last writer
   *  wins — silently burning freshly received proofs or resurrecting spent
   *  melt inputs. Ops can await mint I/O for up to 60s inside the lock, so
   *  the interleaving window is wide. Sharing one mutex trades a little
   *  cross-mint concurrency for never clobbering the store. */
  const walletOpsMutexRef = useRef<Promise<void> | null>(null);
  const processedTokenHashesRef = useRef<Set<string>>(new Set());
  /**
   * Set by sendToken's failure path: true when the failed send MAY have
   * committed at the mint (timeout, dropped response, or a post-commit
   * validation throw). A blind retry would then double-spend from other
   * proofs — callers with an automatic retry (compute-credits redeem) must
   * check this before re-sending.
   */
  const lastSendAmbiguousRef = useRef(false);
  const nutzapKeyPairRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const reconcileProofRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const mintUrlRef = useRef(mintUrl);
  const customMintsRef = useRef(customMints);
  const walletRef = useRef<CashuWallet | null>(null);
  const receiveTokenRef = useRef<(tokenStr: string) => Promise<number>>(async () => 0);

  useEffect(() => { mintUrlRef.current = mintUrl; }, [mintUrl]);
  useEffect(() => { customMintsRef.current = customMints; }, [customMints]);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  // Persist custom mints outside of render-phase state updaters.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey) return;
    storageRef.current.saveCustomMints(customMints, encKey).catch((e) => devLog.error('Failed to persist custom mints:', e));
  }, [customMints]);

  /** Sum the amounts of a list of proofs, ignoring invalid entries. */
  const sumProofAmounts = (proofs: any[]): number =>
    proofs.reduce((sum, p) => sum + (Number.isInteger(p?.amount) && p.amount > 0 ? p.amount : 0), 0);

  /** Extract the NUT-11 P2PK lock pubkey (lowercased) from a proof secret, or
   *  null for bearer/malformed secrets. Accepts the real NUT-11 well-known
   *  form `["P2PK", {nonce, data, tags}]` (what cashu-ts emits), the simplified
   *  array form `["P2PK", <pubkey>]`, and the legacy object form. */
  const p2pkLockPubkeyFromSecret = (secret: unknown): string | null => {
    if (typeof secret !== 'string' || !secret.startsWith('[') && !secret.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(secret);
      const raw = Array.isArray(parsed) && parsed[0] === 'P2PK'
        ? typeof parsed[1] === 'string'
          ? parsed[1]
          : parsed[1] && typeof parsed[1] === 'object' && typeof parsed[1].data === 'string'
            ? parsed[1].data
            : null
        : parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.pubkey === 'string' ? parsed.pubkey
        : null;
      if (typeof raw !== 'string') return null;
      const lower = raw.toLowerCase();
      return /^([0-9a-f]{64}|0[23][0-9a-f]{64})$/.test(lower) ? lower : null;
    } catch {
      return null;
    }
  };

  /** True when a proof is bearer or P2PK-locked to a key THIS wallet can
   *  spend (NIP-60 wallet key / nutzap key). Foreign-locked proofs can never
   *  be spent by us — merging them into the store would inflate the balance
   *  with unspendable proofs and poison future sends. Reads the key refs at
   *  call time, so an empty dep array is correct (refs are stable). */
  const isSpendableProof = useCallback((p: any): boolean => {
    const lock = p2pkLockPubkeyFromSecret(p?.secret);
    if (!lock) return true;
    const xonly = lock.length === 66 ? lock.slice(2) : lock;
    const ourKeys = [nip60WalletKeyRef.current?.pubkey, nutzapKeyPairRef.current?.pubkey]
      .filter((k): k is string => typeof k === 'string')
      .map((k) => (k.length === 66 ? k.slice(2) : k));
    return ourKeys.includes(xonly);
  }, []);

  /** Deduplicate proofs by their public key commitment C. */
  const dedupeProofs = (proofs: any[]): any[] => {
    const seen = new Set<string>();
    return proofs.filter((p) => {
      if (!p || !p.C) return false;
      const key = String(p.C);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  /** Sanitize proofs: keep only objects with valid Cashu proof shape. */
  const sanitizeProofs = (proofs: any[]): any[] => {
    if (!Array.isArray(proofs)) return [];
    return proofs.filter((p) => {
      if (!p || typeof p !== 'object') return false;
      if (typeof p.amount !== 'number') return false;
      const amt = p.amount;
      return (
        Number.isInteger(amt) &&
        amt > 0 &&
        amt <= Number.MAX_SAFE_INTEGER &&
        typeof p.C === 'string' &&
        p.C.length > 0 &&
        p.C.length <= MAX_PROOF_FIELD_LENGTH &&
        typeof p.secret === 'string' &&
        p.secret.length > 0 &&
        p.secret.length <= MAX_PROOF_FIELD_LENGTH &&
        typeof p.id === 'string' &&
        p.id.length > 0 &&
        p.id.length <= MAX_PROOF_FIELD_LENGTH &&
        (p.witness === undefined ||
          (typeof p.witness === 'string' && p.witness.length <= MAX_PROOF_FIELD_LENGTH))
      );
    });
  };

  const reconcilePendingReceives = useCallback(async () => {
    const encKey = encKeyRef.current;
    const wallet = walletRef.current;
    if (!encKey || !wallet) return;
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`${storageNamespaceRef.current}receive_pending_`)) keys.push(k);
      }
    } catch {
      return;
    }
    for (const key of keys) {
      let tokenHash = '';
      try {
        const base64Hash = key.slice((storageNamespaceRef.current + 'receive_pending_').length);
        tokenHash = atob(base64Hash);
      } catch {
        continue;
      }
      const entry = await storageRef.current.loadPendingReceive(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
      if (!entry || entry.status !== 'pending') {
        storageRef.current.clearPendingReceive(tokenHash);
        continue;
      }
      if (Date.now() - entry.timestamp > PENDING_RECEIVE_TTL_MS) {
        devLog.warn('Pending receive entry expired, clearing:', tokenHash);
        storageRef.current.clearPendingReceive(tokenHash);
        continue;
      }
      if (entry.attempts >= PENDING_RECEIVE_MAX_ATTEMPTS) {
        devLog.warn('Pending receive exceeded max attempts, clearing:', tokenHash);
        storageRef.current.clearPendingReceive(tokenHash);
        continue;
      }
      entry.attempts += 1;
      try {
        await storageRef.current.writePendingReceive(
          entry.tokenStr,
          tokenHash,
          entry.mintUrls,
          entry.amount,
          encKey,
          entry.succeededMintUrls,
          entry.attempts,
        );
      } catch {
        // If we cannot persist the incremented attempt counter, skip this cycle.
        continue;
      }
      devLog.log('Re-attempting pending receive:', tokenHash, 'attempt', entry.attempts);
      try {
        await receiveTokenRef.current(entry.tokenStr);
      } catch (e) {
        devLog.warn('Pending receive re-attempt failed:', tokenHash, e);
      }
    }
  }, []);

  /** Restore input proofs for a melt that resolved to UNPAID. */
  const restoreMeltInputProofs = async (mintUrl: string) => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    if (!encKey) return;
    const normalized = safeNormalizeMintUrl(mintUrl);
    // Dedicated melt-input slot first; fall back to the legacy shared
    // proof-recovery slot for journals written before the slot existed.
    let recoveredEntry = await storageRef.current.loadMeltInputRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined);
    let fromLegacySlot = false;
    if (!recoveredEntry || recoveredEntry.proofs.length === 0) {
      recoveredEntry = await storageRef.current.loadProofRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined);
      fromLegacySlot = true;
    }
    if (!recoveredEntry || recoveredEntry.proofs.length === 0) return;
    const seed = bip39Seed;
    let recovered = recoveredEntry.proofs;
    if (seed) {
      try {
        // STRICTLY unspent: proofs the mint still reports PENDING are locked by
        // an in-flight melt (quote expiry does not cancel a dispatched
        // payment) and must NOT return to the spendable store — they stay in
        // the journal until the quote resolves.
        recovered = await filterSpendableProofs(normalized, recovered, seed);
      } catch (e) {
        devLog.warn('Could not verify melt input proofs during async recovery:', normalized, e);
        return;
      }
    }
    const recoveredSecrets = new Set(recovered.map((p) => String((p as { secret?: unknown })?.secret)));
    const stillLocked = seed
      ? recoveredEntry.proofs.filter((p) => !recoveredSecrets.has(String((p as { secret?: unknown })?.secret)))
      : [];
    // Serialize with every other proof-store read-modify-write: an op that
    // read the store at its start would otherwise overwrite this merge from
    // stale state (the cross-tab proof lock is re-entrant within a tab).
    const release = await acquireMutex(walletOpsMutexRef);
    try {
      await storageRef.current.withProofLock(async () => {
        // MERGE with the current store — never overwrite. The store holds every
        // proof this wallet still owns for the mint (the melt inputs were
        // removed when the melt was attempted); replacing it with only the
        // recovered inputs would silently wipe the rest of the balance.
        const existing = sanitizeProofs(
          await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined),
        );
        const merged = dedupeProofs([...existing, ...recovered]);
        await storageRef.current.saveProofsForMint(normalized, merged, encKey);
        storageRef.current.writeProofStoreTimestamp(normalized);
        if (fromLegacySlot) storageRef.current.clearProofRecovery(normalized);
        if (stillLocked.length > 0) {
          // Keep the mint-locked inputs journaled so the poll/reconcile can
          // still resolve them once the quote settles.
          await storageRef.current.writeMeltInputRecovery(normalized, stillLocked, encKey);
        } else {
          storageRef.current.clearMeltInputRecovery(normalized);
        }
        storageRef.current.clearMeltChangeRecovery(normalized);
      });
    } finally {
      release();
    }
    await calculateAllBalances();
  };

  /** Deduplicate an array by a key function. */
  const dedupeByKey = <T,>(arr: T[], keyFn: (item: T) => string): T[] => {
    const seen = new Set<string>();
    return arr.filter((item) => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  /** Wrap a promise with a timeout to prevent indefinite hangs.
   *  The timeout does NOT cancel the underlying mint request (no abort signal
   *  reaches the cashu-ts fetch — it is governed by createMintFetch's own 120s
   *  per-request timeout), so a late response can still commit at the mint.
   *  The optional recovery callback therefore runs only once the request has
   *  actually SETTLED: before that, a spent-state check is not authoritative
   *  and could clear the crash journal while the mint is still processing the
   *  swap. A hard backstop just past the mint fetch's own timeout covers
   *  requests that never settle. */
  const withTimeout = <T>(
    promise: Promise<T>,
    ms: number,
    label: string,
    onTimeout?: () => void,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          devLog.warn(`${label} timed out after ${ms}ms`);
          if (onTimeout) {
            let fired = false;
            const fire = () => {
              if (fired) return;
              fired = true;
              try {
                onTimeout();
              } catch (e) {
                devLog.error('Timeout recovery callback failed:', e);
              }
            };
            promise.then(fire, fire);
            setTimeout(fire, Math.max(1, MINT_FETCH_TIMEOUT_MS - ms) + 5_000);
          }
          reject(new Error(`${label} timed out — please try again`));
        }, ms);
      }),
    ]);
  };

  /** Serialize receiveToken calls so the same multi-mint token cannot be
   *  double-credited under a race — shares the single wallet-ops mutex with
   *  every other proof-store mutation. */
  const acquireReceiveTokenLock = async (): Promise<() => void> => acquireMutex(walletOpsMutexRef);

  // Combine default + custom mints (deduplicated by URL)
  const allMints = useMemo(
    () => dedupeByKey([...defaultMints, ...customMints], (m) => safeNormalizeMintUrl(m.url)),
    [customMints, defaultMints]
  );
  const allMintsRef = useRef(allMints);
  useEffect(() => { allMintsRef.current = allMints; }, [allMints]);

  /** Debounced backup to Nostr relays */
  const backupInFlightRef = useRef(false);

  // Execute the backup immediately using current refs. Called directly by
  // flushPendingBackup and indirectly via the debounced triggerBackup timer.
  const runBackup = useCallback(async () => {
    if (backupInFlightRef.current) return;
    if (!backupCashuStateRef.current || !encKeyRef.current || !bip39SeedRef.current) return;
    const currentEncKey = getEncKey();
    const currentBip39Seed = getBip39Seed();
    const currentAllMints = allMintsRef.current;
    const currentMintUrl = mintUrlRef.current;
    const currentCustomMints = customMintsRef.current;
    if (!currentEncKey || !currentBip39Seed) return;
    backupInFlightRef.current = true;
    try {
      setBackupStatus('syncing');
      // Acquire proof + tx locks for a consistent snapshot. Order must match
      // operation order (proofLock first, then txLock) to avoid deadlock.
      const perMint: Array<{ mintUrl: string; proofs: any[] }> = [];
      let txs: Transaction[] = [];
      await storageRef.current.withProofLock(async () => {
        await storageRef.current.withTxLock(async () => {
          for (const m of currentAllMints) {
            try {
              const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(safeNormalizeMintUrl(m.url), currentEncKey, legacyEncKeyRef.current ?? undefined));
              if (proofs.length > 0) perMint.push({ mintUrl: m.url, proofs });
            } catch (e) {
              devLog.warn('Failed to read proofs for backup:', m.url, e);
              // Continue with other mints
            }
          }
          // Read transactions fresh from storage (encrypted if key available)
          txs = await storageRef.current.loadTransactions(currentEncKey, legacyEncKeyRef.current ?? undefined);
        });
      });
      // Read auxiliary state outside the proof/tx locks; it has its own storage keys.
      let mintedQuoteIds: string[] = [];
      let processedTokenHashes: { hash: string; expiresAt: number }[] = [];
      try {
        mintedQuoteIds = await storageRef.current.loadMintedQuotes(currentEncKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to read minted quotes for backup:', e);
      }
      try {
        processedTokenHashes = await storageRef.current.loadProcessedTokenHashes(currentEncKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to read processed token hashes for backup:', e);
      }

      const payload: CashuBackupPayload = {
        version: 2,
        timestamp: Date.now(),
        epoch: 0,
        mints: currentAllMints.map(m => m.url),
        proofs: perMint,
        transactions: txs,
        selectedMintUrl: currentMintUrl,
        customMints: currentCustomMints.map(m => ({ name: m.name, url: m.url })),
        nutzapPubkey: nutzapKeyPairRef.current?.pubkey,
        mintedQuoteIds,
        processedTokenHashes,
      };
      const result = await backupCashuStateRef.current(payload);
      if (mountedRef.current) {
        if (result) {
          setBackupStatus('synced');
          setLastBackupAt(Date.now());
        } else {
          setBackupStatus('failed');
        }
      }
    } catch (e) {
      devLog.error('Auto-backup failed:', e);
      if (mountedRef.current) setBackupStatus('failed');
    } finally {
      backupInFlightRef.current = false;
    }
  }, []);

  const triggerBackup = useCallback(async () => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    if (!options?.backupCashuState || !encKey || !bip39Seed) {
      if (backupTimeoutRef.current) clearTimeout(backupTimeoutRef.current);
      backupTimeoutRef.current = null;
      return;
    }
    if (backupTimeoutRef.current) clearTimeout(backupTimeoutRef.current);
    backupTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      void runBackup();
    }, 3000);
  }, [options?.backupCashuState, runBackup]);

  const flushPendingBackup = useCallback(async () => {
    if (backupTimeoutRef.current) {
      clearTimeout(backupTimeoutRef.current);
      backupTimeoutRef.current = null;
    }
    await runBackup();
  }, [runBackup]);

  useEffect(() => {
    mountedRef.current = true;
    backupInFlightRef.current = false;
    const cache = walletCacheRef.current;
    const handleBeforeUnload = () => {
      void flushPendingBackup();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    return () => {
      mountedRef.current = false;
      // Flush any pending backup before unmounting. If keys have already been
      // zeroed, flushPendingBackup will skip the upload rather than run with
      // missing secrets.
      void flushPendingBackup();
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      if (backupTimeoutRef.current) clearTimeout(backupTimeoutRef.current);
      cache.clear();
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    };
  }, [flushPendingBackup]);

  const setSuccessTimed = (msg: string, ms = 3000) => {
    if (!mountedRef.current) return;
    setSuccess(msg);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setSuccess('');
    }, ms);
  };

  // Save selected mint
  useEffect(() => {
    if (mintUrl && encKeyRef.current) {
      storageRef.current.saveSelectedMintUrl(mintUrl, encKeyRef.current!).catch((e) => devLog.error('Failed to persist selected mint:', e));
    }
  }, [mintUrl]);

  // Load encrypted mint metadata and transactions once the encryption key is
  // available. In production we do not hydrate plaintext state at boot.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey) return;
    let cancelled = false;
    (async () => {
      try {
        await storageRef.current.migrateMintMetadata(encKey, legacyEncKeyRef.current ?? undefined);
        const [savedUrl, savedMints] = await Promise.all([
          storageRef.current.loadSelectedMintUrl(encKey, legacyEncKeyRef.current ?? undefined),
          storageRef.current.loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined),
        ]);
        if (cancelled) return;
        if (savedUrl) setMintUrlState(savedUrl);
        if (savedMints.length > 0) setCustomMints(savedMints);

        await storageRef.current.migratePlaintextTransactions(encKey, legacyEncKeyRef.current ?? undefined);
        const txs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
        if (cancelled) return;
        setTransactions(txs);
      } catch (e) {
        devLog.error('Failed to load encrypted wallet metadata:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Initialize wallet from external seed (from NostrContext)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const init = async () => {
      if (externalSeed) {
        const trimmedSeed = externalSeed.trim();
        if (lastSeedRef.current !== trimmedSeed) {
          walletCacheRef.current.clear();
          lastSeedRef.current = trimmedSeed;
        }
        seedPhraseRef.current = trimmedSeed;
        let seed: Uint8Array;
        let key: CryptoKey;
        try {
          seed = deriveMasterKey(trimmedSeed);
          key = await deriveEncryptionKey(trimmedSeed);
          legacyEncKeyRef.current = await deriveLegacyEncryptionKey(trimmedSeed);
        } catch (e: any) {
          devLog.error('Invalid wallet seed:', e);
          if (mountedRef.current) {
            setError('Invalid recovery phrase');
            setWallet(null);
            if (bip39SeedRef.current) {
              bip39SeedRef.current.fill(0);
            }
            bip39SeedRef.current = null;
            encKeyRef.current = null;
            setBalances({});
            setTotalBalance(0);
            setMintInfo(null);
          }
          return;
        }
        if (cancelled) return;
        bip39SeedRef.current = seed;
        encKeyRef.current = key;
        try {
          nutzapKeyPairRef.current = deriveNutzapKey(trimmedSeed);
        } catch (e) {
          devLog.warn('Failed to derive nutzap key:', e);
          nutzapKeyPairRef.current = null;
        }
        try {
          nip60WalletKeyRef.current = deriveWalletKey(trimmedSeed);
        } catch (e) {
          devLog.warn('Failed to derive NIP-60 wallet key:', e);
          nip60WalletKeyRef.current = null;
        }
        // Hydrate the in-memory duplicate-token guard from encrypted storage so
        // a token received before a restart cannot be double-credited.
        try {
          const persisted = await storageRef.current.loadProcessedTokenHashes(key, legacyEncKeyRef.current ?? undefined);
          for (const entry of persisted) processedTokenHashesRef.current.add(entry.hash);
        } catch {
          // Non-fatal: the persisted guard is a defense-in-depth optimization.
        }
        // Hydrate the in-memory Nutzap dedup guard so a restart does not re-attempt
        // redemption of an already-processed Nutzap.
        try {
          const persistedNutzaps = await storageRef.current.loadProcessedNutzapIds(key, legacyEncKeyRef.current ?? undefined);
          for (const entry of persistedNutzaps) processedNutzapIdsRef.current.add(entry.id);
        } catch {
          // Non-fatal: the Nutzap guard is defense in depth.
        }
        await initWallet(seed, key);
        if (cancelled) return;

        // Plaintext transaction migration is handled by the dedicated effect
        // once the encryption key is available. We only need to refresh state
        // here in case the migration effect has already run.
        try {
          const migratedTxs = await storageRef.current.loadTransactions(key, legacyEncKeyRef.current ?? undefined);
          if (cancelled) return;
          if (mountedRef.current) setTransactions(migratedTxs);
        } catch (e) {
          devLog.error('Transaction load failed:', e);
        }

        // NIP-60 restore and initial sync (before DPCS fallback)
        // BAO demo wallets are isolated from the main-wallet NIP-60 namespace:
        // they skip kind:10019/17375 config sync here and instead mirror the
        // wallet bao.markets publishes on the BAO relay (cross-app restore).
        if (!cancelled && nip60SyncRef.current && nip60WalletKeyRef.current && !isBaoNamespaceRef.current) {
          try {
            const loadedCustomMints = await storageRef.current.loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
            const priorAllMints = allMintsRef.current;
            allMintsRef.current = dedupeByKey(
              [...defaultMints, ...loadedCustomMints],
              (m) => safeNormalizeMintUrl(m.url),
            );
            if (!nip60RestoredRef.current) {
              await restoreFromNip60();
              nip60RestoredRef.current = true;
            }
            await syncNip60WalletConfig();
            await syncAllNip60Tokens();
            await publishNip60NutzapInfo();
            allMintsRef.current = priorAllMints;
          } catch (e) {
            devLog.error('NIP-60 init sync failed:', e);
          }
        }

        // BAO demo wallet: pull the balance the same npub holds on bao.markets
        // (faucet claims, trade winnings) from the BAO relay. Runs every init —
        // merge-only and idempotent, so repeated restores are safe.
        if (!cancelled && isBaoNamespaceRef.current && nip60SyncRef.current) {
          try {
            await restoreFromBaoMarkets();
          } catch (e) {
            devLog.error('bao.markets NIP-60 init restore failed:', e);
          }
        }

        // Auto-restore from Nostr relays if local wallet is empty
        const restoreFn = restoreCashuStateRef.current;
        if (restoreFn && key) {
          try {
            // Use default mints + loaded custom mints directly (allMints state may be stale here)
            const loadedCustomMints = await storageRef.current.loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
            const knownMints = [...defaultMints, ...loadedCustomMints];
            const hasAnyProofs = await (async () => {
              for (const m of knownMints) {
                const p = sanitizeProofs(await storageRef.current.getProofsForMint(safeNormalizeMintUrl(m.url), key, legacyEncKeyRef.current ?? undefined));
                if (cancelled) return false;
                if (p.length > 0) return true;
              }
              return false;
            })();
            if (cancelled) return;
            const txs = await storageRef.current.loadTransactions(key, legacyEncKeyRef.current ?? undefined);
            if (cancelled) return;
            // Always attempt restore when restoreFn is available; merge logic is safe
            // (dedupes proofs, filters new transactions, merges custom mints).
            const restoreAttempted = localStorage.getItem(storageNamespaceRef.current + 'restore_attempted') === 'true';
            if (!restoreAttempted || (!hasAnyProofs && txs.length === 0)) {
              devLog.log('Attempting relay restore');
              const restored = await restoreFn();
              try { localStorage.setItem(storageNamespaceRef.current + 'restore_attempted', 'true'); } catch { /* storage unavailable */ }
              if (cancelled) return;
              if (restored && mountedRef.current) {
                // Restore proofs per mint — MERGE with local rather than overwrite.
                // Verify against the mint that backed-up proofs are still unspent.
                if (Array.isArray(restored.proofs)) {
                  await storageRef.current.withProofLock(async () => {
                    const seed = bip39SeedRef.current;
                    for (const entry of restored.proofs) {
                      if (cancelled) return;
                      if (entry && typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0 && isAllowedMintUrl(entry.mintUrl, allMintsRef.current.map((m) => m.url)) && Array.isArray(entry.proofs) && entry.proofs.length > 0) {
                        const normalized = safeNormalizeMintUrl(entry.mintUrl);
                        const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, key, legacyEncKeyRef.current ?? undefined));
                        let incoming = sanitizeProofs(entry.proofs);
                        if (seed) {
                          try {
                            incoming = sanitizeProofs(dedupeProofs(await filterUnspentProofs(normalized, incoming, seed)));
                          } catch (e) {
                            devLog.warn('Could not verify backed-up proofs, skipping restore for mint:', normalized, e);
                            continue;
                          }
                        }
                        const merged = dedupeProofs([...existing, ...incoming]);
                        await storageRef.current.saveProofsForMint(normalized, merged, key);
                      }
                    }
                  });
                  if (cancelled) return;
                }
                // Restore transactions — merge with local rather than overwrite.
                // Cap imported transaction count and amounts; warn on very old txs.
                if (Array.isArray(restored.transactions) && restored.transactions.length > 0) {
                  await storageRef.current.withTxLock(async () => {
                    const MAX_RESTORED_TXS = 500;
                    const MAX_TX_AMOUNT = Number.MAX_SAFE_INTEGER;
                    const VERY_OLD_MS = 180 * 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    let validTxs = restored.transactions.filter((t): t is Transaction => storageRef.current.isValidTransaction(t));
                    validTxs = validTxs.filter((t) => t.amount <= MAX_TX_AMOUNT);
                    const veryOld = validTxs.filter((t) => now - t.createdAt > VERY_OLD_MS);
                    if (veryOld.length > 0) {
                      devLog.warn(`Restore contains ${veryOld.length} transactions older than 180 days`);
                    }
                    validTxs = validTxs.slice(0, MAX_RESTORED_TXS);
                    const localTxs = await storageRef.current.loadTransactions(key, legacyEncKeyRef.current ?? undefined);
                    const seen = new Set(localTxs.map((t) => t.id));
                    const newTxs = validTxs.filter((t) => !seen.has(t.id));
                    if (newTxs.length > 0) {
                      await storageRef.current.saveTransactions([...localTxs, ...newTxs], key);
                      if (cancelled) return;
                      const finalTxs = await storageRef.current.loadTransactions(key, legacyEncKeyRef.current ?? undefined);
                      if (cancelled) return;
                      setTransactions(finalTxs);
                    }
                  });
                  if (cancelled) return;
                }
                // Restore custom mints (validate host before adopting)
                if (Array.isArray(restored.customMints)) {
                  const valid = restored.customMints.filter(
                    (m): m is StoredMint =>
                      m &&
                      typeof m === 'object' &&
                      typeof m.url === 'string' &&
                      m.url.length > 0 &&
                      typeof m.name === 'string' &&
                      m.name.length > 0 &&
                      isAllowedMintUrl(m.url),
                  );
                  if (valid.length > 0) {
                    const existing = await storageRef.current.loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
                    const merged = dedupeByKey(
                      [...existing, ...valid],
                      (m) => safeNormalizeMintUrl(m.url),
                    );
                    setCustomMints(merged);
                    await storageRef.current.saveCustomMints(merged, key);
                  }
                }
                // Restore selected mint (validate host before adopting)
                if (restored.selectedMintUrl) {
                  const normalizedSelected = normalizeMintUrl(restored.selectedMintUrl);
                  if (normalizedSelected && isAllowedMintUrl(normalizedSelected)) {
                    setMintUrlState(normalizedSelected);
                  } else {
                    devLog.warn('Restored selected mint URL is not allowed, skipping:', normalizedSelected);
                  }
                }
                // Restore auxiliary state used to prevent double-spend/double-receive.
                if (restored.version === 2 && Array.isArray(restored.mintedQuoteIds) && restored.mintedQuoteIds.length > 0) {
                  try {
                    await storageRef.current.saveMintedQuotes(restored.mintedQuoteIds, key);
                  } catch (e) {
                    devLog.warn('Failed to restore minted quote IDs:', e);
                  }
                }
                if (restored.version === 2 && Array.isArray(restored.processedTokenHashes) && restored.processedTokenHashes.length > 0) {
                  try {
                    const existing = await storageRef.current.loadProcessedTokenHashes(key, legacyEncKeyRef.current ?? undefined);
                    const seen = new Set(existing.map((e) => e.hash));
                    const merged = [
                      ...existing,
                      ...restored.processedTokenHashes.filter(
                        (h): h is { hash: string; expiresAt: number } =>
                          !!h &&
                          typeof h === 'object' &&
                          typeof h.hash === 'string' &&
                          typeof h.expiresAt === 'number' &&
                          !seen.has(h.hash),
                      ),
                    ];
                    await storageRef.current.saveProcessedTokenHashes(merged, key);
                  } catch (e) {
                    devLog.warn('Failed to restore processed token hashes:', e);
                  }
                }
                if (cancelled) return;
                await calculateAllBalances(undefined, key);
                devLog.log('Wallet restored from Nostr relays');
                setSuccessTimed('Wallet restored from backup');
              }
            }
          } catch (e) {
            devLog.error('Auto-restore failed:', e);
          }
        }
      } else {
        // Seed is being cleared (e.g. wallet locked). Flush any pending backup
        // while the keys are still available, then zero state. If keys are
        // already gone, flushPendingBackup will skip rather than run with
        // missing secrets.
        await flushPendingBackup();
        if (cancelled) return;
        // No seed available yet — wallet stays uninitialized until unlocked
        try { localStorage.removeItem(storageNamespaceRef.current + 'restore_attempted'); } catch { /* ignore */ }
        seedPhraseRef.current = '';
        if (bip39SeedRef.current) {
          bip39SeedRef.current.fill(0);
        }
        bip39SeedRef.current = null;
        if (nutzapKeyPairRef.current) {
          nutzapKeyPairRef.current.privkey.fill(0);
        }
        nutzapKeyPairRef.current = null;
        encKeyRef.current = null;
        setWallet(null);
        setTransactions([]);
        setBalances({});
        setTotalBalance(0);
        setMintInfo(null);
        setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSeed, enabled, defaultMints]);

  // Re-publish NIP-60 wallet config and Nutzap info when the mint list or sync adapter changes.
  useEffect(() => {
    if (!encKeyRef.current || !nip60SyncRef.current || !nip60WalletKeyRef.current || !seedPhraseRef.current) return;
    (async () => {
      await syncNip60WalletConfig();
      await publishNip60NutzapInfo();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMints, options?.nip60Sync]);

  // Re-init wallet when mint or seed changes
  useEffect(() => {
    if (mintUrl && bip39SeedRef.current) {
      initWallet(bip39SeedRef.current!).catch((e) => devLog.error('Wallet init effect error:', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintUrl]);

  // Recalculate balances when mint list changes (e.g. new custom mint added)
  useEffect(() => {
    if (bip39SeedRef.current && encKeyRef.current) {
      calculateAllBalances().catch((e) => devLog.error('Balance calc effect error:', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMints]);

  // Expire stale pending transactions (unbounded growth defence)
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey) return;
    let cancelled = false;
    const STALE_MS = 24 * 60 * 60 * 1000;
    (async () => {
      try {
        const txs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
        if (cancelled) return;
        const now = Date.now();
        let dirty = false;
        const updated = txs.map((t) => {
          if (t.status === 'pending' && (t.type === 'mint' || t.type === 'melt')) {
            const expired = typeof t.expiresAt === 'number' && t.expiresAt > 0 ? now > t.expiresAt : now - t.createdAt > STALE_MS;
            if (expired) {
              dirty = true;
              return { ...t, status: 'expired' as const };
            }
          }
          return t;
        });
        if (dirty && !cancelled) {
          // Use withTxLock to avoid racing with addTransaction / updateTransactionStatus
          await storageRef.current.withTxLock(async () => {
            if (cancelled) return;
            const current = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
            const currentIds = new Set(current.map((t) => t.id));
            const safeUpdated = updated.filter((t) => currentIds.has(t.id));
            if (safeUpdated.length > 0) {
              await storageRef.current.saveTransactions(safeUpdated, encKey);
            }
          });
        }
        if (!cancelled) await refreshTransactions();
      } catch (e) {
        devLog.error('Pending transaction cleanup failed:', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile proof recovery after crash / timeout.
  // Recovery data was written AFTER the mint confirmed the spend but BEFORE
  // storage was updated. We merge it with local proofs (deduplicated by secret),
  // ask the mint to drop any spent ones, and only overwrite local state when the
  // recovery entry is provably newer than the current store (or the store is empty).
  // If the mint cannot be reached, we keep the existing store intact and leave the
  // recovery journal in place for a later retry.
  // NOTE: the effect that invokes this lives right below the callback's
  // definition (after the ref-sync) — see "Reconcile proof recovery effect".

  // Re-attempt any pending receives that were interrupted by a crash or timeout.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey || !wallet) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reconcilePendingReceives();
    })();
    return () => { cancelled = true; };
  }, [wallet, allMints, reconcilePendingReceives]);

  const getOrCreateWallet = useCallback(async (url: string, seed: Uint8Array, allowForeign = false): Promise<CashuWallet> => {
    const allowedUrls = allowForeign
      ? [...allMintsRef.current.map((m) => m.url), url]
      : allMintsRef.current.map((m) => m.url);
    if (!isAllowedMintUrl(url, allowedUrls)) {
      throw new Error('Mint URL is not allowed');
    }
    const cacheKey = safeNormalizeMintUrl(url);
    let w = walletCacheRef.current.get(cacheKey);
    if (w) {
      try {
        await withTimeout(w.loadMint(), 15000, 'Mint load');
        return w;
      } catch {
        // Cache stale — evict and rebuild
        walletCacheRef.current.delete(cacheKey);
      }
    }
    const mintFetch = createMintFetch(allowedUrls);
    const mint = new CashuMint(url, mintFetch as ConstructorParameters<typeof CashuMint>[1]);
    w = new CashuWallet(mint, { bip39seed: seed, unit: 'sat' });
    await withTimeout(w.loadMint(), 15000, 'Mint load');
    walletCacheRef.current.set(cacheKey, w);
    return w;
  }, []);

  /** Ask the mint for the NUT-07 state of every proof, keyed by proof Y (hash
   *  of secret) to defend against reordering. Throws on mint/network failure
   *  so callers can keep their existing proofs rather than risk wiping funds. */
  const checkProofStatesMap = useCallback(async (url: string, proofs: any[], seed: Uint8Array, allowForeign = false): Promise<Map<string, string>> => {
    const w = await getOrCreateWallet(url, seed, allowForeign);
    const states = await withTimeout(w.checkProofsStates(proofs), 15000, 'Check proof states');
    if (!Array.isArray(states)) {
      throw new Error('Invalid proof states response: expected array');
    }
    if (states.length !== proofs.length) {
      throw new Error(`Proof state length mismatch: expected ${proofs.length}, got ${states.length}`);
    }
    const stateMap = new Map<string, string>();
    for (const s of states) {
      if (!s || typeof s !== 'object' || typeof s.Y !== 'string' || !VALID_PROOF_STATES.has(s.state)) {
        throw new Error(`Invalid proof state entry: ${JSON.stringify(s)}`);
      }
      stateMap.set(s.Y, s.state);
    }
    return stateMap;
  }, [getOrCreateWallet]);

  /** Drop proofs whose mint-reported state fails the predicate. */
  const filterProofsByState = (proofs: any[], stateMap: Map<string, string>, keep: (state: string) => boolean): any[] => {
    const encoder = new TextEncoder();
    return proofs.filter((p) => {
      if (!p || typeof p !== 'object' || typeof p.secret !== 'string') return false;
      const Y = hashToCurve(encoder.encode(String(p.secret))).toHex(true);
      const state = stateMap.get(Y);
      if (!state) {
        throw new Error(`Missing state for proof with secret ${String(p.secret).slice(0, 20)}`);
      }
      return keep(state);
    });
  };

  /** Drop proofs that the mint reports as already spent.
   *  Pass allowForeign only where the mint URL came from an explicitly
   *  processed token/nutzap (receiveToken/receiveNutzap) — the foreign wallet
   *  load there already succeeded, and re-deriving allowance would throw
   *  'Mint URL is not allowed' AFTER the mint committed the swap. */
  const filterUnspentProofs = useCallback(async (url: string, proofs: any[], seed: Uint8Array, allowForeign = false): Promise<any[]> => {
    if (!proofs.length) return [];
    const stateMap = await checkProofStatesMap(url, proofs, seed, allowForeign);
    return filterProofsByState(proofs, stateMap, (state) => state !== 'SPENT');
  }, [checkProofStatesMap]);

  /** STRICTLY spendable proofs: only UNSPENT. Melt-locked (PENDING) proofs
   *  must never be merged into the spendable store — an in-flight melt can
   *  still settle, at which point they are SPENT at the mint. Used by every
   *  melt-input restore path. */
  const filterSpendableProofs = useCallback(async (url: string, proofs: any[], seed: Uint8Array, allowForeign = false): Promise<any[]> => {
    if (!proofs.length) return [];
    const stateMap = await checkProofStatesMap(url, proofs, seed, allowForeign);
    return filterProofsByState(proofs, stateMap, (state) => state === 'UNSPENT');
  }, [checkProofStatesMap]);

  // ─── NIP-60 / NIP-61 helpers ─────────────────────────────────────────────────

  const getClientTag = useCallback((): string[] => {
    return ['client', config.clientName ?? config.appName ?? '2140'];
  }, [config.clientName, config.appName]);

  const getNip60WalletSigner = useCallback(() => {
    // BAO demo wallets sign with the key recovered from bao.markets' published
    // config so both apps converge on the same NIP-60 author. Without a
    // cross-app key there is nothing to publish (bao.markets could not read
    // events signed by our locally-derived key), so return null and skip.
    const key = isBaoNamespaceRef.current
      ? crossAppWalletKeyRef.current
      : nip60WalletKeyRef.current;
    if (!key) return null;
    return createNip60Signer(key.privkey);
  }, []);

  const syncNip60TokenForMint = useCallback(async (
    mintUrl: string,
    direction: 'in' | 'out',
    amount: number,
    referencedEvents?: Array<{ id: string; marker: 'created' | 'destroyed' }>,
  ): Promise<NostrEvent | undefined> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner) return;

    const normalized = normalizeMintUrl(mintUrl);
    if (!normalized) return;

    // BAO demo wallets sync against the BAO relay (where bao.markets reads);
    // main wallets use the app's relay pool.
    const queryTokens = isBaoNamespaceRef.current && sync.queryRelays
      ? (filter: Parameters<NonNullable<Nip60SyncApi['queryRelays']>>[1]) => sync.queryRelays!([BAO_MARKETS_RELAY], filter)
      : sync.query;
    const publishEvent = isBaoNamespaceRef.current && sync.publishToRelays
      ? (event: NostrEvent) => sync.publishToRelays!([BAO_MARKETS_RELAY], event)
      : sync.publish;

    try {
      const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
      const lastEventId = await loadLastTokenEventId(normalized, encKey);
      const delIds = new Set<string>();
      if (lastEventId) delIds.add(lastEventId);

      // Replace every remote token event for this mint, not just the last local
      // one. Otherwise stale events from other devices or restores stay on relays
      // and converge back into the wallet as duplicate/spent proofs.
      let remoteHasProofs = false;
      let remoteQueryFailed = false;
      try {
        const remoteEvents = await queryTokens({ kinds: [TOKEN_KIND], authors: [walletSigner.pubkey], limit: 500 });
        for (const ev of remoteEvents) {
          const content = await parseTokenEvent(ev, walletSigner);
          if (content && content.mint === normalized) {
            if (ev.id !== lastEventId) delIds.add(ev.id);
            if (content.proofs.length > 0) remoteHasProofs = true;
          }
        }
      } catch (e) {
        devLog.warn('Failed to query remote token events for sync:', normalized, e);
        remoteQueryFailed = true;
      }

      // Never replace a remote backup that still holds proofs with an empty
      // local store. On a fresh device (or after a partial relay failure
      // during startup restore) the local store is empty while the relay copy
      // holds the mint's only proofs — publishing here would delete that
      // backup (replaceable event + del refs + NIP-09) and burn the ecash.
      // An empty publish has no backup value anyway, so also skip it when the
      // remote state is unknown. A stale proof-bearing event left behind is
      // harmless: restores verify spent-state with the mint before merging.
      if (proofs.length === 0 && (remoteHasProofs || remoteQueryFailed)) {
        devLog.warn('Skipping NIP-60 token publish: local store empty but remote backup state has proofs or is unknown for mint:', normalized);
        return undefined;
      }

      const delArray = [...delIds].filter((id) => id.length === 64);
      const payload = { mint: normalized, unit: 'sat' as const, proofs, del: delArray.length > 0 ? delArray : undefined };
      const hash = computeContentHash(payload);
      const lastHash = await loadLastTokenEventHash(normalized, encKey);
      if (hash === lastHash) return;

      const tokenEvent = await buildTokenEvent(normalized, proofs, walletSigner, delArray.length > 0 ? delArray : undefined, [getClientTag()]);
      if (!tokenEvent) {
        devLog.warn('Failed to build NIP-60 token event for mint:', normalized);
        return undefined;
      }
      const publishedId = await publishEvent(tokenEvent);
      if (!publishedId) {
        devLog.warn('NIP-60 token event publish failed for mint:', normalized);
        return undefined;
      }

      if (delArray.length > 0) {
        const deletion = await buildDeletionEvent(delArray, walletSigner, 'spent', [getClientTag()]);
        if (deletion) await publishEvent(deletion).catch(() => {});
      }

      const historyRefs: Array<{ id: string; marker: 'created' | 'destroyed' }> = [
        ...(referencedEvents ?? []),
        { id: tokenEvent.id, marker: 'created' },
      ];
      if (lastEventId) historyRefs.push({ id: lastEventId, marker: 'destroyed' });
      const history = await buildHistoryEvent(direction, amount, normalized, walletSigner, historyRefs, [getClientTag()]);
      if (history) await publishEvent(history).catch(() => {});

      await saveLastTokenEventId(normalized, tokenEvent.id, encKey);
      await saveLastTokenEventHash(normalized, hash, encKey);
      return tokenEvent;
    } catch (e) {
      devLog.error('NIP-60 token sync failed for mint:', normalized, e);
      return undefined;
    }
  }, [getClientTag, getNip60WalletSigner]);

  const syncAllNip60Tokens = useCallback(async (): Promise<void> => {
    const sync = nip60SyncRef.current;
    if (!sync || !getNip60WalletSigner()) return;
    for (const m of allMintsRef.current) {
      await syncNip60TokenForMint(m.url, 'in', 0);
    }
  }, [getNip60WalletSigner, syncNip60TokenForMint]);

  const syncNip60WalletConfig = useCallback(async (): Promise<void> => {
    if (options?.publishWalletConfig === false) return;
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const key = nip60WalletKeyRef.current;
    if (!sync || !encKey || !key) return;

    try {
      const mints = allMintsRef.current.map((m) => m.url);
      const payload = buildWalletConfigPayload(key.privkey, mints);
      const baoConfig = baoWalletConfigRef.current;
      const configs = baoConfig ? [payload, baoConfig] : payload;
      const hash = computeContentHash(configs);
      const lastHash = await loadLastWalletConfigHash(encKey);
      if (hash === lastHash) return;

      const event = await buildWalletConfigEvent(configs, sync.signer, { extraTags: [getClientTag()] });
      if (!event) return;
      const id = await sync.publish(event);
      if (id) await saveLastWalletConfigHash(hash, encKey);
    } catch (e) {
      devLog.error('NIP-60 wallet config sync failed:', e);
    }
  }, [getClientTag, options?.publishWalletConfig]);

  const publishNip60NutzapInfo = useCallback(async (): Promise<void> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const key = nip60WalletKeyRef.current;
    if (!sync || !encKey || !key) return;

    try {
      const mints = allMintsRef.current.map((m) => m.url);
      const hash = computeContentHash({ pubkey: key.pubkey, mints, relays: sync.relays });
      const lastHash = await loadLastNutzapInfoHash(encKey);
      if (hash === lastHash) return;

      const event = await buildNutzapInfoEvent(mints, sync.relays, key.pubkey, sync.signer, { extraTags: [getClientTag()] });
      if (!event) return;
      const id = await sync.publish(event);
      if (id) await saveLastNutzapInfoHash(hash, encKey);
    } catch (e) {
      devLog.error('NIP-60 Nutzap info publish failed:', e);
    }
  }, [getClientTag]);

  const calculateAllBalances = useCallback(async (_seed?: Uint8Array, overrideEncKey?: CryptoKey) => {
    const encKey = encKeyRef.current;
    // Use an explicitly passed key when called before the encKey state has been
    // committed (e.g. during initial seed setup), otherwise fall back to the
    // current key/ref to avoid stale closures.
    const activeKey = overrideEncKey ?? encKey;
    if (!activeKey) return;
    const version = ++balanceVersionRef.current;

    const perMint: Record<string, number> = {};
    let total = 0;

    // Read-only balance calculation: intentionally NOT inside withProofLock.
    // The lock serializes writes; reads may be momentarily stale but never
    // corrupt, and wrapping reads would deadlock with write operations that
    // call calculateAllBalances at the end. We accept this trade-off for
    // responsiveness; balances are advisory and proofs are the source of truth.
    for (const m of allMints) {
      try {
        const normalized = safeNormalizeMintUrl(m.url);
        const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, activeKey, legacyEncKeyRef.current ?? undefined));
        const bal = proofs.reduce((sum: number, p: any) => {
          const amt = Number(p.amount);
          return sum + (Number.isInteger(amt) && amt > 0 ? amt : 0);
        }, 0);
        perMint[normalized] = bal;
        total += bal;
      } catch {
        perMint[safeNormalizeMintUrl(m.url)] = 0;
      }
    }

    // Only apply if no newer calculation has started
    if (version === balanceVersionRef.current && mountedRef.current) {
      setBalances(perMint);
      setTotalBalance(total);
    }
  }, [allMints]);

  const restoreFromNip60 = useCallback(async (): Promise<boolean> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner) return false;

    try {
      const restored = await restoreNip60Wallet(walletSigner, sync.signer, sync.query);
      if (!restored.config) return false;

      // Merge remote proofs PER MINT, never gated on the global store state.
      // Local state stays authoritative: the merge is a union of local proofs
      // with remote proofs the mint reports UNSPENT (deduped by secret), so
      // nothing local is ever removed or contradicted. The old global gate
      // ("merge only when the ENTIRE local store is empty") silently skipped
      // every mint once any single mint held one local proof — a mint whose
      // balance existed only on the relay was never restored on this device.
      const seed = bip39SeedRef.current;
      if (seed) {
        await storageRef.current.withProofLock(async () => {
          for (const [mint, remoteProofs] of Object.entries(restored.proofsByMint)) {
            const normalized = normalizeMintUrl(mint);
            if (!normalized || remoteProofs.length === 0) continue;
            try {
              const unspent = sanitizeProofs(dedupeProofs(await filterUnspentProofs(normalized, remoteProofs, seed)));
              if (unspent.length === 0) continue;
              const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              const merged = dedupeProofs([...existing, ...unspent]);
              await storageRef.current.saveProofsForMint(normalized, merged, encKey);
            } catch (e) {
              devLog.warn('Failed to merge remote NIP-60 proofs for mint:', normalized, e);
            }
          }
        });
        await calculateAllBalances();
      }

      // Adopt any mints from the remote config that we do not already know.
      // BAO demo wallets are pinned to the configured signet mint.
      if (restored.config.mints.length > 0 && !storageNamespaceRef.current.startsWith('freedomid_bao_')) {
        const known = new Set(allMintsRef.current.map((m) => safeNormalizeMintUrl(m.url)));
        const newMints = restored.config.mints.filter((m) => !known.has(m));
        if (newMints.length > 0) {
          const valid = newMints.filter((m) => isAllowedMintUrl(m));
          if (valid.length > 0) {
            const existing = await storageRef.current.loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined);
            const merged = dedupeByKey(
              [...existing, ...valid.map((url) => ({ name: url, url }))],
              (m) => safeNormalizeMintUrl(m.url),
            );
            setCustomMints(merged);
            await storageRef.current.saveCustomMints(merged, encKey);
          }
        }
      }
      return true;
    } catch (e) {
      devLog.error('NIP-60 restore failed:', e);
      return false;
    }
  }, [getNip60WalletSigner, calculateAllBalances, filterUnspentProofs]);

  /**
   * BAO demo wallet only: recover the NIP-60 wallet bao.markets published for
   * this identity on the BAO relay, and merge its proofs into the local BAO
   * wallet. bao.markets derives its wallet key from the nsec (unavailable to
   * NIP-07 logins) and publishes only to relay.bao.network (deliberately not
   * an app relay), so the standard restore path can never see it. Instead we
   * read the identity-signed kind:17375 config on the BAO relay, recover the
   * wallet key from it (works with any NIP-44 signer), and pull the foreign
   * wallet's token events.
   *
   * Merging is always-on (not just when local is empty): bao.markets may
   * credit the wallet between sessions (faucet claims, trade wins). Dedup by
   * proof secret + mint-side spent verification keep this idempotent.
   *
   * The recovered key is stored in crossAppWalletKeyRef and adopted as this
   * wallet's NIP-60 signing key, so spends in this app publish token events
   * under the same author bao.markets reads — balances converge both ways.
   */
  const restoreFromBaoMarkets = useCallback(async (): Promise<boolean> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    if (!sync?.queryRelays || !encKey) return false;

    try {
      const queryBao = (filter: Parameters<NonNullable<Nip60SyncApi['queryRelays']>>[1]) =>
        sync.queryRelays!([BAO_MARKETS_RELAY], filter);
      const { result, walletPrivkey, walletPubkey } = await restoreCrossAppNip60Wallet(sync.signer, queryBao);
      if (!result.config || !walletPrivkey || !walletPubkey) return false;

      crossAppWalletKeyRef.current = { privkey: walletPrivkey, pubkey: walletPubkey };

      const seed = bip39SeedRef.current;
      const mintEntries = Object.entries(result.proofsByMint);
      if (mintEntries.length > 0 && seed) {
        await storageRef.current.withProofLock(async () => {
          for (const [mint, remoteProofs] of mintEntries) {
            // bao.markets may address the mint via the API proxy path; both
            // URLs are the same backend, so fold aliases into one logical mint.
            const normalized = normalizeMintUrl(resolveMintAlias(mint));
            if (!normalized || remoteProofs.length === 0) continue;
            try {
              const unspent = sanitizeProofs(dedupeProofs(await filterUnspentProofs(normalized, remoteProofs, seed)));
              if (unspent.length === 0) continue;
              const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              const merged = dedupeProofs([...existing, ...unspent]);
              if (merged.length !== existing.length) {
                await storageRef.current.saveProofsForMint(normalized, merged, encKey);
              }
            } catch (e) {
              devLog.warn('Failed to merge bao.markets NIP-60 proofs for mint:', normalized, e);
            }
          }
        });
        await calculateAllBalances();
      }
      return true;
    } catch (e) {
      devLog.error('bao.markets NIP-60 restore failed:', e);
      return false;
    }
  }, [calculateAllBalances, filterUnspentProofs]);

  const initWallet = useCallback(async (seed: Uint8Array, encKeyOverride?: CryptoKey) => {
    const nonce = ++initNonceRef.current;
    try {
      if (mountedRef.current) setLoading(true);
      if (mountedRef.current) setError('');
      try {
        const w = await getOrCreateWallet(mintUrl, seed);
        try {
          const allowedUrls = allMintsRef.current.map((m) => m.url);
          const info = await withTimeout(
            new CashuMint(mintUrl, createMintFetch(allowedUrls) as ConstructorParameters<typeof CashuMint>[1]).getInfo(),
            15000,
            'Mint info',
          );
          if (mountedRef.current && nonce === initNonceRef.current) setMintInfo(info);
        } catch (e) {
          devLog.warn('Mint info failed:', e);
          if (mountedRef.current && nonce === initNonceRef.current) setMintInfo({ name: 'Unknown Mint', nuts: {} });
        }
        if (mountedRef.current && nonce === initNonceRef.current) {
          setWallet(w);
          await calculateAllBalances(undefined, encKeyOverride);
        }
      } catch (err: any) {
        devLog.error('Failed to initialize wallet for mint:', mintUrl, err);
        // Try fallback mints
        const fallback = allMintsRef.current.find(m => safeNormalizeMintUrl(m.url) !== safeNormalizeMintUrl(mintUrl));
        if (fallback) {
          try {
            const w = await getOrCreateWallet(fallback.url, seed);
            await withTimeout(w.loadMint(), 15000, 'Mint load');
            if (mountedRef.current && nonce === initNonceRef.current) {
              setWallet(w);
              setMintUrlState(safeNormalizeMintUrl(fallback.url));
              devLog.log('Fell back to mint:', fallback.url);
            }
            return;
          } catch (fallbackErr) {
            devLog.error('Fallback mint also failed:', fallback.url, fallbackErr);
          }
        }
        if (mountedRef.current && nonce === initNonceRef.current) {
          setWallet(null);
          setError('Failed to connect to mint. Please try a different mint.');
        }
      }
    } catch (err: any) {
      devLog.error('Wallet init error:', err);
      if (mountedRef.current && nonce === initNonceRef.current) {
        setError(`Failed to connect to mint: ${err.message}`);
        setWallet(null);
      }
    } finally {
      if (mountedRef.current && nonce === initNonceRef.current) setLoading(false);
    }
  }, [mintUrl, getOrCreateWallet, calculateAllBalances]);

  const reconcileProofRecovery = useCallback(async () => {
    const encKey = encKeyRef.current;
    if (!encKey || !wallet) return;
    try {
      // Mints with an unresolved pending melt: their melt-input journal is
      // the input snapshot, deliberately kept until the quote resolves
      // (payInvoice/payBolt12 PENDING branch). Reconciling it early would
      // resurrect melt-locked inputs into the store (mints report them PENDING
      // under NUT-07, not SPENT) or clear it, losing the inputs if the quote
      // later resolves UNPAID. restoreMeltInputProofs owns these journals.
      const pendingMeltMints = new Set<string>();
      let txLoadFailed = false;
      try {
        const txs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
        for (const t of txs) {
          if (t.type === 'melt' && t.status === 'pending' && typeof t.quoteId === 'string' && t.quoteId.length > 0) {
            pendingMeltMints.add(safeNormalizeMintUrl(t.mintUrl));
          }
        }
      } catch (e) {
        // If transactions can't be read, skip ALL proof-recovery journals this
        // run — clearing a kept melt journal loses money, skipping is safe.
        txLoadFailed = true;
        devLog.warn('Could not load transactions for reconcile; skipping proof-recovery journals:', e);
      }

      for (const m of allMints) {
        const normalized = safeNormalizeMintUrl(m.url);

        const reconcileRecovery = async (
          load: () => Promise<RecoveryEntry | null>,
          clear: (mint: string) => void,
          label: string,
          spendableOnly = false,
          strictUnspent = false,
        ) => {
          const recovered = await load();
          if (!recovered || recovered.proofs.length === 0) return;
          devLog.warn(`Recovered ${label} for mint`, normalized);
          try {
            const seed = bip39SeedRef.current;
            const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
            const storeTs = readProofStoreTimestamp(normalized, storageNamespaceRef.current);
            if (existing.length > 0 && recovered.timestamp <= storeTs) {
              devLog.warn(`${label} is older than store, clearing stale recovery:`, normalized);
              clear(normalized);
              return;
            }
            // Send-recovery journals can hold proofs P2PK-locked to someone
            // else (a crash between mint commit and token delivery). Those
            // are unspendable by us — merging them would inflate the balance
            // and poison future sends. Restore only what we can actually
            // spend; leave foreign-locked proofs in the journal as a
            // recovery artifact for manual/tooling export.
            const candidates = spendableOnly ? recovered.proofs.filter(isSpendableProof) : recovered.proofs;
            if (candidates.length === 0) {
              devLog.warn(`${label} contains only foreign-locked proofs, leaving journal untouched:`, normalized);
              return;
            }
            // Melt-input journals can hold proofs the mint still reports
            // PENDING (melt-locked, payment in flight). Those must NOT enter
            // the spendable store — put them back in the journal instead.
            let stillLocked: any[] = [];
            let candidatesToMerge = candidates;
            if (strictUnspent && seed) {
              const spendable = await filterSpendableProofs(normalized, candidates, seed);
              const spendableSecrets = new Set(spendable.map((p) => String(p?.secret)));
              stillLocked = candidates.filter((p: any) => !spendableSecrets.has(String(p?.secret)));
              candidatesToMerge = spendable;
              if (candidatesToMerge.length === 0) {
                devLog.warn(`${label} contains only mint-locked (PENDING) proofs, leaving journal untouched:`, normalized);
                return;
              }
            }
            const merged = dedupeByKey([...existing, ...candidatesToMerge], (p) => String(p?.secret));
            const canonical = seed ? sanitizeProofs(await filterUnspentProofs(normalized, merged, seed)) : sanitizeProofs(merged);
            await storageRef.current.withProofLock(async () => {
              const current = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              const latest = dedupeByKey([...current, ...canonical], (p) => String(p?.secret));
              await storageRef.current.saveProofsForMint(normalized, latest, encKey);
              storageRef.current.writeProofStoreTimestamp(normalized);
              if (stillLocked.length > 0) {
                await storageRef.current.writeMeltInputRecovery(normalized, stillLocked, encKey);
              } else {
                clear(normalized);
              }
            });
          } catch (e) {
            devLog.error(`Failed to reconcile ${label}:`, e);
            // Keep existing store and recovery journal; retry later.
          }
        };

        await reconcileRecovery(() => storageRef.current.loadProofRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), storageRef.current.clearProofRecovery, 'proof recovery');
        await reconcileRecovery(() => storageRef.current.loadSendRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), storageRef.current.clearSendRecovery, 'send recovery', true);
        await reconcileRecovery(() => storageRef.current.loadMeltChangeRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), storageRef.current.clearMeltChangeRecovery, 'melt change recovery');
        // Melt-input journals are owned by the melt poll / restoreMeltInputProofs
        // while a melt is pending — reconcile them only once no pending melt
        // remains for the mint (leftover from a restore that failed mid-way).
        // Strict: mint-locked (PENDING) inputs stay journaled, never spendable.
        if (!txLoadFailed && !pendingMeltMints.has(normalized)) {
          await reconcileRecovery(() => storageRef.current.loadMeltInputRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), storageRef.current.clearMeltInputRecovery, 'melt input recovery', false, true);
        }
      }
      await calculateAllBalances();
    } catch (e) {
      devLog.error('Proof recovery reconciliation failed:', e);
    }
  }, [wallet, allMints, calculateAllBalances, filterUnspentProofs, filterSpendableProofs, isSpendableProof]);

  // Keep the reconciliation callback reachable from timeout handlers.
  useEffect(() => {
    reconcileProofRecoveryRef.current = reconcileProofRecovery;
  });

  // Reconcile proof recovery effect. Declared AFTER the callback (and after
  // the ref-sync above) on purpose: the old version of this effect lived
  // earlier in the file and went through reconcileProofRecoveryRef — on the
  // wallet-set commit it invoked the PREVIOUS render's closure (wallet: null),
  // so the startup reconcile silently never ran. Call the callback directly,
  // mirroring the pending-receive effect's pattern.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey || !wallet) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reconcileProofRecovery();
    })();
    return () => { cancelled = true; };
  }, [wallet, allMints, reconcileProofRecovery]);

  const handleSeedBackupConfirm = useCallback(async () => {
    if (!seedPhraseRef.current || !seedPhraseRef.current.trim()) return;
    const trimmed = seedPhraseRef.current.trim();
    let seed: Uint8Array;
    let key: CryptoKey;
    try {
      seed = deriveMasterKey(trimmed);
      key = await deriveEncryptionKey(trimmed);
      legacyEncKeyRef.current = await deriveLegacyEncryptionKey(trimmed);
    } catch (e: any) {
      devLog.error('Invalid seed phrase:', e);
      setError('Invalid recovery phrase');
      return;
    }
    walletCacheRef.current.clear();
    lastSeedRef.current = trimmed;
    if (mountedRef.current) {
      bip39SeedRef.current = seed;
      encKeyRef.current = key;
      setShowSeedBackup(false);
      setIsNewWallet(false);
    }
    try {
      await initWallet(seed, key);
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || 'Wallet init failed after backup');
    }
    void triggerBackup();
  }, [triggerBackup, initWallet]);

  const setMintUrl = useCallback((url: string) => {
    if (typeof url !== 'string') return;
    const normalized = normalizeMintUrl(url);
    if (!normalized) return;
    const allowedUrls = allMintsRef.current.map((m) => m.url);
    if (!isAllowedMintUrl(normalized, allowedUrls)) {
      devLog.warn('Attempted to select a mint that is not allowed:', normalized);
      return;
    }
    setMintUrlState(normalized);
    void triggerBackup();
  }, [triggerBackup]);

  const addCustomMint = useCallback((name: string, url: string) => {
    if (typeof name !== 'string' || typeof url !== 'string') {
      setError('Invalid mint data');
      return;
    }
    const normalized = normalizeMintUrl(url);
    if (!normalized || !name.trim()) return;
    // Validate URL: only HTTPS is allowed; HTTP and non-HTTP(S) schemes are rejected.
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'https:') {
        setError('Mint URL must use HTTPS');
        return;
      }
      if (!isAllowedMintUrl(normalized)) {
        setError('Mint host is not allowed (localhost/private networks are blocked)');
        return;
      }
    } catch {
      setError('Invalid mint URL');
      return;
    }
    // Length limits
    if (normalized.length > 2000) {
      setError('Mint URL too long');
      return;
    }
    if (name.trim().length > 100) {
      setError('Mint name too long (max 100 chars)');
      return;
    }
    setCustomMints((prev) => {
      const currentAll = [...defaultMints, ...prev];
      if (currentAll.some((m) => safeNormalizeMintUrl(m.url) === normalized)) return prev;
      return [...prev, { name: name.trim(), url: normalized }];
    });
    void triggerBackup();
  }, [triggerBackup, defaultMints]);

  const removeCustomMint = useCallback((url: string) => {
    if (typeof url !== 'string') {
      setError('Invalid mint URL');
      return;
    }
    const normalized = normalizeMintUrl(url);
    if (!normalized) {
      setError('Invalid mint URL');
      return;
    }
    // Guard: default mints cannot be "removed" — they live outside customMints
    const isDefault = defaultMints.some(m => safeNormalizeMintUrl(m.url) === normalized);
    if (isDefault) {
      devLog.warn('Cannot remove default mint:', normalized);
      setError('Default mints cannot be removed');
      return;
    }
    // Guard: refuse to delete a mint that still holds ecash. Removing the mint
    // wipes its ENTIRE proof store below — with a balance that is silent,
    // unrecoverable money loss (the NIP-60 backup, if any, may be stale).
    const encKey = encKeyRef.current;
    if (!encKey) {
      setError('Wallet not initialized');
      return;
    }
    (async () => {
      // Serialize with every in-flight wallet op: a receive/pending-receive
      // retry for this mint can hold a 0-balance store for up to 60s before
      // committing, and without the mutex its finishing write would silently
      // re-create a store for a mint already dropped from allMints — stranded
      // ecash that no balance/backup/reconcile pass ever iterates.
      const release = await acquireMutex(walletOpsMutexRef);
      try {
        // Re-check the balance INSIDE the mutex (the guard is meaningless as
        // a TOCTOU read outside any serialization).
        const storedProofs = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
        const storedBalance = sumProofAmounts(storedProofs);
        if (storedBalance > 0) {
          setError(`Mint still holds ${storedBalance} sats — spend or sweep them before removing it. Removing the mint deletes its ecash.`);
          return;
        }
        // Drop any pending-receive entries referencing this mint so the
        // background reconciler cannot resurrect an orphaned store after the
        // removal.
        try {
          const pendingKeys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(`${storageNamespaceRef.current}receive_pending_`)) pendingKeys.push(k);
          }
          for (const k of pendingKeys) {
            try {
              const tokenHash = atob(k.slice((storageNamespaceRef.current + 'receive_pending_').length));
              const entry = await storageRef.current.loadPendingReceive(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
              if (entry && entry.mintUrls.some((u) => safeNormalizeMintUrl(u) === normalized)) {
                storageRef.current.clearPendingReceive(tokenHash);
              }
            } catch { /* ignore malformed entries */ }
          }
        } catch { /* storage unavailable */ }
        setCustomMints((prev) => prev.filter(m => safeNormalizeMintUrl(m.url) !== normalized));
        void triggerBackup();
        // Evict cached wallet for this mint
        walletCacheRef.current.delete(normalized);
        // Clean up stored proofs and recovery for this mint under the proof lock
        try {
          await storageRef.current.withProofLock(async () => {
            const key = storageRef.current.mintStorageKey(normalized);
            localStorage.removeItem(key);
            storageRef.current.clearProofRecovery(normalized);
            storageRef.current.clearSendRecovery(normalized);
            storageRef.current.clearMeltInputRecovery(normalized);
            storageRef.current.clearMeltChangeRecovery(normalized);
          });
        } catch (e) {
          devLog.error('Failed to clean up mint storage:', e);
        }
        // Remove balance entry for deleted mint so UI doesn't show stale data
        setBalances((prev) => {
          const updated = { ...prev };
          Object.keys(updated).forEach((k) => {
            if (safeNormalizeMintUrl(k) === normalized) delete updated[k];
          });
          return updated;
        });
        // If the currently-selected mint was removed, switch to the first available mint
        if (safeNormalizeMintUrl(mintUrl) === normalized) {
          const fallback = allMints.find(m => safeNormalizeMintUrl(m.url) !== normalized);
          if (fallback) {
            setMintUrlState(safeNormalizeMintUrl(fallback.url));
          } else {
            setMintUrlState('');
            setWallet(null);
          }
        }
      } catch (e) {
        devLog.error('Failed to remove custom mint:', e);
        setError('Failed to remove mint');
      } finally {
        release();
      }
    })();
  }, [mintUrl, allMints, triggerBackup, defaultMints]);

  const refreshTransactions = useCallback(async () => {
    const encKey = encKeyRef.current;
    const txs = await storageRef.current.loadTransactions(encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
    if (mountedRef.current) setTransactions(txs);
  }, []);

  const receiveToken = useCallback(async (tokenStr: string, privkey?: string): Promise<number> => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    if (typeof tokenStr !== 'string' || tokenStr.trim().length === 0) {
      setError('Invalid Cashu token');
      return 0;
    }
    if (!wallet || !bip39Seed || !encKey) {
      setError('Wallet not initialized');
      return 0;
    }

    // Serialize the entire receive flow for a given token.
    const release = await acquireReceiveTokenLock();
    try {
      setLoading(true);
      setError('');

      const decodedEntries = decodeCashuToken(tokenStr);
      if (!decodedEntries || decodedEntries.length === 0) {
        throw new Error('Invalid Cashu token');
      }

      const tokenHash = hashDecodedToken(decodedEntries);

      // Defend against double-credit both within this session and across restarts.
      if (processedTokenHashesRef.current.has(tokenHash) || await storageRef.current.isProcessedTokenHash(tokenHash, encKey, legacyEncKeyRef.current ?? undefined)) {
        devLog.warn('Token already processed, skipping:', tokenHash);
        storageRef.current.clearPendingReceive(tokenHash);
        if (mountedRef.current) setSuccessTimed('Token already received');
        return 0;
      }

      const errors: string[] = [];

      // Group token entries by mint. CashuWallet.receive only processes the
      // first entry in a multi-entry token, so we build a single-entry token
      // per mint and receive each one independently.
      const grouped = new Map<string, { mintUrl: string; proofs: any[] }>();
      for (const entry of decodedEntries) {
        if (!entry.mintUrl) {
          errors.push('Token entry missing mint URL');
          devLog.error('Token entry missing mint URL:', entry);
          continue;
        }
        const normalized = safeNormalizeMintUrl(entry.mintUrl);
        const existing = grouped.get(normalized);
        if (existing) {
          existing.proofs.push(...entry.proofs);
        } else {
          grouped.set(normalized, { mintUrl: entry.mintUrl, proofs: [...entry.proofs] });
        }
      }

      // Load any prior partial-receive progress so we can skip mints that
      // already succeeded and avoid an infinite retry loop.
      const existingPending = await storageRef.current.loadPendingReceive(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
      const succeededMintUrls = new Set(existingPending?.succeededMintUrls ?? []);
      const groupedEntries = Array.from(grouped.values());
      const pendingMintUrls = groupedEntries.map((e) => safeNormalizeMintUrl(e.mintUrl)).filter(Boolean);
      const pendingAmount = groupedEntries.reduce((sum, e) => sum + sumProofAmounts(e.proofs), 0);
      await storageRef.current.writePendingReceive(tokenStr, tokenHash, pendingMintUrls, pendingAmount, encKey, [...succeededMintUrls]);

      let totalReceived = 0;
      for (const [normalized, entry] of grouped) {
        if (succeededMintUrls.has(normalized)) continue;
        let entryToken: string;
        try {
          // Re-encoding decoded proofs: witnesses arrive as JSON strings and
          // MUST be parsed back to objects or the serializer double-encodes
          // them and the mint rejects the operator's escrow signature.
          entryToken = getEncodedToken({ mint: normalized, proofs: entry.proofs.map(normalizeProofWitnessForEncode), unit: 'sat' });
        } catch (encodeErr) {
          errors.push('Invalid token entry');
          devLog.error('Failed to encode token entry:', encodeErr);
          continue;
        }
        try {
          const normalizedMintUrl = normalizeMintUrl(mintUrl);
          const targetWallet = normalized === normalizedMintUrl
            ? wallet
            : await withTimeout(getOrCreateWallet(normalized, bip39Seed, true), 15000, 'Foreign mint load');

          const received = await storageRef.current.withProofLock(async () => {
            const existingProofs = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
            const tokenAmount = sumProofAmounts(entry.proofs);
            const received = await withTimeout(
              targetWallet.receive(entryToken, { proofsWeHave: existingProofs, requireDleq: true, privkey }),
              60000,
              'Receive',
              () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
            );
            let receivedProofs = sanitizeProofs(received ?? []);
            // Journal the fresh proofs IMMEDIATELY — the mint has already spent
            // the token's inputs and issued these outputs. Every validation and
            // network call below can throw or time out, and without this journal
            // the outputs would exist nowhere durable (the pending-receive retry
            // re-sends the ORIGINAL token, which the mint now rejects as spent).
            if (receivedProofs.length > 0) {
              await storageRef.current.writeProofRecovery(normalized, receivedProofs, encKey);
            }
            let maxExpectedFee = 0;
            try {
              maxExpectedFee = targetWallet.getFeesForProofs(entry.proofs);
            } catch {
              maxExpectedFee = Math.max(1, Math.floor(tokenAmount * 0.001));
            }
            if (!isFeeWithinMaxPpm(maxExpectedFee, tokenAmount, MAX_MINT_FEE_PPM)) {
              throw new Error('Mint fee exceeds maximum allowed');
            }
            const receivedSum = sumProofAmounts(receivedProofs);
            const actualFee = tokenAmount - receivedSum;
            if (actualFee < 0 || actualFee > maxExpectedFee) {
              throw new Error('Mint returned received proofs with incorrect total amount');
            }
            // Verify the mint did not return malformed, duplicate, or spent proofs.
            const activeKeysetIds = new Set(targetWallet.keysets.filter((k) => k.active).map((k) => k.id));
            const validation = validateReceivedProofs(receivedProofs, {
              activeKeysetIds,
              localSecrets: new Set(existingProofs.map((p) => String(p?.secret))),
              getKeyset: (id) => targetWallet.keys.get(id),
              requireDleq: true,
            });
            if (!validation.valid) {
              throw new Error(validation.reason);
            }
            // Ask the mint to drop any spent proofs. If the mint lies and claims a
            // returned proof is already spent, we reject the whole entry — a honest
            // mint should never return spent outputs from a fresh receive.
            const unspent = await withTimeout(
              filterUnspentProofs(normalized, receivedProofs, bip39Seed, true),
              15000,
              'Check received proof states',
            );
            if (unspent.length !== receivedProofs.length) {
              throw new Error('Mint returned spent proofs');
            }
            receivedProofs = sanitizeProofs(unspent);
            const allProofs = dedupeProofs([...existingProofs, ...receivedProofs]);
            // Write recovery with merged proofs before save
            await storageRef.current.writeProofRecovery(normalized, allProofs, encKey);
            // Verify this tab still holds the cross-tab lock before committing.
            await storageRef.current.assertProofLockOwnership();
            await storageRef.current.saveProofsForMint(normalized, allProofs, encKey);
            storageRef.current.writeProofStoreTimestamp(normalized);
            storageRef.current.clearProofRecovery(normalized);
            await calculateAllBalances();

            // Record the transaction while still holding the proof lock.
            // Both locks are held in the documented order: proof first, then tx.
            // If transaction recording fails, the proof update stays committed
            // (the mint has already issued the proofs) and the operation is
            // surfaced as failed.
            const receivedAmount = Array.isArray(received)
              ? received.reduce((sum: number, p: any) => sum + (Number.isInteger(p?.amount) ? p.amount : 0), 0)
              : 0;
            await storageRef.current.withTxLock(async () => {
              await storageRef.current.addTransaction({
                type: 'receive',
                amount: receivedAmount,
                memo: 'Cashu token',
                mintUrl: normalized,
                status: 'completed',
              }, encKey, legacyEncKeyRef.current ?? undefined);
            });
            await refreshTransactions();
            await syncNip60TokenForMint(normalized, 'in', receivedAmount);
            succeededMintUrls.add(normalized);
            await storageRef.current.writePendingReceive(tokenStr, tokenHash, pendingMintUrls, pendingAmount, encKey, [...succeededMintUrls]);
            return received;
          });

          const receivedAmount = Array.isArray(received)
            ? received.reduce((sum: number, p: any) => sum + (Number.isInteger(p?.amount) ? p.amount : 0), 0)
            : 0;
          totalReceived += receivedAmount;

          // Do not auto-add foreign mints from tokens without explicit user
          // confirmation. Warn when a token references a mint not in the
          // user's allowed list.
          if (normalized !== normalizedMintUrl) {
            const userAllowed = allMintsRef.current.map((m) => safeNormalizeMintUrl(m.url));
            if (!userAllowed.includes(normalized)) {
              devLog.warn('Received token references a mint not in the allowed list:', normalized);
            }
          }

        } catch (entryErr: any) {
          errors.push(entryErr?.message || 'Failed to receive from mint');
          devLog.error('Failed to receive token entry:', entry.mintUrl, entryErr);
          // A failure AFTER the mint swapped (fee/validation/state check above)
          // means fresh output proofs were journaled for this mint but not yet
          // persisted to its store. If the mint is outside the configured list,
          // the startup reconcile would NEVER look at its journal (it iterates
          // allMints) and the pending-receive retry fails forever (the mint
          // already spent the token's inputs) — the sats would be stranded.
          // Adopt the mint so recovery can complete and the balance is visible.
          const userAllowed = allMintsRef.current.map((m) => safeNormalizeMintUrl(m.url));
          if (!userAllowed.includes(normalized) && isAllowedMintUrl(normalized)) {
            devLog.warn('Adopting foreign mint after post-swap receive failure so its recovery journal is reconciled:', normalized);
            try {
              const hostname = (() => { try { return new URL(normalized).hostname; } catch { return normalized; } })();
              const stored = await storageRef.current.loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined);
              if (!stored.some((m) => safeNormalizeMintUrl(m.url) === normalized)) {
                const next = [...stored, { name: hostname, url: normalized, custom: true }];
                setCustomMints(next);
                await storageRef.current.saveCustomMints(next, encKey);
              }
            } catch (adoptErr) {
              devLog.warn('Failed to adopt foreign mint for recovery:', adoptErr);
            }
          }
        }
      }

      const allEntriesSucceeded = grouped.size > 0 && succeededMintUrls.size === grouped.size;
      if (allEntriesSucceeded) {
        processedTokenHashesRef.current.add(tokenHash);
        try {
          await storageRef.current.addProcessedTokenHash(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
        } catch (e) {
          devLog.warn('Failed to persist processed token hash:', e);
          // Do not fail the receive; the in-memory guard still protects this session.
        }
        storageRef.current.clearPendingReceive(tokenHash);
      }

      if (mountedRef.current) {
        if (errors.length > 0 && totalReceived === 0) {
          setError(`Failed to receive: ${errors[0]}`);
        } else if (errors.length > 0) {
          setSuccessTimed(`Received ${totalReceived} sats (some mints failed)`);
        } else {
          setSuccessTimed(`Received ${totalReceived} sats`);
        }
      }
      return totalReceived;
    } catch (err: any) {
      devLog.error('Receive error:', err);
      if (mountedRef.current) setError(`Failed to receive: ${err.message}`);
      return 0;
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, getOrCreateWallet, filterUnspentProofs, syncNip60TokenForMint]);

  // Keep a ref to the latest receiveToken so reconciliation effects can call it
  // without creating dependency cycles.
  useEffect(() => {
    receiveTokenRef.current = receiveToken;
  }, [receiveToken]);

  const validateAmount = (amount: number): string | null => {
    if (!Number.isInteger(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) {
      return 'Amount must be a positive integer';
    }
    return null;
  };

  const sendToken = useCallback(async (amount: number, memo = '', recipientPubkey?: string, mintUrlOverride?: string, escrowLock?: MultisigEscrowLockRequest): Promise<string | null> => {
    lastSendAmbiguousRef.current = false;
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    const err = validateAmount(amount);
    if (err) { setError(err); return null; }
    if (typeof memo !== 'string') { setError('Memo must be a string'); return null; }
    if (memo.length > 500) { setError('Memo too long (max 500 chars)'); return null; }
    if (escrowLock && recipientPubkey) {
      setError('Cannot combine a single-recipient lock with a multisig escrow lock');
      return null;
    }
    if (!bip39Seed || !encKey) {
      setError('Wallet not initialized');
      return null;
    }
    const activeMint = safeNormalizeMintUrl(mintUrlOverride ?? mintUrl);
    let targetWallet = wallet;
    if (mintUrlOverride) {
      try {
        targetWallet = await getOrCreateWallet(activeMint, bip39Seed, true);
      } catch (e: any) {
        setError(`Failed to load mint wallet: ${e.message}`);
        return null;
      }
    }
    if (!targetWallet) {
      setError('Wallet not initialized');
      return null;
    }
    const release = await acquireMutex(walletOpsMutexRef);
    // Tracks whether the mint swap/send request may have been sent, so the
    // catch can classify ambiguous failures (see lastSendAmbiguousRef).
    let swapAttempted = false;
    try {
      setLoading(true);
      setError('');

      const token = await storageRef.current.withProofLock(async () => {
        const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(activeMint, encKey, legacyEncKeyRef.current ?? undefined));
        const available = proofs.reduce((sum, p) => {
          const amt = Number(p.amount);
          return sum + (Number.isInteger(amt) && amt > 0 ? amt : 0);
        }, 0);
        if (available < amount) {
          throw new Error(`Insufficient balance: ${available} sats available`);
        }

        // Pre-write input proofs as crash recovery. If the app is killed after the mint
        // marks them spent but before we persist the change, the reconciliation loop
        // will ask the mint for spent-state rather than blindly restoring this snapshot.
        const normalizedMint = activeMint;
        await storageRef.current.writeProofRecovery(normalizedMint, proofs, encKey);
        const sendOpts: import('@cashu/cashu-ts').SendOptions = { proofsWeHave: proofs };
        if (recipientPubkey) {
          // NUT-11 specifies a 33-byte compressed pubkey in the P2PK data
          // field. Mirror sendNutzap's normalization exactly: 64-char x-only
          // gets the '02' prefix (strict mints reject raw x-only at swap
          // time — which would lock the sats with no refund path), 66-char
          // compressed passes as-is, and anything else fails LOUDLY. The
          // previous length===64 check silently skipped the lock for 66-char
          // kind-10019 pubkeys — sending a bearer token while the UI claimed
          // "P2PK-locked".
          const pk = recipientPubkey.toLowerCase();
          const lockKey = /^[0-9a-f]{64}$/.test(pk) ? '02' + pk
            : /^0[23][0-9a-f]{64}$/.test(pk) ? pk
            : null;
          if (!lockKey) throw new Error('Invalid recipient P2PK pubkey');
          sendOpts.pubkey = lockKey;
          sendOpts.includeDleq = true;
        }
        // Structured (multisig) escrow locks MUST go through wallet.swap, not
        // wallet.send: send() only forces the mint-swap path for a narrow set
        // of options and IGNORES `p2pk` entirely — passing it there with
        // exact-match proofs takes the offline path and silently hands back a
        // BEARER token while the UI claims "locked". swap() always hits the
        // mint, always builds outputs through the p2pk branch, and does its
        // own input selection (unselected inputs come back in `keep`, which
        // the F1 check below already tolerates).
        // buildMultisigEscrowLock throws on any invalid key/locktime — before
        // the mint is called and the wallet is debited.
        const multisigP2pk = escrowLock ? buildMultisigEscrowLock(escrowLock) : null;
        // From here on the request may reach the mint: a failure past this
        // point without an HTTP status (timeout, dropped connection, or a
        // post-commit validation throw below) is AMBIGUOUS — the mint may
        // have spent the inputs. Failures before it (local proof selection
        // inside cashu-ts, lock validation above) never touched the mint.
        swapAttempted = true;
        const sendResult = await withTimeout(
          multisigP2pk
            ? targetWallet.swap(amount, proofs, { proofsWeHave: proofs, p2pk: multisigP2pk })
            : targetWallet.send(amount, proofs, sendOpts),
          60000,
          'Send',
          () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
        );
        if (!sendResult || !Array.isArray(sendResult.send) || !Array.isArray(sendResult.keep)) {
          throw new Error('Mint returned invalid send response');
        }
        const sendProofs = sanitizeProofs(dedupeProofs(sendResult.send));
        const keepProofs = sanitizeProofs(dedupeProofs(sendResult.keep));
        // Persist keep AND send proofs for crash recovery immediately after
        // the send is prepared, before any further validation or async work.
        // The send proofs exist only in memory until the caller delivers the
        // token — a crash in between would burn the payment. Cleared below
        // once the token is encoded.
        await storageRef.current.writeProofRecovery(normalizedMint, keepProofs, encKey);
        if (sendProofs.length > 0) {
          await storageRef.current.writeSendRecovery(normalizedMint, sendProofs, encKey);
        }
        const inputAmount = available;
        const outputAmount = sumProofAmounts(sendProofs) + sumProofAmounts(keepProofs);
        if (sumProofAmounts(sendProofs) !== amount) {
          throw new Error('Mint returned send proofs with incorrect total amount');
        }
        if (outputAmount > inputAmount) {
          throw new Error('Mint returned invalid proofs: outputs exceed inputs');
        }
        // Compute the maximum fee from the keyset and enforce both conservation
        // and a hard ppm cap. The actual fee must be non-negative and not exceed
        // the fee the mint itself advertised.
        let maxFee = 0;
        try {
          maxFee = targetWallet.getFeesForProofs(proofs);
        } catch {
          maxFee = Math.max(1, Math.floor(inputAmount * 0.001));
        }
        if (!isFeeWithinMaxPpm(maxFee, inputAmount, MAX_MINT_FEE_PPM)) {
          throw new Error('Mint fee exceeds maximum allowed');
        }
        const actualFee = inputAmount - outputAmount;
        if (actualFee < 0 || actualFee > maxFee) {
          throw new Error('Mint returned invalid proofs: fee exceeds reported fee');
        }
        // Reject only if a SEND proof bears an input secret outside the
        // offline no-swap path. cashu-ts takes the offline path when the
        // exact amount is selectable and no pubkey/output options are set —
        // it returns the input proofs unchanged as {send, keep} without
        // calling the mint. That is a legitimate bearer send (ecash changes
        // hands by handing over the proofs themselves), so accept it.
        // In the SWAP path (any locked send, or a non-exact bearer send) all
        // outputs are constructed client-side from mint signatures over
        // client-generated blinded messages — the mint CANNOT choose output
        // secrets — and cashu-ts passes the UNSELECTED input proofs through
        // verbatim in keep (swap(): { keep: [...freshChange, ...unselected] }).
        // An input secret among the keep proofs is therefore normal and the
        // proof is still unspent; rejecting it here threw on every legitimate
        // swap send AFTER the mint had already committed the spend.
        const inputSecrets = new Set(proofs.map((p) => String(p.secret)));
        const isOfflineNoSwap = !sendOpts.pubkey && sendProofs.length > 0
          && sendProofs.every((p) => inputSecrets.has(String(p.secret)))
          && keepProofs.every((p) => inputSecrets.has(String(p.secret)));
        if (!isOfflineNoSwap) {
          for (const p of sendProofs) {
            if (inputSecrets.has(String(p.secret))) {
              throw new Error('Mint returned unspent input proofs as send outputs');
            }
          }
        }

        // Save keep proofs (so user doesn't lose their change). Crash recovery
        // was already written immediately after the mint returned the outputs.
        // Verify this tab still holds the cross-tab lock before committing.
        await storageRef.current.assertProofLockOwnership();
        await storageRef.current.saveProofsForMint(normalizedMint, keepProofs, encKey);
        storageRef.current.writeProofStoreTimestamp(normalizedMint);
        // Proofs are persisted — clear the recovery journal
        storageRef.current.clearProofRecovery(normalizedMint);

        // Build token string — if this throws, proofs are already safe in storage
        let tokenStr: string;
        try {
          tokenStr = getEncodedToken({ mint: normalizedMint, proofs: sendProofs, memo, unit: 'sat' });
        } catch (encodeErr) {
          devLog.error('Token encoding failed — saving recovery data:', encodeErr);
          // Save send proofs to a deterministic recovery key so they can be reconciled
          // on next load. The change (keepProofs) is already in storage.
          try {
            await storageRef.current.writeSendRecovery(normalizedMint, sendProofs, encKey);
          } catch { /* best effort */ }
          throw new Error('Failed to encode token — your proofs have been saved for recovery');
        }
        // Encoding succeeded — clear any prior send-recovery for this mint.
        storageRef.current.clearSendRecovery(normalizedMint);

        // Record the transaction while still holding the proof lock. Both locks
        // are held in the documented order: proof first, then tx. We cannot roll
        // back the spent proofs (the token has already been issued by the mint),
        // so if recording fails we surface the error but still return the token.
        try {
          await storageRef.current.withTxLock(async () => {
            await storageRef.current.addTransaction({
              type: 'send',
              amount,
              memo: memo || 'Cashu send',
              mintUrl: activeMint,
              status: 'completed',
            }, encKey, legacyEncKeyRef.current ?? undefined);
          });
          await refreshTransactions();
        } catch (e) {
          devLog.error('Failed to record send transaction:', e);
          if (mountedRef.current) setError('Send succeeded but transaction record failed');
        }

        await calculateAllBalances();
        return tokenStr;
      });

      await syncNip60TokenForMint(activeMint, 'out', amount);

      // Return token immediately — proof update and tx recording are complete.
      if (mountedRef.current) setSuccessTimed(`Sent ${amount} sats`);

      return token;
    } catch (err: any) {
      devLog.error('Send error:', err);
      // Classify the failure for callers with an automatic retry. RETRY-SAFE
      // (definitive): the mint explicitly rejected — cashu-ts HttpResponseError/
      // MintOperationError carries a numeric status — or the failure never
      // reached the mint (pre-swap validation, local "not enough funds"
      // selection inside cashu-ts). AMBIGUOUS: anything else past the swap
      // call — a timeout or dropped connection (the mint may have committed
      // after we stopped waiting) and every post-commit validation throw
      // above (the inputs ARE spent; the send proofs sit in the recovery
      // journal). A blind retry after an ambiguous failure double-spends
      // from the remaining proofs and burns the first attempt's sats.
      const httpStatus = typeof err?.status === 'number' ? err.status : null;
      const localSelection = typeof err?.message === 'string' && /not enough (funds|balance)/i.test(err.message);
      lastSendAmbiguousRef.current = swapAttempted && httpStatus === null && !localSelection;
      // A timeout is ambiguous: the mint may have processed the swap after we
      // stopped waiting, in which case the inputs ARE spent and the send/change
      // proofs only existed in the dropped response. Say so explicitly instead
      // of a bare "try again" that invites a double-send — the recovery
      // journal (scheduled on timeout) restores the inputs only if the mint
      // never spent them.
      const timedOut = typeof err?.message === 'string' && err.message.includes('timed out');
      if (mountedRef.current) {
        setError(timedOut
          ? 'Send timed out — the mint may still have processed it. Check your balance before sending again; if it decreased, the recovery journal will reconcile automatically.'
          : `Failed to send: ${err.message}`);
      }
      return null;
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
      // Cleanup legacy recovery entries that used the old prefix. Current
      // per-mint recovery keys are bounded by the number of mints and are
      // cleared explicitly on success, so we leave them intact.
      (() => {
        try {
          const toRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(storageNamespaceRef.current + 'recovery_')) toRemove.push(k);
          }
          for (const k of toRemove) {
            try { localStorage.removeItem(k); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      })();
    }
  }, [wallet, mintUrl, getOrCreateWallet, triggerBackup, calculateAllBalances, refreshTransactions, syncNip60TokenForMint]);

  const sendLockedToken = useCallback(async (amount: number, recipientPubkey: string, memo = '', mintUrlOverride?: string): Promise<string | null> => {
    // Accept x-only (64) and compressed (66) pubkeys — kind-10019 info events
    // advertise both forms. sendToken does the final normalization/locking.
    const pk = recipientPubkey?.toLowerCase() ?? '';
    if (!/^[0-9a-f]{64}$/.test(pk) && !/^0[23][0-9a-f]{64}$/.test(pk)) {
      setError('Invalid recipient P2PK pubkey');
      return null;
    }
    return sendToken(amount, memo, recipientPubkey, mintUrlOverride);
  }, [sendToken]);

  const sendMultisigLockedToken = useCallback(async (amount: number, lock: MultisigEscrowLockRequest, memo = '', mintUrlOverride?: string): Promise<string | null> => {
    // Validate the lock eagerly so a misconfigured escrow fails BEFORE the
    // wallet is debited (sendToken re-validates inside the proof lock too).
    try {
      buildMultisigEscrowLock(lock);
    } catch (e: any) {
      setError(`Invalid escrow lock: ${e?.message ?? e}`);
      return null;
    }
    return sendToken(amount, memo, undefined, mintUrlOverride, lock);
  }, [sendToken]);

  const receiveLockedToken = useCallback(async (tokenStr: string, privkey: string): Promise<number> => {
    if (!privkey || privkey.length !== 64) {
      setError('Invalid P2PK private key');
      return 0;
    }
    return receiveToken(tokenStr, privkey);
  }, [receiveToken]);

  // Sweep a token locked to this wallet's own NIP-60 P2PK key (the pubkey
  // published in kind:10019). Key material stays inside the hook — callers
  // (e.g. the compute-credits redeem flow) never touch it.
  const sweepWalletLockedToken = useCallback(async (tokenStr: string): Promise<number> => {
    const key = nip60WalletKeyRef.current;
    if (!key) {
      setError('Set up your Cashu wallet first — no wallet key to sweep locked tokens');
      return 0;
    }
    return receiveToken(tokenStr, bytesToHex(key.privkey));
  }, [receiveToken]);

  const getWalletP2pkPubkey = useCallback((): string | null => nip60WalletKeyRef.current?.pubkey ?? null, []);

  const requestInvoice = useCallback(async (amount: number, description = 'Freedom ID'): Promise<MintQuoteResponse | null> => {
    const encKey = encKeyRef.current;
    const err = validateAmount(amount);
    if (err) { setError(err); return null; }
    if (typeof description !== 'string') {
      setError('Description must be a string');
      return null;
    }
    if (description.length > 10000) {
      setError('Description too long (max 10000 chars)');
      return null;
    }
    if (!wallet || !encKey) {
      setError('Wallet not initialized');
      return null;
    }
    try {
      setLoading(true);
      setError('');
      const quote = await withTimeout(wallet.createMintQuote(amount, description), 30000, 'Mint quote creation');
      if (mountedRef.current) setSuccessTimed('Invoice created. Pay it to receive sats.', 4000);

      // Record the pending invoice transaction under the tx lock. There is no
      // proof update here, so the tx lock alone is sufficient for atomicity.
      try {
        await storageRef.current.withTxLock(async () => {
          await storageRef.current.addTransaction({
            type: 'mint',
            amount,
            memo: 'Lightning deposit',
            mintUrl,
            status: 'pending',
            quoteId: quote.quote,
            expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
          }, encKey || undefined, legacyEncKeyRef.current ?? undefined);
        });
        await refreshTransactions();
      } catch (e) {
        devLog.error('Failed to record invoice transaction:', e);
        if (mountedRef.current) setError('Invoice created but transaction record failed');
      }

      return quote;
    } catch (err: any) {
      if (mountedRef.current) setError(`Failed to create invoice: ${err.message}`);
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, refreshTransactions]);

  const mintFromQuote = useCallback(async (quoteId: string, amount: number) => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    const err = validateAmount(amount);
    if (err) { setError(err); return; }
    if (!quoteId || typeof quoteId !== 'string') {
      setError('Invalid quote ID');
      return;
    }
    if (!wallet || !encKey || !bip39Seed) {
      setError('Wallet not initialized');
      return;
    }
    const release = await acquireMutex(walletOpsMutexRef);
    try {
      setLoading(true);
      setError('');

      const normalizedMint = safeNormalizeMintUrl(mintUrl);

      const markPendingMint = async (status: Transaction['status'], forQuoteId: string = quoteId, forAmount: number = amount) => {
        try {
          const txs = await storageRef.current.loadTransactions(encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
          const pendingIdx = txs.findIndex(
            (t) =>
              t.type === 'mint' &&
              t.status === 'pending' &&
              t.mintUrl === mintUrl &&
              (t.quoteId === forQuoteId || (t.amount === forAmount && !t.quoteId)),
          );
          if (pendingIdx >= 0) {
            await storageRef.current.updateTransactionStatus(txs[pendingIdx].id, status, encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
            await refreshTransactions();
          }
        } catch (e) {
          devLog.error('Failed to update pending mint transaction status:', e);
        }
      };

      await storageRef.current.withProofLock(async () => {
        // Verify quote is paid inside the lock to prevent race-conditioned double-mint
        const quoteCheck = await withTimeout(
          wallet.checkMintQuote(quoteId),
          15000, 'Mint quote check'
        );
        const quoteState = quoteCheck?.state;
        if (quoteCheck && typeof quoteCheck.expiry === 'number' && quoteCheck.expiry > 0 && Date.now() > quoteCheck.expiry * 1000) {
          await markPendingMint('expired');
          throw new Error('Mint quote has expired. Create a new invoice.');
        }
        if (quoteState === 'UNPAID') {
          await markPendingMint('failed');
          throw new Error('Invoice not yet paid. Pay the invoice first, then try again.');
        }
        if (!quoteCheck || (quoteState !== 'PAID' && quoteState !== 'ISSUED')) {
          throw new Error('Payment is still being processed. Wait a moment and try again.');
        }

        const mintedQuotes = await storageRef.current.loadMintedQuotes(encKey, legacyEncKeyRef.current ?? undefined);
        if (mintedQuotes.includes(quoteId)) {
          throw new Error('This quote has already been minted');
        }

        // Recover an interrupted deterministic mint BEFORE issuing any new
        // outputs. mintProofs below uses counter-derived deterministic secrets;
        // if a previous mintProofs call consumed counter outputs at the mint
        // (crash/timeout between issue and commit), re-minting over the same
        // counter window would be rejected as duplicate blinded messages and
        // the interrupted quote's paid sats would be stranded. NUT-09 restore
        // regenerates the exact blinded messages and re-claims the signatures.
        const pendingMint = await storageRef.current.loadPendingMint(normalizedMint, encKey, legacyEncKeyRef.current ?? undefined);
        if (pendingMint && pendingMint.quoteId !== quoteId) {
          let restored: { proofs: any[] };
          try {
            restored = await withTimeout(wallet.restore(pendingMint.counterStart, 100), 60000, 'Recover interrupted mint');
          } catch (restoreErr: any) {
            throw new Error(`A previous mint from this wallet was interrupted and could not be recovered (${restoreErr?.message ?? 'restore failed'}). Try again once the mint is reachable.`);
          }
          const restoredProofs = sanitizeProofs(restored?.proofs ?? []);
          if (restoredProofs.length > 0) {
            const existingProofs = sanitizeProofs(await storageRef.current.getProofsForMint(normalizedMint, encKey, legacyEncKeyRef.current ?? undefined));
            const mergedProofs = sanitizeProofs(dedupeProofs([...existingProofs, ...restoredProofs]));
            await storageRef.current.saveProofsForMint(normalizedMint, mergedProofs, encKey);
            storageRef.current.writeProofStoreTimestamp(normalizedMint);
            await storageRef.current.writeMintedQuote(pendingMint.quoteId, encKey);
            await markPendingMint('completed', pendingMint.quoteId, pendingMint.amount);
          }
          // Advance the counter past the scanned window whether or not proofs
          // came back — deterministic secrets in the window must never be
          // reused (if the mint consumed them, it rejects duplicates).
          const currentCounter = await storageRef.current.loadMintCounter(normalizedMint);
          await storageRef.current.saveMintCounter(normalizedMint, Math.max(currentCounter, pendingMint.counterStart + 100));
          await storageRef.current.clearPendingMint(normalizedMint);
        }

        let newProofs: any[];
        let recoveredViaRestore = false;
        if (quoteState === 'ISSUED') {
          // The mint already issued this quote's outputs but we never persisted
          // them (crash/timeout between mintProofs and commit). Re-minting
          // would be rejected — recover the outputs via NUT-09 restore from
          // the journaled counter window (or the current counter for legacy
          // journals that predate deterministic minting).
          const restoreStart = pendingMint && pendingMint.quoteId === quoteId
            ? pendingMint.counterStart
            : await storageRef.current.loadMintCounter(normalizedMint);
          const restored = await withTimeout(wallet.restore(restoreStart, 100), 60000, 'Restore issued proofs');
          newProofs = sanitizeProofs(restored?.proofs ?? []);
          if (newProofs.length === 0) {
            await markPendingMint('failed');
            throw new Error('This quote was already issued by the mint, but the proofs could not be recovered. Contact support with your quote ID.');
          }
          recoveredViaRestore = true;
          const currentCounter = await storageRef.current.loadMintCounter(normalizedMint);
          await storageRef.current.saveMintCounter(normalizedMint, Math.max(currentCounter, restoreStart + 100));
          await storageRef.current.clearPendingMint(normalizedMint);
        } else {
          const counterStart = await storageRef.current.loadMintCounter(normalizedMint);
          // Journal the quote + counter window BEFORE minting so a crash
          // between the mint issuing outputs and our commit is recoverable
          // via the restore path above.
          await storageRef.current.writePendingMint(normalizedMint, { quoteId, counterStart, amount, timestamp: Date.now() }, encKey);
          newProofs = await withTimeout(
            wallet.mintProofs(amount, quoteId, { counter: counterStart }),
            60000,
            'Mint proofs',
            () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
          );
          if (!Array.isArray(newProofs) || newProofs.length === 0) {
            throw new Error('Mint returned no proofs');
          }
          // The mint consumed these counter outputs — advance the counter even
          // if a validation step below throws, so the secrets are never reused.
          await storageRef.current.saveMintCounter(normalizedMint, counterStart + newProofs.length);
        }
        // The mint has issued the proofs and the quote is consumed (NUT-04
        // rejects re-minting it). Record the quote as minted and journal the
        // fresh proofs IMMEDIATELY — every validation and network call below
        // can throw or time out, and without this the paid Lightning sats
        // would be stuck with no app-level recovery path.
        await storageRef.current.writeMintedQuote(quoteId, encKey);
        await storageRef.current.writeProofRecovery(normalizedMint, sanitizeProofs(newProofs), encKey);
        const mintedAmount = sumProofAmounts(newProofs);
        if (!recoveredViaRestore && mintedAmount !== amount) {
          throw new Error('Mint returned proofs with incorrect total amount');
        }
        const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalizedMint, encKey, legacyEncKeyRef.current ?? undefined));
        // Verify the mint did not return malformed, duplicate, or spent proofs.
        const activeKeysetIds = new Set(wallet.keysets.filter((k) => k.active).map((k) => k.id));
        const validation = validateReceivedProofs(newProofs, {
          activeKeysetIds,
          localSecrets: new Set(existing.map((p) => String(p?.secret))),
          getKeyset: (id) => wallet.keys.get(id),
          requireDleq: true,
        });
        if (!validation.valid) {
          throw new Error(validation.reason);
        }
        // Ask the mint to drop any spent proofs. A honest mint should never
        // return spent outputs from a fresh mint, so reject the whole result if
        // any are spent.
        const unspent = await withTimeout(
          filterUnspentProofs(normalizedMint, newProofs, bip39Seed),
          15000,
          'Check minted proof states',
        );
        if (unspent.length !== newProofs.length) {
          throw new Error('Mint returned spent proofs');
        }
        newProofs = sanitizeProofs(unspent);
        // (quote already recorded as minted + proofs journaled right after the
        // mint returned them — see above)
        const merged = sanitizeProofs(dedupeProofs([...existing, ...newProofs]));
        await storageRef.current.writeProofRecovery(normalizedMint, merged, encKey);
        // Verify this tab still holds the cross-tab lock before committing.
        await storageRef.current.assertProofLockOwnership();
        await storageRef.current.saveProofsForMint(normalizedMint, merged, encKey);
        storageRef.current.writeProofStoreTimestamp(normalizedMint);
        storageRef.current.clearProofRecovery(normalizedMint);
        await storageRef.current.clearPendingMint(normalizedMint);

        // Record the completed mint transaction while still holding the proof
        // lock. Both locks are held in the documented order: proof first, then
        // tx. If recording fails, the proof update stays committed and the
        // operation is surfaced as failed.
        await storageRef.current.withTxLock(async () => {
          const txs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const pendingIdx = txs.findIndex(
            (t) =>
              t.type === 'mint' &&
              t.status === 'pending' &&
              t.mintUrl === mintUrl &&
              (t.quoteId === quoteId || (t.amount === mintedAmount && !t.quoteId)),
          );
          if (pendingIdx >= 0) {
            await storageRef.current.updateTransactionStatus(txs[pendingIdx].id, 'completed', encKey, legacyEncKeyRef.current ?? undefined);
          } else {
            await storageRef.current.addTransaction(
              { type: 'mint', amount: mintedAmount, memo: 'Lightning deposit', mintUrl, status: 'completed', quoteId },
              encKey,
              legacyEncKeyRef.current ?? undefined
            );
          }
        });
        await refreshTransactions();

        await calculateAllBalances();
      });

      await syncNip60TokenForMint(safeNormalizeMintUrl(mintUrl), 'in', amount);

      if (mountedRef.current) setSuccessTimed(`${amount} sats minted successfully!`);
    } catch (err: any) {
      if (mountedRef.current) setError(`Mint failed: ${err.message}`);
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, syncNip60TokenForMint, filterUnspentProofs]);

  const payInvoice = useCallback(async (invoice: string): Promise<{ success: boolean; amount: number; preimage?: string; pending?: boolean; quote?: MeltQuoteResponse }> => {
    const trimmedInvoice = typeof invoice === 'string' ? invoice.trim() : '';
    if (!trimmedInvoice || trimmedInvoice.length < 10 || trimmedInvoice.length > 10000 || !trimmedInvoice.toLowerCase().startsWith('ln')) {
      setError('Invalid Lightning invoice');
      return { success: false, amount: 0 };
    }
    if (!wallet || !encKeyRef.current) {
      setError('Wallet not initialized');
      return { success: false, amount: 0 };
    }
    const release = await acquireMutex(walletOpsMutexRef);
    try {
      setLoading(true);
      setError('');

      const { amount: paidAmount, preimage, quote, state } = await storageRef.current.withProofLock(async () => {
        const quote = await withTimeout(wallet.createMeltQuote(invoice), 30000, 'Melt quote creation');
        const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(safeNormalizeMintUrl(mintUrl), encKeyRef.current!, legacyEncKeyRef.current ?? undefined));
        const available = proofs.reduce((sum, p) => {
          const amt = Number(p.amount);
          return sum + (Number.isInteger(amt) && amt > 0 ? amt : 0);
        }, 0);
        const quoteAmount = Number(quote.amount) || 0;
        const feeReserve = Number(quote.fee_reserve) || 0;
        const totalNeeded = quoteAmount + feeReserve;

        if (available < totalNeeded) {
          throw new Error(`Need ${totalNeeded} sats (inc. fee), have ${available}`);
        }
        // Only sign inputs for a fresh, unpaid melt quote.
        const quoteState = quote.state;
        if (quoteState && quoteState !== 'UNPAID') {
          throw new Error(`Melt quote is not available: ${quoteState}`);
        }
        if (!isFeeWithinMaxPpm(feeReserve, available, MAX_MINT_FEE_PPM)) {
          throw new Error('Melt fee reserve exceeds maximum allowed');
        }

        // Select only the proofs needed for the invoice amount plus fee reserve
        // rather than exposing the entire proof set to the mint.
        const normalizedMint = safeNormalizeMintUrl(mintUrl);
        // The melt-input recovery journal is a single slot per mint. Starting a
        // second melt while a previous one is still resolving (pending tx or a
        // live journal) would overwrite that journal and strand the first
        // melt's input proofs. Refuse until the poll/restore resolves it.
        try {
          const existingTxs = await storageRef.current.loadTransactions(encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          const pendingMelt = existingTxs.some(
            (t) => t.type === 'melt' && t.status === 'pending' && safeNormalizeMintUrl(t.mintUrl) === normalizedMint,
          );
          if (pendingMelt) {
            throw new Error('Another payment from this mint is still resolving — wait for it to finish before paying again.');
          }
          const existingMeltJournal = await storageRef.current.loadMeltInputRecovery(normalizedMint, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          if (existingMeltJournal && existingMeltJournal.proofs.length > 0) {
            throw new Error('A previous payment from this mint is still resolving — wait for it to finish before paying again.');
          }
        } catch (guardErr: any) {
          if (typeof guardErr?.message === 'string' && guardErr.message.includes('still resolving')) throw guardErr;
          devLog.warn('Pending-melt guard check failed; proceeding:', guardErr);
        }
        const selection = wallet.selectProofsToSend(proofs, totalNeeded, true);
        const selectedProofs = sanitizeProofs(dedupeProofs(selection.send));
        const unselectedProofs = sanitizeProofs(dedupeProofs(selection.keep));
        const inputAmount = sumProofAmounts(selectedProofs);
        if (inputAmount < totalNeeded) {
          throw new Error(`Selected proofs insufficient: need ${totalNeeded}, selected ${inputAmount}`);
        }

        // Validate the melt quote fee against the selected inputs.
        let maxFeeForSelected = 0;
        try {
          maxFeeForSelected = wallet.getFeesForProofs(selectedProofs);
        } catch {
          maxFeeForSelected = Math.max(1, Math.floor(inputAmount * 0.001));
        }
        if (!isFeeWithinMaxPpm(feeReserve, inputAmount, MAX_MINT_FEE_PPM)) {
          throw new Error('Melt fee reserve exceeds maximum allowed for selected proofs');
        }
        if (feeReserve > maxFeeForSelected) {
          throw new Error(`Melt fee reserve (${feeReserve}) exceeds fee for selected proofs (${maxFeeForSelected})`);
        }

        // Pre-write selected input proofs as crash recovery. If the app is killed after the mint
        // marks them spent but before we persist the change, the reconciliation loop
        // will ask the mint for spent-state rather than blindly restoring this snapshot.
        // Kept in the dedicated melt-input slot so no later wallet op can overwrite it
        // while the quote is unresolved.
        await storageRef.current.writeMeltInputRecovery(normalizedMint, selectedProofs, encKeyRef.current!);
        // Record a pending melt tx so the pending-melt poll resolves the quote
        // and the reconcile guard keeps protecting the input journal — without
        // the tx, reconcile treats the journal as an orphaned recovery and the
        // single-slot guard refuses every later melt from this mint. Needed on
        // ANY failure after meltProofs was called (melt error OR post-commit
        // validation throw): the outcome is unknown either way. The poll
        // resolves every case: UNPAID → inputs restored, journal cleared;
        // PAID → journaled (spent) inputs removed from the store.
        const recordPendingMeltTx = async () => {
          try {
            await storageRef.current.withTxLock(async () => {
              await storageRef.current.addTransaction({
                type: 'melt',
                amount: quoteAmount,
                memo: 'Lightning payment (outcome unknown — resolving)',
                mintUrl,
                status: 'pending',
                quoteId: quote.quote,
                expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
              }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
            });
          } catch (txErr) {
            devLog.error('Failed to record pending melt tx:', txErr);
          }
        };
        let meltResult: Awaited<ReturnType<typeof wallet.meltProofs>>;
        try {
          meltResult = await withTimeout(
            wallet.meltProofs(quote, selectedProofs),
            60000,
            'Melt proofs',
          );
        } catch (meltErr) {
          // The melt's outcome is UNKNOWN (timeout, lost response, mint error):
          // the mint may have spent the inputs.
          await recordPendingMeltTx();
          throw meltErr;
        }
        // Post-commit validation. Integrity FIRST: DLEQ-validated change is
        // real money, journaled immediately so a later economic-check throw
        // cannot strand it. Economics SECOND. Any throw here records the
        // pending tx — the outcome is as unknown as after a melt error, and
        // skipping the tx bricked all future melts from this mint (hunt r8).
        let changeProofs: any[];
        try {
          if (!meltResult || !Array.isArray(meltResult.change)) {
            throw new Error('Mint returned invalid melt response');
          }
          changeProofs = sanitizeProofs(dedupeProofs(meltResult.change));
          // Verify the mint did not return malformed or duplicate change proofs.
          const activeKeysetIds = new Set(wallet.keysets.filter((k) => k.active).map((k) => k.id));
          const localSecrets = new Set([...selectedProofs, ...unselectedProofs].map((p) => String(p?.secret)));
          const validation = validateReceivedProofs(changeProofs, {
            activeKeysetIds,
            localSecrets,
            getKeyset: (id) => wallet.keys.get(id),
            requireDleq: true,
          });
          if (!validation.valid) {
            throw new Error(`Invalid change proofs: ${validation.reason}`);
          }
          // Persist change for crash recovery immediately after validation.
          if (changeProofs.length > 0) {
            await storageRef.current.writeMeltChangeRecovery(normalizedMint, changeProofs, encKeyRef.current!);
          }
          const changeAmount = sumProofAmounts(meltResult.change);
          if (changeAmount > inputAmount - quoteAmount) {
            throw new Error('Mint returned invalid change: exceeds available amount');
          }
          if (changeAmount < inputAmount - quoteAmount - feeReserve) {
            throw new Error('Mint returned invalid change: missing required amount');
          }
          const actualFee = inputAmount - changeAmount - quoteAmount;
          if (actualFee < 0 || actualFee > feeReserve || actualFee > maxFeeForSelected || !isFeeWithinMaxPpm(actualFee, inputAmount, MAX_MINT_FEE_PPM)) {
            throw new Error('Mint returned invalid melt fee');
          }
        } catch (postMeltErr) {
          await recordPendingMeltTx();
          throw postMeltErr;
        }
        // Verify this tab still holds the cross-tab lock before committing any
        // post-melt store writes below.
        await storageRef.current.assertProofLockOwnership();

        const state = meltResult.quote?.state;
        const paidAmount = Number(quote.amount) || 0;

        // Record the melt transaction while still holding the proof lock. Both
        // locks are held in the documented order: proof first, then tx. The
        // mint has already accepted or rejected the payment, so on tx failure
        // we surface the error but still return the payment result.
        const recordMeltTx = async () => {
          try {
            await storageRef.current.withTxLock(async () => {
              if (state === 'UNPAID') {
                await storageRef.current.addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment (failed)',
                  mintUrl,
                  status: 'failed',
                  quoteId: quote.quote,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else if (state === 'PENDING') {
                await storageRef.current.addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment (pending)',
                  mintUrl,
                  status: 'pending',
                  quoteId: quote.quote,
                  expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else if (state === 'PAID') {
                await storageRef.current.addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment',
                  mintUrl,
                  status: 'completed',
                  quoteId: quote.quote,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else {
                // Unknown state — treat as pending to be safe.
                await storageRef.current.addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment (pending)',
                  mintUrl,
                  status: 'pending',
                  quoteId: quote.quote,
                  expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              }
            });
            await refreshTransactions();
          } catch (e) {
            devLog.error('Failed to record melt transaction:', e);
            if (mountedRef.current) setError('Payment result recorded but transaction record failed');
          }
        };

        if (state === 'UNPAID') {
          // Mint did not spend the invoice: selected input proofs are still unspent.
          // Restore them from the recovery snapshot and merge with the unselected
          // proofs that were never exposed to the mint. If we cannot verify
          // spent-state, leave the journal in place for a later retry.
          const recoveredEntry = await storageRef.current.loadMeltInputRecovery(normalizedMint, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          if (recoveredEntry && recoveredEntry.proofs.length > 0) {
            const seed = bip39SeedRef.current;
            if (!seed) {
              throw new Error('Wallet seed is not available');
            }
            let recovered = recoveredEntry.proofs;
            let stillLocked: any[] = [];
            try {
              // Strict UNSPENT-only filter: PENDING proofs stay journaled
              // rather than being merged back into the spendable store.
              const spendable = await filterSpendableProofs(normalizedMint, recovered, seed);
              const spendableSecrets = new Set(spendable.map((p) => String(p?.secret)));
              stillLocked = sanitizeProofs(recovered.filter((p: any) => !spendableSecrets.has(String(p?.secret))));
              recovered = spendable;
            } catch (e) {
              devLog.warn('Could not verify unspent state during melt UNPAID recovery; keeping existing store:', normalizedMint, e);
              // Keep input recovery journal in place for a later retry.
              await calculateAllBalances();
              await recordMeltTx();
              return {
                quote,
                amount: paidAmount,
                preimage: meltResult.quote?.payment_preimage || undefined,
                state,
              };
            }
            const restoredProofs = sanitizeProofs(dedupeProofs([...unselectedProofs, ...recovered]));
            await storageRef.current.assertProofLockOwnership();
            await storageRef.current.saveProofsForMint(normalizedMint, restoredProofs, encKeyRef.current!);
            storageRef.current.writeProofStoreTimestamp(normalizedMint);
            if (stillLocked.length > 0) {
              // Some inputs are still PENDING at the mint — keep them journaled
              // for the pending-melt poll instead of clearing the whole slot.
              await storageRef.current.writeMeltInputRecovery(normalizedMint, stillLocked, encKeyRef.current!);
              storageRef.current.clearMeltChangeRecovery(normalizedMint);
              await calculateAllBalances();
              await recordMeltTx();
              return {
                quote,
                amount: paidAmount,
                preimage: meltResult.quote?.payment_preimage || undefined,
                state,
              };
            }
          }
          storageRef.current.clearMeltInputRecovery(normalizedMint);
          storageRef.current.clearMeltChangeRecovery(normalizedMint);
          await calculateAllBalances();
          await recordMeltTx();
          return {
            quote,
            amount: paidAmount,
            preimage: meltResult.quote?.payment_preimage || undefined,
            state,
          };
        }

        // PAID / PENDING / unknown: selected input proofs are spent by the mint;
        // persist unselected proofs plus change.
        // Crash-recovery for the change was already written immediately after the
        // mint returned it.
        const updatedProofs = sanitizeProofs(dedupeProofs([...unselectedProofs, ...changeProofs]));
        if (state === 'PENDING' || (state !== 'PAID' && state !== 'UNPAID')) {
          // Keep the melt-input journal until the quote resolves.
          await storageRef.current.saveProofsForMint(normalizedMint, updatedProofs, encKeyRef.current!);
          storageRef.current.writeProofStoreTimestamp(normalizedMint);
          await calculateAllBalances();
          await recordMeltTx();
          return {
            quote,
            amount: paidAmount,
            preimage: meltResult.quote?.payment_preimage || undefined,
            state,
          };
        }

        // PAID: selected input proofs are spent; persist unselected + change and clear all recovery journals.
        await storageRef.current.saveProofsForMint(normalizedMint, updatedProofs, encKeyRef.current!);
        storageRef.current.writeProofStoreTimestamp(normalizedMint);
        storageRef.current.clearMeltInputRecovery(normalizedMint);
        storageRef.current.clearMeltChangeRecovery(normalizedMint);
        await calculateAllBalances();
        await recordMeltTx();
        return {
          quote,
          amount: paidAmount,
          preimage: meltResult.quote?.payment_preimage || undefined,
          state,
        };
      });

      if (state !== 'UNPAID') {
        await syncNip60TokenForMint(safeNormalizeMintUrl(mintUrl), 'out', paidAmount);
      }

      if (state === 'UNPAID') {
        if (mountedRef.current) setError('Payment failed: invoice was not paid');
        return { success: false, amount: 0, quote };
      }

      if (state === 'PENDING') {
        if (mountedRef.current) setSuccessTimed('Payment submitted — waiting for confirmation');
        return { success: true, amount: paidAmount, preimage, pending: true, quote };
      }

      if (state !== 'PAID') {
        // Unknown state — treat as pending to be safe
        devLog.warn('Unknown melt state:', state);
        if (mountedRef.current) setSuccessTimed('Payment submitted — waiting for confirmation');
        return { success: true, amount: paidAmount, preimage, pending: true, quote };
      }

      if (mountedRef.current) setSuccessTimed('Payment sent!');
      return { success: true, amount: paidAmount, preimage, quote };
    } catch (err: any) {
      devLog.error('Pay error:', err);
      if (mountedRef.current) setError(`Payment failed: ${err.message}`);
      return { success: false, amount: 0 };
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, syncNip60TokenForMint, filterSpendableProofs]);

  const payBolt12 = useCallback(async (offer: string, amountSats: number): Promise<{ success: boolean; amount: number; pending?: boolean; quote?: Bolt12MeltQuoteResponse }> => {
    const trimmedOffer = typeof offer === 'string' ? offer.trim() : '';
    if (!trimmedOffer || !/^lno1[02-9ac-hj-np-z]+$/i.test(trimmedOffer)) {
      setError('Invalid BOLT12 offer');
      return { success: false, amount: 0 };
    }
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      setError('Invalid amount');
      return { success: false, amount: 0 };
    }
    if (!wallet || !encKeyRef.current) {
      setError('Wallet not initialized');
      return { success: false, amount: 0 };
    }
    const release = await acquireMutex(walletOpsMutexRef);
    try {
      setLoading(true);
      setError('');

      const { amount: paidAmount, state, quote } = await storageRef.current.withProofLock(async () => {
        const quote = await withTimeout(
          wallet.createMeltQuoteBolt12(trimmedOffer, amountSats * 1000),
          30000,
          'BOLT12 melt quote creation',
        );
        const proofs = sanitizeProofs(await storageRef.current.getProofsForMint(safeNormalizeMintUrl(mintUrl), encKeyRef.current!, legacyEncKeyRef.current ?? undefined));
        const available = proofs.reduce((sum, p) => {
          const amt = Number(p.amount);
          return sum + (Number.isInteger(amt) && amt > 0 ? amt : 0);
        }, 0);
        const quoteAmount = Number(quote.amount) || 0;
        const feeReserve = Number(quote.fee_reserve) || 0;
        const totalNeeded = quoteAmount + feeReserve;

        if (available < totalNeeded) {
          throw new Error(`Need ${totalNeeded} sats (inc. fee), have ${available}`);
        }
        const quoteState = quote.state;
        if (quoteState && quoteState !== 'UNPAID') {
          throw new Error(`Melt quote is not available: ${quoteState}`);
        }
        if (!isFeeWithinMaxPpm(feeReserve, available, MAX_MINT_FEE_PPM)) {
          throw new Error('Melt fee reserve exceeds maximum allowed');
        }

        const normalizedMint = safeNormalizeMintUrl(mintUrl);
        // Single-slot melt-input journal: refuse to start a second melt while
        // a previous one from this mint is still resolving (see BOLT11 path).
        try {
          const existingTxs = await storageRef.current.loadTransactions(encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          const pendingMelt = existingTxs.some(
            (t) => t.type === 'melt' && t.status === 'pending' && safeNormalizeMintUrl(t.mintUrl) === normalizedMint,
          );
          if (pendingMelt) {
            throw new Error('Another payment from this mint is still resolving — wait for it to finish before paying again.');
          }
          const existingMeltJournal = await storageRef.current.loadMeltInputRecovery(normalizedMint, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          if (existingMeltJournal && existingMeltJournal.proofs.length > 0) {
            throw new Error('A previous payment from this mint is still resolving — wait for it to finish before paying again.');
          }
        } catch (guardErr: any) {
          if (typeof guardErr?.message === 'string' && guardErr.message.includes('still resolving')) throw guardErr;
          devLog.warn('Pending-melt guard check failed; proceeding:', guardErr);
        }
        const selection = wallet.selectProofsToSend(proofs, totalNeeded, true);
        const selectedProofs = sanitizeProofs(dedupeProofs(selection.send));
        const unselectedProofs = sanitizeProofs(dedupeProofs(selection.keep));
        const inputAmount = sumProofAmounts(selectedProofs);
        if (inputAmount < totalNeeded) {
          throw new Error(`Selected proofs insufficient: need ${totalNeeded}, selected ${inputAmount}`);
        }

        let maxFeeForSelected = 0;
        try {
          maxFeeForSelected = wallet.getFeesForProofs(selectedProofs);
        } catch {
          maxFeeForSelected = Math.max(1, Math.floor(inputAmount * 0.001));
        }
        if (!isFeeWithinMaxPpm(feeReserve, inputAmount, MAX_MINT_FEE_PPM)) {
          throw new Error('Melt fee reserve exceeds maximum allowed for selected proofs');
        }
        if (feeReserve > maxFeeForSelected) {
          throw new Error(`Melt fee reserve (${feeReserve}) exceeds fee for selected proofs (${maxFeeForSelected})`);
        }

        await storageRef.current.writeMeltInputRecovery(normalizedMint, selectedProofs, encKeyRef.current!);
        // Same unknown-outcome contract as the BOLT11 path: ANY failure after
        // meltProofsBolt12 was called (melt error OR post-commit validation
        // throw) must record a pending tx, or the quote never resolves and
        // the single-slot input journal bricks future melts from this mint.
        const recordPendingMeltTx = async () => {
          try {
            await storageRef.current.withTxLock(async () => {
              await storageRef.current.addTransaction({
                type: 'melt',
                amount: quoteAmount,
                memo: `BOLT12 offer ${trimmedOffer.slice(0, 20)}… (outcome unknown — resolving)`,
                mintUrl: normalizedMint,
                status: 'pending',
                quoteId: quote.quote,
                expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
                bolt12: true,
              }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
            });
          } catch (txErr) {
            devLog.error('Failed to record pending BOLT12 melt tx:', txErr);
          }
        };
        let meltResult: Awaited<ReturnType<typeof wallet.meltProofsBolt12>>;
        try {
          meltResult = await withTimeout(
            wallet.meltProofsBolt12(quote, selectedProofs),
            60000,
            'BOLT12 melt proofs',
          );
        } catch (meltErr) {
          // Outcome UNKNOWN (timeout, lost response, mint error).
          await recordPendingMeltTx();
          throw meltErr;
        }
        // Post-commit validation: integrity first (DLEQ-valid change journaled
        // immediately), economics second; any throw records the pending tx.
        let changeProofs: any[];
        try {
          if (!meltResult || !Array.isArray(meltResult.change)) {
            throw new Error('Mint returned invalid BOLT12 melt response');
          }
          changeProofs = sanitizeProofs(dedupeProofs(meltResult.change));
          const activeKeysetIds = new Set(wallet.keysets.filter((k) => k.active).map((k) => k.id));
          const localSecrets = new Set([...selectedProofs, ...unselectedProofs].map((p) => String(p?.secret)));
          const validation = validateReceivedProofs(changeProofs, {
            activeKeysetIds,
            localSecrets,
            getKeyset: (id) => wallet.keys.get(id),
            requireDleq: true,
          });
          if (!validation.valid) {
            throw new Error(`Invalid change proofs: ${validation.reason}`);
          }
          if (changeProofs.length > 0) {
            await storageRef.current.writeMeltChangeRecovery(normalizedMint, changeProofs, encKeyRef.current!);
          }
          const changeAmount = sumProofAmounts(meltResult.change);
          if (changeAmount > inputAmount - quoteAmount) {
            throw new Error('Mint returned invalid change: exceeds available amount');
          }
          if (changeAmount < inputAmount - quoteAmount - feeReserve) {
            throw new Error('Mint returned invalid change: missing required amount');
          }
          const actualFee = inputAmount - changeAmount - quoteAmount;
          if (actualFee < 0 || actualFee > feeReserve || actualFee > maxFeeForSelected || !isFeeWithinMaxPpm(actualFee, inputAmount, MAX_MINT_FEE_PPM)) {
            throw new Error('Mint returned invalid BOLT12 melt fee');
          }
        } catch (postMeltErr) {
          await recordPendingMeltTx();
          throw postMeltErr;
        }
        // Verify this tab still holds the cross-tab lock before committing any
        // post-melt store writes below.
        await storageRef.current.assertProofLockOwnership();

        const state = meltResult.quote?.state;
        const paidAmount = Number(quote.amount) || 0;

        // Persist the post-melt proof store, mirroring the BOLT11 melt path.
        // Without this the spent inputs stayed in the store (balance showed
        // money already paid out, next spend failed with spent proofs) and the
        // change only existed in the crash-recovery journal.
        if (state === 'UNPAID') {
          // Mint did not pay: selected inputs are still ours — restore them.
          const recoveredEntry = await storageRef.current.loadMeltInputRecovery(normalizedMint, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          const seed = bip39SeedRef.current;
          if (recoveredEntry && recoveredEntry.proofs.length > 0 && seed) {
            try {
              // Strict UNSPENT-only: PENDING inputs stay journaled for the poll.
              const recovered = await filterSpendableProofs(normalizedMint, recoveredEntry.proofs, seed);
              const recoveredSecrets = new Set(recovered.map((p) => String(p?.secret)));
              const stillLocked = sanitizeProofs(recoveredEntry.proofs.filter((p: any) => !recoveredSecrets.has(String(p?.secret))));
              const restoredProofs = sanitizeProofs(dedupeProofs([...unselectedProofs, ...recovered]));
              await storageRef.current.assertProofLockOwnership();
              await storageRef.current.saveProofsForMint(normalizedMint, restoredProofs, encKeyRef.current!);
              storageRef.current.writeProofStoreTimestamp(normalizedMint);
              if (stillLocked.length > 0) {
                await storageRef.current.writeMeltInputRecovery(normalizedMint, stillLocked, encKeyRef.current!);
              } else {
                storageRef.current.clearMeltInputRecovery(normalizedMint);
              }
              storageRef.current.clearMeltChangeRecovery(normalizedMint);
            } catch (e) {
              devLog.warn('Could not verify unspent state during BOLT12 UNPAID recovery; keeping journal:', normalizedMint, e);
            }
          }
        } else {
          // PAID / PENDING / unknown: selected inputs are spent by the mint;
          // persist unselected proofs plus change. Keep the melt-input
          // journal until the quote resolves PAID.
          const updatedProofs = sanitizeProofs(dedupeProofs([...unselectedProofs, ...changeProofs]));
          await storageRef.current.saveProofsForMint(normalizedMint, updatedProofs, encKeyRef.current!);
          storageRef.current.writeProofStoreTimestamp(normalizedMint);
          if (state === 'PAID') {
            storageRef.current.clearMeltInputRecovery(normalizedMint);
            storageRef.current.clearMeltChangeRecovery(normalizedMint);
          }
        }

        const recordMeltTx = async () => {
          try {
            await storageRef.current.withTxLock(async () => {
              const expiryMs = typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined;
              if (state === 'UNPAID') {
                await storageRef.current.addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: `BOLT12 offer ${trimmedOffer.slice(0, 20)}…`,
                  mintUrl: normalizedMint,
                  status: 'failed',
                  quoteId: quote.quote,
                  bolt12: true,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
                return;
              }
              const status = state === 'PAID' ? 'completed' : 'pending';
              await storageRef.current.addTransaction({
                type: 'melt',
                amount: paidAmount,
                memo: `BOLT12 offer ${trimmedOffer.slice(0, 20)}…`,
                mintUrl: normalizedMint,
                status,
                quoteId: quote.quote,
                expiresAt: expiryMs,
                bolt12: true,
              }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
            });
          } catch (e) {
            devLog.error('Failed to record BOLT12 melt tx:', e);
          }
        };

        await recordMeltTx();
        await refreshTransactions();
        await calculateAllBalances();

        return { quote, amount: paidAmount, state };
      });

      if (state !== 'UNPAID') {
        await syncNip60TokenForMint(safeNormalizeMintUrl(mintUrl), 'out', paidAmount);
      }

      if (state === 'UNPAID') {
        if (mountedRef.current) setError('Payment failed: BOLT12 offer was not paid');
        return { success: false, amount: 0, quote };
      }
      if (state === 'PENDING') {
        if (mountedRef.current) setSuccessTimed('BOLT12 payment submitted — waiting for confirmation');
        return { success: true, amount: paidAmount, quote, pending: true };
      }
      if (state !== 'PAID') {
        devLog.warn('Unknown BOLT12 melt state:', state);
        if (mountedRef.current) setSuccessTimed('BOLT12 payment submitted — waiting for confirmation');
        return { success: true, amount: paidAmount, quote, pending: true };
      }

      if (mountedRef.current) setSuccessTimed('BOLT12 payment sent!');
      return { success: true, amount: paidAmount, quote };
    } catch (err: any) {
      devLog.error('BOLT12 pay error:', err);
      if (mountedRef.current) setError(`BOLT12 payment failed: ${err.message}`);
      return { success: false, amount: 0 };
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, filterSpendableProofs, syncNip60TokenForMint]);

  const receiveNutzap = useCallback(async (event: NostrEvent): Promise<void> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner || !wallet) {
      devLog.warn('Cannot receive Nutzap: wallet or NIP-60 sync not ready');
      return;
    }
    if (processedNutzapIdsRef.current.has(event.id)) return;
    if (await storageRef.current.isProcessedNutzapId(event.id, encKey, legacyEncKeyRef.current ?? undefined)) return;

    // Share the nutzap mutex with sendNutzap so an incoming redemption can
    // never overlap a send's read-modify-write of the same proof store.
    const releaseNutzapMutex = await acquireMutex(walletOpsMutexRef);
    try {
      if (!verifyEvent(event)) {
        devLog.warn('Rejected Nutzap with invalid signature:', event.id);
        return;
      }
      const parsed = parseNutzapEvent(event);
      if (!parsed) {
        devLog.warn('Failed to parse Nutzap event:', event.id);
        return;
      }
      if (parsed.recipient !== sync.signer.pubkey) {
        devLog.warn('Nutzap recipient does not match current user:', event.id);
        return;
      }

      const normalized = normalizeMintUrl(parsed.mint);
      if (!normalized) return;
      const targetWallet = normalized === normalizeMintUrl(mintUrl)
        ? wallet
        : await withTimeout(getOrCreateWallet(normalized, bip39SeedRef.current!, true), 15000, 'Foreign mint load');

      await storageRef.current.withProofLock(async () => {
        const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
        const tokenStr = getEncodedToken({ mint: normalized, proofs: (parsed.proofs as Array<{ witness?: unknown }>).map(normalizeProofWitnessForEncode), unit: 'sat' });
        const nutzapInputProofs = sanitizeProofs(parsed.proofs);
        const nutzapInputAmount = sumProofAmounts(nutzapInputProofs);
        let maxNutzapReceiveFee = 0;
        try {
          maxNutzapReceiveFee = targetWallet.getFeesForProofs(nutzapInputProofs);
        } catch {
          maxNutzapReceiveFee = Math.max(1, Math.floor(nutzapInputAmount * 0.001));
        }
        if (!isFeeWithinMaxPpm(maxNutzapReceiveFee, nutzapInputAmount, MAX_MINT_FEE_PPM)) {
          throw new Error('Mint fee exceeds maximum allowed');
        }
        const received = await withTimeout(
          targetWallet.receive(tokenStr, {
            proofsWeHave: existing,
            privkey: bytesToHex(nip60WalletKeyRef.current!.privkey),
            requireDleq: true,
          }),
          60000,
          'Receive Nutzap',
        );
        let receivedProofs = sanitizeProofs(received ?? []);
        if (receivedProofs.length === 0) {
          throw new Error('No proofs received from Nutzap');
        }
        // Crash journal IMMEDIATELY after the mint committed: the sender's
        // proofs are already spent and these re-issued outputs exist nowhere
        // else. Every validation/network call below can throw or time out;
        // without this journal a failure here burns the nutzap silently (the
        // sender's proofs are spent, the outputs dropped).
        await storageRef.current.writeSendRecovery(normalized, receivedProofs, encKey);
        const receivedAmount = sumProofAmounts(receivedProofs);
        const nutzapActualFee = nutzapInputAmount - receivedAmount;
        if (nutzapActualFee < 0 || nutzapActualFee > maxNutzapReceiveFee) {
          throw new Error('Nutzap redemption returned incorrect amount');
        }
        const activeKeysetIds = new Set(targetWallet.keysets.filter((k) => k.active).map((k) => k.id));
        const validation = validateReceivedProofs(receivedProofs, {
          activeKeysetIds,
          localSecrets: new Set(existing.map((p) => String(p?.secret))),
          getKeyset: (id) => targetWallet.keys.get(id),
          requireDleq: true,
        });
        if (!validation.valid) {
          throw new Error(validation.reason);
        }
        const unspent = await withTimeout(filterUnspentProofs(normalized, receivedProofs, bip39SeedRef.current!, true), 15000, 'Check Nutzap proof states');
        if (unspent.length !== receivedProofs.length) {
          throw new Error('Nutzap proofs are already spent');
        }
        receivedProofs = sanitizeProofs(unspent);
        // (send-recovery journal already written right after the mint
        // returned the proofs — kept current with the filtered set)
        await storageRef.current.writeSendRecovery(normalized, receivedProofs, encKey);
        const merged = dedupeProofs([...existing, ...receivedProofs]);
        // Verify this tab still holds the cross-tab lock before committing.
        await storageRef.current.assertProofLockOwnership();
        await storageRef.current.saveProofsForMint(normalized, merged, encKey);
        storageRef.current.writeProofStoreTimestamp(normalized);
        storageRef.current.clearSendRecovery(normalized);
        await calculateAllBalances();

        await storageRef.current.withTxLock(async () => {
          await storageRef.current.addTransaction({
            type: 'receive',
            amount: receivedAmount,
            memo: 'Nutzap',
            mintUrl: normalized,
            status: 'completed',
          }, encKey, legacyEncKeyRef.current ?? undefined);
        });
        await refreshTransactions();

        const tokenEvent = await syncNip60TokenForMint(normalized, 'in', receivedAmount);
        const lastEventId = await loadLastTokenEventId(normalized, encKey);
        const redemption = await buildNutzapRedemptionHistoryEvent(
          receivedAmount,
          normalized,
          event.id,
          event.pubkey,
          tokenEvent?.id || lastEventId || '',
          walletSigner,
          [getClientTag()],
        );
        if (redemption) await sync.publish(redemption).catch(() => {});
      });

      processedNutzapIdsRef.current.add(event.id);
      try {
        await storageRef.current.addProcessedNutzapId(event.id, encKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to persist processed Nutzap id:', e);
      }
      setNutzaps((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]));
    } catch (e) {
      devLog.error('Failed to receive Nutzap:', event.id, e);
    } finally {
      releaseNutzapMutex();
    }
  }, [wallet, mintUrl, getNip60WalletSigner, getOrCreateWallet, filterUnspentProofs, calculateAllBalances, refreshTransactions, syncNip60TokenForMint, getClientTag]);

  const sendNutzap = useCallback(async (
    amount: number,
    recipientNpubOrNprofile: string,
    mintUrl: string,
    opts?: { memo?: string; zappedEvent?: { id: string; kind: number; relay?: string } },
  ): Promise<NutzapSendResult> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner || !wallet) {
      setError('Wallet not initialized');
      return { status: 'failed' };
    }
    const err = validateAmount(amount);
    if (err) { setError(err); return { status: 'failed' }; }
    if (typeof opts?.memo !== 'undefined' && (typeof opts.memo !== 'string' || opts.memo.length > 500)) {
      setError('Memo must be a string with max 500 chars');
      return { status: 'failed' };
    }

    let recipientIdentityPubkey: string;
    try {
      const decoded = nip19.decode(recipientNpubOrNprofile.trim());
      if (decoded.type === 'npub') {
        recipientIdentityPubkey = decoded.data;
      } else if (decoded.type === 'nprofile') {
        recipientIdentityPubkey = decoded.data.pubkey;
      } else {
        throw new Error('Unsupported recipient identifier');
      }
    } catch {
      setError('Invalid recipient npub or nprofile');
      return { status: 'failed' };
    }

    const normalizedMint = normalizeMintUrl(mintUrl);
    const allowedMintUrls = allMintsRef.current.map((m) => m.url);
    if (!normalizedMint || !isAllowedMintUrl(normalizedMint, allowedMintUrls)) {
      setError('Selected mint is not allowed');
      return { status: 'failed' };
    }

    // Fetch the recipient's kind:10019 Nutzap info and verify both the author
    // and the chosen mint. A forged info event from a different author could
    // redirect Nutzaps to an attacker's wallet pubkey.
    let recipientInfo: { pubkey: string; mints: string[]; relays: string[] } | null = null;
    try {
      const infoEvents = await sync.query({ kinds: [NUTZAP_INFO_KIND], authors: [recipientIdentityPubkey], limit: 5 });
      const sorted = infoEvents
        .filter((ev) => parseNutzapInfoEvent(ev, recipientIdentityPubkey) !== null)
        .sort((a, b) => b.created_at - a.created_at);
      recipientInfo = sorted.length > 0 ? parseNutzapInfoEvent(sorted[0], recipientIdentityPubkey) : null;
    } catch (e) {
      devLog.error('Failed to fetch recipient Nutzap info:', e);
    }
    // Fallback: the 2140 treasury's kind:10019 lives on BAO's relay, which is
    // not in the app default relay set — query it directly before giving up.
    if (!recipientInfo && sync.queryRelays) {
      try {
        const infoEvents = await sync.queryRelays(
          [TREASURY_INFO_FALLBACK_RELAY],
          { kinds: [NUTZAP_INFO_KIND], authors: [recipientIdentityPubkey], limit: 5 },
        );
        const sorted = infoEvents
          .filter((ev) => parseNutzapInfoEvent(ev, recipientIdentityPubkey) !== null)
          .sort((a, b) => b.created_at - a.created_at);
        recipientInfo = sorted.length > 0 ? parseNutzapInfoEvent(sorted[0], recipientIdentityPubkey) : null;
      } catch (e) {
        devLog.error('Failed to fetch recipient Nutzap info from fallback relay:', e);
      }
    }
    if (!recipientInfo) {
      setError('Recipient has not published Nutzap preferences');
      return { status: 'failed' };
    }
    if (!recipientInfo.mints.includes(normalizedMint)) {
      setError('Recipient does not accept this mint');
      return { status: 'failed' };
    }

    const recipientP2pkPubkey = (() => {
      const pk = recipientInfo.pubkey.toLowerCase();
      if (/^[0-9a-f]{64}$/.test(pk)) return '02' + pk;
      if (/^0[23][0-9a-f]{64}$/.test(pk)) return pk;
      return null;
    })();
    if (!recipientP2pkPubkey) {
      setError('Recipient Nutzap pubkey is invalid');
      return { status: 'failed' };
    }

    const releaseNutzapMutex = await acquireMutex(walletOpsMutexRef);
    // Set the moment the mint has committed the swap and the recipient-locked
    // send proofs are journaled. The NutzapSendResult contract documents
    // 'failed' as "nothing was committed — safe to retry": a validation throw
    // AFTER this point must never surface as 'failed', or the caller retries,
    // double-pays, and the first (already-paid) locked proofs sit stranded in
    // the send-recovery journal forever.
    let postCommitSendProofs: any[] | null = null;
    try {
      if (mountedRef.current) setLoading(true);
      if (mountedRef.current) setError('');
      const targetWallet = normalizedMint === normalizeMintUrl(mintUrl)
        ? wallet
        : await withTimeout(getOrCreateWallet(normalizedMint, bip39SeedRef.current!, true), 15000, 'Foreign mint load');

      const sendProofs = await storageRef.current.withProofLock(async () => {
        const proofs = dedupeProofs(sanitizeProofs(await storageRef.current.getProofsForMint(normalizedMint, encKey, legacyEncKeyRef.current ?? undefined)));
        if (proofs.length === 0) {
          throw new Error('No proofs available for this mint');
        }
        const available = sumProofAmounts(proofs);
        if (available < amount) {
          throw new Error(`Insufficient balance: ${available} sats available`);
        }

        let maxNutzapFee = 0;
        try {
          maxNutzapFee = targetWallet.getFeesForProofs(proofs);
        } catch {
          maxNutzapFee = Math.max(1, Math.floor(available * 0.001));
        }
        if (!isFeeWithinMaxPpm(maxNutzapFee, available, MAX_MINT_FEE_PPM)) {
          throw new Error('Mint fee exceeds maximum allowed');
        }

        await storageRef.current.writeProofRecovery(normalizedMint, proofs, encKey);
        const sendResult = await withTimeout(
          targetWallet.send(amount, proofs, {
            proofsWeHave: proofs,
            pubkey: recipientP2pkPubkey,
            includeDleq: true,
          }),
          60000,
          'Send Nutzap',
          () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
        );
        if (!sendResult || !Array.isArray(sendResult.send) || !Array.isArray(sendResult.keep)) {
          throw new Error('Mint returned invalid Nutzap send response');
        }
        const sendProofs = sanitizeProofs(dedupeProofs(sendResult.send));
        const keepProofs = sanitizeProofs(dedupeProofs(sendResult.keep));
        // Persist keep proofs for crash recovery immediately after the mint
        // returned them, before any further validation or async work.
        await storageRef.current.writeProofRecovery(normalizedMint, keepProofs, encKey);
        // Also journal the (recipient-locked) send proofs immediately: they
        // exist only in memory until the pending-nutzap entry is saved or the
        // event publishes. Reconcile will NOT merge these back (they are
        // locked to the recipient — unspendable by us) but the journal is the
        // only artifact from which a crash-in-between could be recovered.
        if (sendProofs.length > 0) {
          await storageRef.current.writeSendRecovery(normalizedMint, sendProofs, encKey);
        }
        // From here on the mint has committed: any throw below must surface
        // as 'pending' (see the catch), never as a retry-safe 'failed'.
        postCommitSendProofs = sendProofs;
        if (sumProofAmounts(sendProofs) !== amount) {
          throw new Error('Mint returned send proofs with incorrect total amount');
        }
        const outputAmount = sumProofAmounts(sendProofs) + sumProofAmounts(keepProofs);
        if (outputAmount > available) {
          throw new Error('Mint returned invalid proofs: outputs exceed inputs');
        }
        const actualFee = available - outputAmount;
        if (actualFee < 0 || actualFee > maxNutzapFee) {
          throw new Error('Mint returned invalid proofs: fee exceeds reported fee');
        }
        // Locked sends always take the cashu-ts swap path: send outputs are
        // constructed client-side with fresh secrets (the mint cannot choose
        // them), and the UNSELECTED input proofs are passed through verbatim
        // in keep (swap(): { keep: [...freshChange, ...unselected] }). An
        // input secret among the keep proofs is normal and still unspent —
        // only a send proof bearing an input secret indicates a broken
        // mint/library response. Checking keep here threw on every Nutzap
        // from a wallet holding more proofs than the swap selected.
        const inputSecrets = new Set(proofs.map((p) => String(p.secret)));
        for (const p of sendProofs) {
          if (inputSecrets.has(String(p.secret))) {
            throw new Error('Mint returned unspent input proofs as send outputs');
          }
        }

        // Save keep proofs. Crash recovery was already written immediately after
        // the mint returned the outputs. Verify this tab still holds the
        // cross-tab lock before committing.
        await storageRef.current.assertProofLockOwnership();
        await storageRef.current.saveProofsForMint(normalizedMint, keepProofs, encKey);
        storageRef.current.writeProofStoreTimestamp(normalizedMint);
        storageRef.current.clearProofRecovery(normalizedMint);
        await storageRef.current.withTxLock(async () => {
          await storageRef.current.addTransaction({
            type: 'send',
            amount,
            memo: opts?.memo || 'Nutzap',
            mintUrl: normalizedMint,
            status: 'completed',
          }, encKey, legacyEncKeyRef.current ?? undefined);
        });
        await refreshTransactions();
        await calculateAllBalances();
        try {
          await syncNip60TokenForMint(normalizedMint, 'out', amount);
        } catch (e) {
          devLog.error('NIP-60 Nutzap send sync failed:', e);
        }
        return sendProofs;
      });

      // Persist the signed Nutzap before publishing so a publish failure can be
      // retried without losing the locked proofs.
      const pendingEntry: PendingNutzapEntry = {
        id: '',
        sendProofs,
        recipientPubkey: recipientIdentityPubkey,
        mintUrl: normalizedMint,
        amount,
        memo: opts?.memo,
        zappedEvent: opts?.zappedEvent,
        timestamp: Date.now(),
        attempts: 0,
        recipientRelays: recipientInfo.relays,
      };
      let event: NostrEvent | null = null;
      try {
        event = await buildNutzapEvent(
          recipientIdentityPubkey,
          normalizedMint,
          sendProofs,
          sync.signer,
          { memo: opts?.memo, zappedEvent: opts?.zappedEvent, extraTags: [getClientTag()] },
        );
      } catch (e) {
        devLog.error('Failed to build Nutzap event:', e);
      }
      if (!event) {
        pendingEntry.id = `build-failed-${pendingEntry.timestamp}`;
        try {
          await storageRef.current.savePendingNutzap(pendingEntry, encKey, legacyEncKeyRef.current ?? undefined);
          storageRef.current.clearSendRecovery(normalizedMint);
        } catch (saveErr) {
          devLog.error('Failed to save pending Nutzap after build failure:', saveErr);
        }
        if (mountedRef.current) setError('Failed to build Nutzap — saved for retry');
        return { status: 'pending' };
      }
      pendingEntry.id = event.id;
      pendingEntry.event = event;
      const publishedId = await sync.publish(event);
      if (!publishedId) {
        pendingEntry.attempts = 1;
        try {
          await storageRef.current.savePendingNutzap(pendingEntry, encKey, legacyEncKeyRef.current ?? undefined);
          storageRef.current.clearSendRecovery(normalizedMint);
        } catch (saveErr) {
          devLog.error('Failed to save pending Nutzap after publish failure:', saveErr);
        }
        if (mountedRef.current) setError('Failed to publish Nutzap — saved for retry');
        return { status: 'pending' };
      }
      // Published — the locked proofs are now visible to the recipient, so the
      // crash journal written right after the mint commit is no longer needed.
      storageRef.current.clearSendRecovery(normalizedMint);
      // NIP-61: the Nutzap must also reach the relays the recipient listed in
      // their kind:10019 — the recipient's wallet typically subscribes only
      // those relays, and our app relay set may not overlap (the 2140 treasury
      // lists only relay.bao.network, which is not an app default relay).
      // Fan out to any recipient relays we don't already cover; failures are
      // saved for background retry so the payment is not stranded.
      const appRelayUrls = new Set((sync.relays ?? []).map(normalizeRelayUrlForCompare));
      const extraRelays = [...new Set(
        recipientInfo.relays
          .map((u) => u.trim())
          .filter((u) => u.length > 0 && !appRelayUrls.has(normalizeRelayUrlForCompare(u))),
      )];
      let undeliveredRelays: string[] = [];
      if (extraRelays.length > 0) {
        const deliveredUrls = await publishEventToRelayUrls(event, extraRelays);
        const deliveredSet = new Set(deliveredUrls.map(normalizeRelayUrlForCompare));
        undeliveredRelays = extraRelays.filter((u) => !deliveredSet.has(normalizeRelayUrlForCompare(u)));
        if (undeliveredRelays.length > 0) {
          devLog.warn('Nutzap not yet delivered to recipient relays, saved for retry:', undeliveredRelays);
          try {
            await storageRef.current.savePendingNutzap(
              { ...pendingEntry, attempts: 1, lastAttemptAt: Date.now(), recipientRelays: undeliveredRelays },
              encKey,
              legacyEncKeyRef.current ?? undefined,
            );
          } catch (saveErr) {
            devLog.error('Failed to save pending Nutzap for relay retry:', saveErr);
          }
        }
      }
      if (undeliveredRelays.length === 0) {
        try {
          await storageRef.current.removePendingNutzap(event.id, encKey, legacyEncKeyRef.current ?? undefined);
        } catch (e) {
          devLog.warn('Failed to clear pending Nutzap after successful publish:', e);
        }
      }
      if (mountedRef.current) setSuccessTimed(`Sent ${amount} sats via Nutzap`);
      return { status: 'sent', eventId: event.id };
    } catch (err: any) {
      devLog.error('Nutzap send failed:', err);
      // (cast: assigned inside the withProofLock closure, invisible to CFA)
      const committed = postCommitSendProofs as any[] | null;
      if (committed && committed.length > 0) {
        // The mint already committed the swap: the sender's sats are spent and
        // the recipient-locked proofs are journaled. 'failed' would tell the
        // caller "nothing was committed — safe to retry" and a retry would
        // double-pay. Save a pending entry so the SAME locked proofs get
        // published by the retry loop instead, and report 'pending'.
        const pendingEntry: PendingNutzapEntry = {
          id: `post-commit-${Date.now()}`,
          sendProofs: committed,
          recipientPubkey: recipientIdentityPubkey,
          mintUrl: normalizedMint,
          amount,
          memo: opts?.memo,
          zappedEvent: opts?.zappedEvent,
          timestamp: Date.now(),
          attempts: 0,
          recipientRelays: recipientInfo.relays,
        };
        try {
          await storageRef.current.savePendingNutzap(pendingEntry, encKey, legacyEncKeyRef.current ?? undefined);
          storageRef.current.clearSendRecovery(normalizedMint);
        } catch (saveErr) {
          devLog.error('Failed to save pending Nutzap after post-commit validation failure:', saveErr);
        }
        if (mountedRef.current) setError('Nutzap paid but hit a post-payment error — saved for retry');
        return { status: 'pending' };
      }
      if (mountedRef.current) setError(`Nutzap send failed: ${err.message}`);
      return { status: 'failed' };
    } finally {
      releaseNutzapMutex();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, getNip60WalletSigner, getOrCreateWallet, calculateAllBalances, refreshTransactions, syncNip60TokenForMint, getClientTag, triggerBackup]);

  // Retry Nutzap sends whose mint operation succeeded but whose publish failed.
  const reconcilePendingNutzaps = useCallback(async () => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    if (!sync || !encKey || pendingNutzapInFlightRef.current) return;
    pendingNutzapInFlightRef.current = true;
    try {
      const pending = await storageRef.current.loadPendingNutzaps(encKey, legacyEncKeyRef.current ?? undefined);
      if (pending.length === 0) return;
      const now = Date.now();
      for (const entry of pending) {
        if (entry.lastAttemptAt && now - entry.lastAttemptAt < 60_000) continue;
        let event: NostrEvent | null = entry.event ?? null;
        if (!event) {
          event = await buildNutzapEvent(entry.recipientPubkey, entry.mintUrl, entry.sendProofs, sync.signer, {
            memo: entry.memo,
            zappedEvent: entry.zappedEvent,
            extraTags: [getClientTag()],
          });
        }
        if (!event) continue;
        const id = await sync.publish(event);
        if (id) {
          // Also (re)deliver to any recipient kind:10019 relays still pending —
          // the app-relay publish alone does not reach a recipient whose wallet
          // subscribes only their own listed relays.
          let remainingRelays = entry.recipientRelays ?? [];
          if (remainingRelays.length > 0) {
            const deliveredUrls = await publishEventToRelayUrls(event, remainingRelays);
            const deliveredSet = new Set(deliveredUrls.map(normalizeRelayUrlForCompare));
            remainingRelays = remainingRelays.filter((u) => !deliveredSet.has(normalizeRelayUrlForCompare(u)));
          }
          if (remainingRelays.length === 0) {
            await storageRef.current.removePendingNutzap(entry.id, encKey, legacyEncKeyRef.current ?? undefined);
            devLog.log('Published pending Nutzap:', id);
          } else {
            devLog.warn('Pending Nutzap still undelivered to recipient relays:', remainingRelays);
            await storageRef.current.savePendingNutzap(
              { ...entry, event, attempts: entry.attempts + 1, lastAttemptAt: now, recipientRelays: remainingRelays },
              encKey,
              legacyEncKeyRef.current ?? undefined,
            );
          }
        } else {
          await storageRef.current.savePendingNutzap({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now }, encKey, legacyEncKeyRef.current ?? undefined);
        }
      }
    } catch (e) {
      devLog.error('Pending Nutzap reconciliation failed:', e);
    } finally {
      pendingNutzapInFlightRef.current = false;
    }
  }, [getClientTag]);

  // Retry any Nutzap sends that succeeded on the mint side but failed to publish.
  useEffect(() => {
    if (!wallet || !nip60SyncRef.current) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reconcilePendingNutzaps();
    })();
    return () => { cancelled = true; };
  }, [wallet, reconcilePendingNutzaps]);

  const restoreFromBackup = useCallback(async (payload: CashuBackupPayload) => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    if (!encKey || !bip39Seed) {
      setError('Wallet not initialized');
      return;
    }
    if (!payload || typeof payload !== 'object') {
      setError('Invalid backup payload');
      return;
    }
    try {
      // Restore proofs per mint — merge with local rather than overwrite.
      // Ask the mint to drop any spent proofs from the backup before merging,
      // otherwise a stale backup could re-introduce double-spend inputs.
      if (Array.isArray(payload.proofs)) {
        await storageRef.current.withProofLock(async () => {
          const seed = bip39Seed;
          for (const entry of payload.proofs) {
            if (entry && typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0 && isAllowedMintUrl(entry.mintUrl, allMintsRef.current.map((m) => m.url)) && Array.isArray(entry.proofs) && entry.proofs.length > 0) {
              const normalized = safeNormalizeMintUrl(entry.mintUrl);
              const existing = sanitizeProofs(await storageRef.current.getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              let incoming = sanitizeProofs(entry.proofs);
              if (seed) {
                try {
                  incoming = sanitizeProofs(dedupeProofs(await filterUnspentProofs(normalized, incoming, seed)));
                } catch (e) {
                  devLog.warn('Could not verify backed-up proofs, skipping restore for mint:', normalized, e);
                  continue;
                }
              }
              const merged = dedupeProofs([...existing, ...incoming]);
              await storageRef.current.saveProofsForMint(normalized, merged, encKey);
            }
          }
        });
      }
      // Restore transactions — merge with local rather than overwrite.
      // Cap imported transaction count and amounts; warn on very old txs.
      if (Array.isArray(payload.transactions) && payload.transactions.length > 0) {
        await storageRef.current.withTxLock(async () => {
          const MAX_RESTORED_TXS = 500;
          const MAX_TX_AMOUNT = Number.MAX_SAFE_INTEGER;
          const VERY_OLD_MS = 180 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          let validTxs = payload.transactions.filter((t): t is Transaction => storageRef.current.isValidTransaction(t));
          validTxs = validTxs.filter((t) => t.amount <= MAX_TX_AMOUNT);
          const veryOld = validTxs.filter((t) => now - t.createdAt > VERY_OLD_MS);
          if (veryOld.length > 0) {
            devLog.warn(`Restore contains ${veryOld.length} transactions older than 180 days`);
          }
          validTxs = validTxs.slice(0, MAX_RESTORED_TXS);
          const localTxs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const seen = new Set(localTxs.map((t) => t.id));
          const newTxs = validTxs.filter((t) => !seen.has(t.id));
          if (newTxs.length > 0) {
            await storageRef.current.saveTransactions([...localTxs, ...newTxs], encKey);
            if (mountedRef.current) setTransactions(await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined));
          }
        });
      }
      // Restore custom mints (validate host before adopting)
      if (Array.isArray(payload.customMints)) {
        const valid = payload.customMints.filter(
          (m): m is StoredMint =>
            m &&
            typeof m === 'object' &&
            typeof m.url === 'string' &&
            m.url.length > 0 &&
            typeof m.name === 'string' &&
            m.name.length > 0 &&
            isAllowedMintUrl(m.url),
        );
        if (valid.length > 0) {
          const existing = await storageRef.current.loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined);
          const merged = dedupeByKey(
            [...existing, ...valid],
            (m) => safeNormalizeMintUrl(m.url),
          );
          setCustomMints(merged);
          await storageRef.current.saveCustomMints(merged, encKey);
        }
      }
      // Restore selected mint (validate host before adopting it from backup)
      if (payload.selectedMintUrl) {
        const normalizedSelected = normalizeMintUrl(payload.selectedMintUrl);
        if (normalizedSelected && isAllowedMintUrl(normalizedSelected)) {
          setMintUrlState(normalizedSelected);
        } else {
          devLog.warn('Backup selected mint URL is not allowed, skipping:', normalizedSelected);
        }
      }
      await calculateAllBalances(undefined, encKey);
      if (mountedRef.current) setSuccessTimed('Wallet restored from backup');
    } catch (e: any) {
      devLog.error('Manual restore failed:', e);
      if (mountedRef.current) setError(`Restore failed: ${e.message}`);
    }
  }, [calculateAllBalances, filterUnspentProofs]);

  const checkMintQuote = useCallback(async (quote: MintQuoteResponse): Promise<MintQuoteResponse | null> => {
    if (!wallet) return null;
    if (!quote || typeof quote !== 'object' || typeof quote.quote !== 'string' || quote.quote.length === 0) {
      devLog.error('checkMintQuote rejected: invalid quote');
      return null;
    }
    try {
      const updated = await withTimeout(wallet.checkMintQuote(quote), 15000, 'Check mint quote');
      return updated;
    } catch (err: any) {
      devLog.error('Check quote error:', err);
      return null;
    }
  }, [wallet]);

  const checkMeltQuote = useCallback(async (quote: MeltQuoteResponse): Promise<MeltQuoteResponse | null> => {
    if (!wallet) return null;
    if (!quote || typeof quote !== 'object' || typeof quote.quote !== 'string' || quote.quote.length === 0) {
      devLog.error('checkMeltQuote rejected: invalid quote');
      return null;
    }
    try {
      const updated = await withTimeout(wallet.checkMeltQuote(quote), 15000, 'Check melt quote');
      return updated;
    } catch (err: any) {
      devLog.error('Check melt quote error:', err);
      return null;
    }
  }, [wallet]);

  // Poll pending melt quotes so payments that settle asynchronously update balances.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey || !wallet) return;
    let cancelled = false;
    const interval = setInterval(() => {
      (async () => {
        try {
          const txs = await storageRef.current.loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const pendingMelts = txs.filter(
            (t): t is Transaction & { quoteId: string } =>
              t.type === 'melt' && t.status === 'pending' && typeof t.quoteId === 'string' && t.quoteId.length > 0
          );
          for (const t of pendingMelts) {
            if (cancelled) return;
            // BOLT12 quotes only resolve on the bolt12 endpoint — the bolt11
            // check can never return their state.
            const updated = t.bolt12
              ? await withTimeout(wallet.checkMeltQuoteBolt12(t.quoteId), 15000, 'Check BOLT12 melt quote').catch(() => null)
              : await checkMeltQuote({ quote: t.quoteId } as MeltQuoteResponse);
            const state = updated?.state;
            if (state === 'PAID') {
              await storageRef.current.updateTransactionStatus(t.id, 'completed', encKey, legacyEncKeyRef.current ?? undefined);
              const normalizedMeltMint = safeNormalizeMintUrl(t.mintUrl);
              // Remove the journaled melt inputs from the store — they are
              // spent at the mint. The op's PENDING branch normally already
              // removed them (no-op here), but after a melt timeout/response
              // loss they are still present and would otherwise inflate the
              // balance and poison every future send with spent proofs.
              // Serialized under the wallet ops mutex: this mutates the proof
              // store outside any user op, and the cross-tab proof lock is
              // re-entrant within a tab (it does not serialize same-tab ops).
              const inputJournal = await storageRef.current.loadMeltInputRecovery(normalizedMeltMint, encKey, legacyEncKeyRef.current ?? undefined);
              if (inputJournal && inputJournal.proofs.length > 0) {
                const spentSecrets = new Set(inputJournal.proofs.map((p) => String((p as { secret?: unknown })?.secret)));
                const releasePoll = await acquireMutex(walletOpsMutexRef);
                try {
                  await storageRef.current.withProofLock(async () => {
                    const current = sanitizeProofs(await storageRef.current.getProofsForMint(normalizedMeltMint, encKey, legacyEncKeyRef.current ?? undefined));
                    const remaining = current.filter((p) => !spentSecrets.has(String(p?.secret)));
                    if (remaining.length !== current.length) {
                      await storageRef.current.saveProofsForMint(normalizedMeltMint, remaining, encKey);
                      storageRef.current.writeProofStoreTimestamp(normalizedMeltMint);
                    }
                  });
                } finally {
                  releasePoll();
                }
              }
              storageRef.current.clearMeltInputRecovery(normalizedMeltMint);
              // NOTE: the shared proof-recovery slot is NOT cleared here — it
              // may hold an unrelated live crash journal (received proofs /
              // send change) owned by another flow.
              storageRef.current.clearMeltChangeRecovery(normalizedMeltMint);
              await calculateAllBalances();
              if (mountedRef.current) setSuccessTimed('Lightning payment confirmed');
            } else if (state === 'UNPAID') {
              await storageRef.current.updateTransactionStatus(t.id, 'failed', encKey, legacyEncKeyRef.current ?? undefined);
              await restoreMeltInputProofs(t.mintUrl);
              await calculateAllBalances();
            } else if (state !== 'PENDING' && typeof updated?.expiry === 'number' && updated.expiry > 0 && Date.now() > updated.expiry * 1000) {
              // Only treat expiry as final when the quote is NOT pending: a
              // PENDING quote past its wall-clock expiry can still settle
              // (expiry does not cancel a dispatched payment), so keep polling.
              await storageRef.current.updateTransactionStatus(t.id, 'expired', encKey, legacyEncKeyRef.current ?? undefined);
              await restoreMeltInputProofs(t.mintUrl);
              await calculateAllBalances();
            }
          }
          if (!cancelled && pendingMelts.length > 0) await refreshTransactions();
        } catch (e) {
          devLog.error('Pending melt poll failed:', e);
        }
      })();
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  const wasLastSendAmbiguous = useCallback(() => lastSendAmbiguousRef.current, []);

  return {
    wallet,
    mintUrl,
    allMints,
    mintInfo,
    balances,
    totalBalance,
    transactions,
    nutzaps,
    seedPhrase: seedPhraseRef.current,
    isNewWallet,
    showSeedBackup,
    loading,
    error,
    success,
    backupStatus,
    lastBackupAt,
    setMintUrl,
    addCustomMint,
    removeCustomMint,
    handleSeedBackupConfirm,
    calculateAllBalances,
    receiveToken,
    sendToken,
    wasLastSendAmbiguous,
    sendLockedToken,
    sendMultisigLockedToken,
    receiveLockedToken,
    sweepWalletLockedToken,
    getWalletP2pkPubkey,
    requestInvoice,
    mintFromQuote,
    payInvoice,
    payBolt12,
    sendNutzap,
    receiveNutzap,
    checkMintQuote,
    checkMeltQuote,
    restoreFromBackup,
    clearError: useCallback(() => setError(''), []),
    clearSuccess: useCallback(() => setSuccess(''), []),
  };
}
