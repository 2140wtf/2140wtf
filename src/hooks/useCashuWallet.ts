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
import type { MintQuoteResponse, MeltQuoteResponse } from '@cashu/cashu-ts';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  deriveMasterKey,
  deriveEncryptionKey,
  deriveLegacyEncryptionKey,
  deriveNip60WalletKey,
  DEFAULT_MINTS,
  decodeCashuToken,
  encryptData,
  decryptData,
  isAllowedMintUrl,
  normalizeMintUrl,
  MAX_PROOF_FIELD_LENGTH,
  MAX_MINT_FEE_PPM,
  isFeeWithinMaxPpm,
  hashDecodedToken,
  validateReceivedProofs,
} from '@/lib/cashu/cashu';
import {
  loadSelectedMintUrl,
  saveSelectedMintUrl,
  loadCustomMints,
  saveCustomMints,
  getProofsForMint,
  saveProofsForMint,
  mintStorageKey,
  loadTransactions,
  saveTransactions,
  addTransaction,
  updateTransactionStatus,
  isValidTransaction,
  withTxLock,
  withProofLock,
  migratePlaintextTransactions,
  migrateMintMetadata,
  isProcessedTokenHash,
  addProcessedTokenHash,
  loadProcessedTokenHashes,
  saveProcessedTokenHashes,
  isProcessedNutzapId,
  addProcessedNutzapId,
  loadProcessedNutzapIds,
  loadPendingNutzaps,
  savePendingNutzap,
  removePendingNutzap,
  type PendingNutzapEntry,
  type Transaction,
  type StoredMint,
} from '@/lib/cashu/storage';
import { useAppContext } from '@/hooks/useAppContext';
import { devLog } from '@/lib/cashu/devLog';
import { deriveNutzapKey } from '@/lib/cashu/cashu';
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

export interface CashuWalletActions {
  setMintUrl: (url: string) => void;
  addCustomMint: (name: string, url: string) => void;
  removeCustomMint: (url: string) => void;
  handleSeedBackupConfirm: () => Promise<void>;
  calculateAllBalances: () => Promise<void>;
  receiveToken: (tokenStr: string) => Promise<void>;
  sendToken: (amount: number, memo?: string) => Promise<string | null>;
  requestInvoice: (amount: number, description?: string) => Promise<MintQuoteResponse | null>;
  mintFromQuote: (quoteId: string, amount: number) => Promise<void>;
  payInvoice: (invoice: string) => Promise<{ success: boolean; amount: number; preimage?: string; pending?: boolean; quote?: MeltQuoteResponse }>;
  sendNutzap: (amount: number, recipientNpubOrNprofile: string, mintUrl: string, opts?: { memo?: string; zappedEvent?: { id: string; kind: number; relay?: string } }) => Promise<boolean>;
  receiveNutzap: (event: NostrEvent) => Promise<void>;
  checkMintQuote: (quote: MintQuoteResponse) => Promise<MintQuoteResponse | null>;
  checkMeltQuote: (quote: MeltQuoteResponse) => Promise<MeltQuoteResponse | null>;
  clearError: () => void;
  clearSuccess: () => void;
  restoreFromBackup: (payload: CashuBackupPayload) => Promise<void>;
}

/* ── Module-scope recovery helpers ───────────────────────────
   These only read/write localStorage and do not depend on hook render
   state, so they are stable across renders. Functions that decrypt data
   accept an optional legacy key for migration support. */

interface RecoveryEntry {
  version: number;
  timestamp: number;
  proofs: any[];
}

const recoveryKey = (mint: string) => `freedomid_proof_recovery_${stringToBase64(mint)}`;
const sendRecoveryKey = (mint: string) => `freedomid_send_recovery_${stringToBase64(mint)}`;
const meltChangeRecoveryKey = (mint: string) => `freedomid_melt_change_recovery_${stringToBase64(mint)}`;
const proofStoreTsKey = (mint: string) => `freedomid_proof_store_ts_${stringToBase64(mint)}`;
const mintedQuotesKey = 'freedomid_minted_quotes';
const VALID_PROOF_STATES = new Set(['UNSPENT', 'PENDING', 'SPENT']);

const readProofStoreTimestamp = (mintUrl: string): number => {
  try {
    const raw = localStorage.getItem(proofStoreTsKey(mintUrl));
    const ts = raw ? Number(raw) : NaN;
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  } catch {
    return 0;
  }
};

const writeProofStoreTimestamp = (mintUrl: string) => {
  try { localStorage.setItem(proofStoreTsKey(mintUrl), String(Date.now())); } catch { /* noop */ }
};

const writeProofRecovery = async (mintUrl: string, proofs: any[], key: CryptoKey) => {
  try {
    const payload: RecoveryEntry = { version: 1, timestamp: Date.now(), proofs };
    const encrypted = await encryptData(JSON.stringify(payload), key);
    localStorage.setItem(recoveryKey(mintUrl), encrypted);
  } catch (e) {
    devLog.warn('Failed to write proof recovery:', e);
  }
};

const clearProofRecovery = (mintUrl: string) => {
  try { localStorage.removeItem(recoveryKey(mintUrl)); } catch { /* noop */ }
};

const loadProofRecovery = async (mintUrl: string, key: CryptoKey, legacyKey?: CryptoKey): Promise<RecoveryEntry | null> => {
  let encrypted: string | null = null;
  try { encrypted = localStorage.getItem(recoveryKey(mintUrl)); } catch { return null; }
  if (!encrypted) return null;
  try {
    const decrypted = await decryptData(encrypted, key, legacyKey);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.proofs)) {
      return { version: Number(parsed.version) || 0, timestamp: Number(parsed.timestamp) || 0, proofs: parsed.proofs };
    }
    // Backward compatibility: plaintext array
    if (Array.isArray(parsed)) {
      return { version: 0, timestamp: 0, proofs: parsed };
    }
    return null;
  } catch {
    return null;
  }
};

const writeSendRecovery = async (mintUrl: string, proofs: any[], key: CryptoKey) => {
  try {
    const payload: RecoveryEntry = { version: 1, timestamp: Date.now(), proofs };
    const encrypted = await encryptData(JSON.stringify(payload), key);
    localStorage.setItem(sendRecoveryKey(mintUrl), encrypted);
  } catch (e) {
    devLog.warn('Failed to write send recovery:', e);
  }
};

const clearSendRecovery = (mintUrl: string) => {
  try { localStorage.removeItem(sendRecoveryKey(mintUrl)); } catch { /* noop */ }
};

const loadSendRecovery = async (mintUrl: string, key: CryptoKey, legacyKey?: CryptoKey): Promise<RecoveryEntry | null> => {
  let encrypted: string | null = null;
  try { encrypted = localStorage.getItem(sendRecoveryKey(mintUrl)); } catch { return null; }
  if (!encrypted) return null;
  try {
    const decrypted = await decryptData(encrypted, key, legacyKey);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.proofs)) {
      return { version: Number(parsed.version) || 0, timestamp: Number(parsed.timestamp) || 0, proofs: parsed.proofs };
    }
    if (Array.isArray(parsed)) {
      return { version: 0, timestamp: 0, proofs: parsed };
    }
    return null;
  } catch {
    return null;
  }
};

const writeMeltChangeRecovery = async (mintUrl: string, proofs: any[], key: CryptoKey) => {
  try {
    const payload: RecoveryEntry = { version: 1, timestamp: Date.now(), proofs };
    const encrypted = await encryptData(JSON.stringify(payload), key);
    localStorage.setItem(meltChangeRecoveryKey(mintUrl), encrypted);
  } catch (e) {
    devLog.warn('Failed to write melt change recovery:', e);
  }
};

const clearMeltChangeRecovery = (mintUrl: string) => {
  try { localStorage.removeItem(meltChangeRecoveryKey(mintUrl)); } catch { /* noop */ }
};

const loadMeltChangeRecovery = async (mintUrl: string, key: CryptoKey, legacyKey?: CryptoKey): Promise<RecoveryEntry | null> => {
  let encrypted: string | null = null;
  try { encrypted = localStorage.getItem(meltChangeRecoveryKey(mintUrl)); } catch { return null; }
  if (!encrypted) return null;
  try {
    const decrypted = await decryptData(encrypted, key, legacyKey);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.proofs)) {
      return { version: Number(parsed.version) || 0, timestamp: Number(parsed.timestamp) || 0, proofs: parsed.proofs };
    }
    return null;
  } catch {
    return null;
  }
};

const loadMintedQuotes = async (key: CryptoKey, legacyKey?: CryptoKey): Promise<string[]> => {
  let encrypted: string | null = null;
  try { encrypted = localStorage.getItem(mintedQuotesKey); } catch { return []; }
  if (!encrypted) return [];
  try {
    const decrypted = await decryptData(encrypted, key, legacyKey);
    if (!decrypted) return [];
    const parsed = JSON.parse(decrypted);
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : [];
  } catch {
    return [];
  }
};

const writeMintedQuote = async (quoteId: string, key: CryptoKey, maxAttempts = 2) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const existing = await loadMintedQuotes(key);
      if (existing.includes(quoteId)) return;
      existing.push(quoteId);
      const encrypted = await encryptData(JSON.stringify(existing), key);
      localStorage.setItem(mintedQuotesKey, encrypted);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to persist minted quote after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
};

const saveMintedQuotes = async (quoteIds: string[], key: CryptoKey, maxAttempts = 2) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const existing = await loadMintedQuotes(key);
      const merged = [...new Set([...existing, ...quoteIds])];
      const encrypted = await encryptData(JSON.stringify(merged), key);
      localStorage.setItem(mintedQuotesKey, encrypted);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to persist minted quotes after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
};

/* ── Pending receive recovery ────────────────────────────────
   Cashu.receive is not atomic: the mint can issue proofs but the response
   may time out before we persist them. We write the original token to an
   encrypted pending-receive journal before calling the mint. On success the
   journal is cleared; on timeout/error it remains and is re-attempted on
   startup (with an attempt cap so a permanently-failing token does not loop
   forever).
*/

const PENDING_RECEIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_RECEIVE_MAX_ATTEMPTS = 5;
const pendingReceiveContext = 'freedomid:receive-pending';

interface PendingReceiveEntry {
  tokenStr: string;
  tokenHash: string;
  mintUrls: string[];
  amount: number;
  status: 'pending' | 'completed';
  timestamp: number;
  attempts: number;
  /** Normalized mint URLs that have already been successfully received. */
  succeededMintUrls?: string[];
}

const pendingReceiveKey = (tokenHash: string) => `freedomid_receive_pending_${stringToBase64(tokenHash)}`;

const loadPendingReceive = async (tokenHash: string, key: CryptoKey, legacyKey?: CryptoKey): Promise<PendingReceiveEntry | null> => {
  let raw: string | null = null;
  try { raw = localStorage.getItem(pendingReceiveKey(tokenHash)); } catch { return null; }
  if (!raw) return null;
  try {
    const decrypted = await decryptData(raw, key, legacyKey, pendingReceiveContext);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).tokenStr === 'string') {
      return parsed as PendingReceiveEntry;
    }
    return null;
  } catch {
    return null;
  }
};

const clearPendingReceive = (tokenHash: string) => {
  try { localStorage.removeItem(pendingReceiveKey(tokenHash)); } catch { /* noop */ }
};

const writePendingReceive = async (
  tokenStr: string,
  tokenHash: string,
  mintUrls: string[],
  amount: number,
  key: CryptoKey,
  succeededMintUrls?: string[],
) => {
  const existing = await loadPendingReceive(tokenHash, key);
  const entry: PendingReceiveEntry = {
    tokenStr,
    tokenHash,
    mintUrls,
    amount,
    status: 'pending',
    timestamp: Date.now(),
    attempts: existing?.attempts ?? 0,
    succeededMintUrls: succeededMintUrls ?? existing?.succeededMintUrls ?? [],
  };
  const encrypted = await encryptData(JSON.stringify(entry), key, pendingReceiveContext);
  localStorage.setItem(pendingReceiveKey(tokenHash), encrypted);
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
}

export function useCashuWallet(
  externalSeed?: string,
  options?: UseCashuWalletOptions,
): CashuWalletState & CashuWalletActions {
  const { config } = useAppContext();
  const defaultMints = useMemo(() => options?.defaultMints ?? DEFAULT_MINTS, [options?.defaultMints]);
  const deriveWalletKey = useMemo(() => options?.deriveWalletKey ?? deriveNip60WalletKey, [options?.deriveWalletKey]);
  const _walletLabel = options?.walletLabel ?? 'Cashu';
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
  const nip60WalletKeyRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const nip60RestoredRef = useRef(false);
  const processedNutzapIdsRef = useRef<Set<string>>(new Set());
  const pendingNutzapInFlightRef = useRef(false);
  const lastSeedRef = useRef<string>('');
  const balanceVersionRef = useRef(0);
  const receiveTokenMutexRef = useRef<Promise<void> | null>(null);
  const sendTokenMutexRef = useRef<Promise<void> | null>(null);
  const payInvoiceMutexRef = useRef<Promise<void> | null>(null);
  const mintFromQuoteMutexRef = useRef<Promise<void> | null>(null);
  const processedTokenHashesRef = useRef<Set<string>>(new Set());
  const nutzapKeyPairRef = useRef<{ privkey: Uint8Array; pubkey: string } | null>(null);
  const reconcileProofRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const mintUrlRef = useRef(mintUrl);
  const customMintsRef = useRef(customMints);
  const walletRef = useRef<CashuWallet | null>(null);
  const receiveTokenRef = useRef<(tokenStr: string) => Promise<void>>(async () => {});

  useEffect(() => { mintUrlRef.current = mintUrl; }, [mintUrl]);
  useEffect(() => { customMintsRef.current = customMints; }, [customMints]);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  // Persist custom mints outside of render-phase state updaters.
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey) return;
    saveCustomMints(customMints, encKey).catch((e) => devLog.error('Failed to persist custom mints:', e));
  }, [customMints]);

  /** Sum the amounts of a list of proofs, ignoring invalid entries. */
  const sumProofAmounts = (proofs: any[]): number =>
    proofs.reduce((sum, p) => sum + (Number.isInteger(p?.amount) && p.amount > 0 ? p.amount : 0), 0);

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
        if (k && k.startsWith('freedomid_receive_pending_')) keys.push(k);
      }
    } catch {
      return;
    }
    for (const key of keys) {
      let tokenHash = '';
      try {
        const base64Hash = key.slice('freedomid_receive_pending_'.length);
        tokenHash = atob(base64Hash);
      } catch {
        continue;
      }
      const entry = await loadPendingReceive(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
      if (!entry || entry.status !== 'pending') {
        clearPendingReceive(tokenHash);
        continue;
      }
      if (Date.now() - entry.timestamp > PENDING_RECEIVE_TTL_MS) {
        devLog.warn('Pending receive entry expired, clearing:', tokenHash);
        clearPendingReceive(tokenHash);
        continue;
      }
      if (entry.attempts >= PENDING_RECEIVE_MAX_ATTEMPTS) {
        devLog.warn('Pending receive exceeded max attempts, clearing:', tokenHash);
        clearPendingReceive(tokenHash);
        continue;
      }
      entry.attempts += 1;
      try {
        const encrypted = await encryptData(JSON.stringify(entry), encKey, pendingReceiveContext);
        localStorage.setItem(key, encrypted);
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
    const normalized = normalizeMintUrl(mintUrl)!;
    const recoveredEntry = await loadProofRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined);
    if (!recoveredEntry || recoveredEntry.proofs.length === 0) return;
    const seed = bip39Seed;
    let recovered = recoveredEntry.proofs;
    if (seed) {
      try {
        recovered = await filterUnspentProofs(normalized, recovered, seed);
      } catch (e) {
        devLog.warn('Could not verify melt input proofs during async recovery:', normalized, e);
        return;
      }
    }
    await withProofLock(async () => {
      await saveProofsForMint(normalized, recovered, encKey);
      writeProofStoreTimestamp(normalized);
      clearProofRecovery(normalized);
      clearMeltChangeRecovery(normalized);
    });
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
   *  When the timeout fires the underlying network request is cancelled via
   *  AbortController and an optional recovery callback can be scheduled so the
   *  wallet self-heals if a late mint response mutates proof state. */
  const withTimeout = <T>(
    promise: Promise<T>,
    ms: number,
    label: string,
    onTimeout?: () => void,
  ): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          devLog.warn(`${label} timed out after ${ms}ms`);
          if (onTimeout) {
            try {
              onTimeout();
            } catch (e) {
              devLog.error('Timeout recovery callback failed:', e);
            }
          }
          reject(new Error(`${label} timed out — please try again`));
        }, ms);
      }),
    ]);
  };

  /** Serialize receiveToken calls so the same multi-mint token cannot be
   *  double-credited under a race. */
  const acquireReceiveTokenLock = async (): Promise<() => void> => {
    while (receiveTokenMutexRef.current) {
      await receiveTokenMutexRef.current;
    }
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      release = () => {
        if (receiveTokenMutexRef.current === promise) {
          receiveTokenMutexRef.current = null;
        }
        resolve();
      };
    });
    receiveTokenMutexRef.current = promise;
    return release;
  };

  // Combine default + custom mints (deduplicated by URL)
  const allMints = useMemo(
    () => dedupeByKey([...defaultMints, ...customMints], (m) => normalizeMintUrl(m.url)!),
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
      await withProofLock(async () => {
        await withTxLock(async () => {
          for (const m of currentAllMints) {
            try {
              const proofs = sanitizeProofs(await getProofsForMint(normalizeMintUrl(m.url)!, currentEncKey, legacyEncKeyRef.current ?? undefined));
              if (proofs.length > 0) perMint.push({ mintUrl: m.url, proofs });
            } catch (e) {
              devLog.warn('Failed to read proofs for backup:', m.url, e);
              // Continue with other mints
            }
          }
          // Read transactions fresh from storage (encrypted if key available)
          txs = await loadTransactions(currentEncKey, legacyEncKeyRef.current ?? undefined);
        });
      });
      // Read auxiliary state outside the proof/tx locks; it has its own storage keys.
      let mintedQuoteIds: string[] = [];
      let processedTokenHashes: { hash: string; expiresAt: number }[] = [];
      try {
        mintedQuoteIds = await loadMintedQuotes(currentEncKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to read minted quotes for backup:', e);
      }
      try {
        processedTokenHashes = await loadProcessedTokenHashes(currentEncKey, legacyEncKeyRef.current ?? undefined);
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
      saveSelectedMintUrl(mintUrl, encKeyRef.current!).catch((e) => devLog.error('Failed to persist selected mint:', e));
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
        await migrateMintMetadata(encKey, legacyEncKeyRef.current ?? undefined);
        const [savedUrl, savedMints] = await Promise.all([
          loadSelectedMintUrl(encKey, legacyEncKeyRef.current ?? undefined),
          loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined),
        ]);
        if (cancelled) return;
        if (savedUrl) setMintUrlState(savedUrl);
        if (savedMints.length > 0) setCustomMints(savedMints);

        await migratePlaintextTransactions(encKey, legacyEncKeyRef.current ?? undefined);
        const txs = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
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
          const persisted = await loadProcessedTokenHashes(key, legacyEncKeyRef.current ?? undefined);
          for (const entry of persisted) processedTokenHashesRef.current.add(entry.hash);
        } catch {
          // Non-fatal: the persisted guard is a defense-in-depth optimization.
        }
        // Hydrate the in-memory Nutzap dedup guard so a restart does not re-attempt
        // redemption of an already-processed Nutzap.
        try {
          const persistedNutzaps = await loadProcessedNutzapIds(key, legacyEncKeyRef.current ?? undefined);
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
          const migratedTxs = await loadTransactions(key, legacyEncKeyRef.current ?? undefined);
          if (cancelled) return;
          if (mountedRef.current) setTransactions(migratedTxs);
        } catch (e) {
          devLog.error('Transaction load failed:', e);
        }

        // NIP-60 restore and initial sync (before DPCS fallback)
        if (!cancelled && nip60SyncRef.current && nip60WalletKeyRef.current) {
          try {
            const loadedCustomMints = await loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
            const priorAllMints = allMintsRef.current;
            allMintsRef.current = dedupeByKey(
              [...defaultMints, ...loadedCustomMints],
              (m) => normalizeMintUrl(m.url)!,
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

        // Auto-restore from Nostr relays if local wallet is empty
        const restoreFn = restoreCashuStateRef.current;
        if (restoreFn && key) {
          try {
            // Use default mints + loaded custom mints directly (allMints state may be stale here)
            const loadedCustomMints = await loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
            const knownMints = [...defaultMints, ...loadedCustomMints];
            const hasAnyProofs = await (async () => {
              for (const m of knownMints) {
                const p = sanitizeProofs(await getProofsForMint(normalizeMintUrl(m.url)!, key, legacyEncKeyRef.current ?? undefined));
                if (cancelled) return false;
                if (p.length > 0) return true;
              }
              return false;
            })();
            if (cancelled) return;
            const txs = await loadTransactions(key, legacyEncKeyRef.current ?? undefined);
            if (cancelled) return;
            // Always attempt restore when restoreFn is available; merge logic is safe
            // (dedupes proofs, filters new transactions, merges custom mints).
            const restoreAttempted = localStorage.getItem('freedomid_restore_attempted') === 'true';
            if (!restoreAttempted || (!hasAnyProofs && txs.length === 0)) {
              devLog.log('Attempting relay restore');
              const restored = await restoreFn();
              try { localStorage.setItem('freedomid_restore_attempted', 'true'); } catch { /* storage unavailable */ }
              if (cancelled) return;
              if (restored && mountedRef.current) {
                // Restore proofs per mint — MERGE with local rather than overwrite.
                // Verify against the mint that backed-up proofs are still unspent.
                if (Array.isArray(restored.proofs)) {
                  await withProofLock(async () => {
                    const seed = bip39SeedRef.current;
                    for (const entry of restored.proofs) {
                      if (cancelled) return;
                      if (entry && typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0 && isAllowedMintUrl(entry.mintUrl) && Array.isArray(entry.proofs) && entry.proofs.length > 0) {
                        const normalized = normalizeMintUrl(entry.mintUrl)!;
                        const existing = sanitizeProofs(await getProofsForMint(normalized, key, legacyEncKeyRef.current ?? undefined));
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
                        await saveProofsForMint(normalized, merged, key);
                      }
                    }
                  });
                  if (cancelled) return;
                }
                // Restore transactions — merge with local rather than overwrite.
                // Cap imported transaction count and amounts; warn on very old txs.
                if (Array.isArray(restored.transactions) && restored.transactions.length > 0) {
                  await withTxLock(async () => {
                    const MAX_RESTORED_TXS = 500;
                    const MAX_TX_AMOUNT = Number.MAX_SAFE_INTEGER;
                    const VERY_OLD_MS = 180 * 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    let validTxs = restored.transactions.filter((t): t is Transaction => isValidTransaction(t));
                    validTxs = validTxs.filter((t) => t.amount <= MAX_TX_AMOUNT);
                    const veryOld = validTxs.filter((t) => now - t.createdAt > VERY_OLD_MS);
                    if (veryOld.length > 0) {
                      devLog.warn(`Restore contains ${veryOld.length} transactions older than 180 days`);
                    }
                    validTxs = validTxs.slice(0, MAX_RESTORED_TXS);
                    const localTxs = await loadTransactions(key, legacyEncKeyRef.current ?? undefined);
                    const seen = new Set(localTxs.map((t) => t.id));
                    const newTxs = validTxs.filter((t) => !seen.has(t.id));
                    if (newTxs.length > 0) {
                      await saveTransactions([...localTxs, ...newTxs], key);
                      if (cancelled) return;
                      const finalTxs = await loadTransactions(key, legacyEncKeyRef.current ?? undefined);
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
                    const existing = await loadCustomMints(key, legacyEncKeyRef.current ?? undefined);
                    const merged = dedupeByKey(
                      [...existing, ...valid],
                      (m) => normalizeMintUrl(m.url)!,
                    );
                    setCustomMints(merged);
                    await saveCustomMints(merged, key);
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
                    await saveMintedQuotes(restored.mintedQuoteIds, key);
                  } catch (e) {
                    devLog.warn('Failed to restore minted quote IDs:', e);
                  }
                }
                if (restored.version === 2 && Array.isArray(restored.processedTokenHashes) && restored.processedTokenHashes.length > 0) {
                  try {
                    const existing = await loadProcessedTokenHashes(key, legacyEncKeyRef.current ?? undefined);
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
                    await saveProcessedTokenHashes(merged, key);
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
        try { localStorage.removeItem('freedomid_restore_attempted'); } catch { /* ignore */ }
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
  }, [externalSeed]);

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
        const txs = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
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
          await withTxLock(async () => {
            if (cancelled) return;
            const current = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
            const currentIds = new Set(current.map((t) => t.id));
            const safeUpdated = updated.filter((t) => currentIds.has(t.id));
            if (safeUpdated.length > 0) {
              await saveTransactions(safeUpdated, encKey);
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
  useEffect(() => {
    const encKey = encKeyRef.current;
    if (!encKey || !wallet) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reconcileProofRecoveryRef.current();
    })();
    return () => { cancelled = true; };
  }, [wallet, allMints]);

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
    if (!isAllowedMintUrl(url)) {
      throw new Error('Mint URL is not allowed');
    }
    const cacheKey = normalizeMintUrl(url)!;
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
    const allowedUrls = allowForeign
      ? [...allMintsRef.current.map((m) => m.url), url]
      : allMintsRef.current.map((m) => m.url);
    const mintFetch = createMintFetch(allowedUrls);
    const mint = new CashuMint(url, mintFetch as ConstructorParameters<typeof CashuMint>[1]);
    w = new CashuWallet(mint, { bip39seed: seed, unit: 'sat' });
    await withTimeout(w.loadMint(), 15000, 'Mint load');
    walletCacheRef.current.set(cacheKey, w);
    return w;
  }, []);

  /** Drop proofs that the mint reports as already spent.
   *  Maps state by proof Y (hash of secret) instead of array index to defend
   *  against reordering. Throws on mint/network failure so callers can keep
   *  their existing proofs rather than risk wiping funds. */
  const filterUnspentProofs = useCallback(async (url: string, proofs: any[], seed: Uint8Array): Promise<any[]> => {
    if (!proofs.length) return [];
    const w = await getOrCreateWallet(url, seed);
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
    const encoder = new TextEncoder();
    return proofs.filter((p) => {
      if (!p || typeof p !== 'object' || typeof p.secret !== 'string') return false;
      const Y = hashToCurve(encoder.encode(String(p.secret))).toHex(true);
      const state = stateMap.get(Y);
      if (!state) {
        throw new Error(`Missing state for proof with secret ${String(p.secret).slice(0, 20)}`);
      }
      return state !== 'SPENT';
    });
  }, [getOrCreateWallet]);

  // ─── NIP-60 / NIP-61 helpers ─────────────────────────────────────────────────

  const getClientTag = useCallback((): string[] => {
    return ['client', config.clientName ?? config.appName ?? 'Ditto'];
  }, [config.clientName, config.appName]);

  const getNip60WalletSigner = useCallback(() => {
    const key = nip60WalletKeyRef.current;
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

    try {
      const proofs = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
      const lastEventId = await loadLastTokenEventId(normalized, encKey);
      const delIds = new Set<string>();
      if (lastEventId) delIds.add(lastEventId);

      // Replace every remote token event for this mint, not just the last local
      // one. Otherwise stale events from other devices or restores stay on relays
      // and converge back into the wallet as duplicate/spent proofs.
      try {
        const remoteEvents = await sync.query({ kinds: [TOKEN_KIND], authors: [walletSigner.pubkey], limit: 500 });
        for (const ev of remoteEvents) {
          if (ev.id === lastEventId) continue;
          const content = await parseTokenEvent(ev, walletSigner);
          if (content && content.mint === normalized) delIds.add(ev.id);
        }
      } catch (e) {
        devLog.warn('Failed to query remote token events for sync:', normalized, e);
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
      const publishedId = await sync.publish(tokenEvent);
      if (!publishedId) {
        devLog.warn('NIP-60 token event publish failed for mint:', normalized);
        return undefined;
      }

      if (delArray.length > 0) {
        const deletion = await buildDeletionEvent(delArray, walletSigner, 'spent', [getClientTag()]);
        if (deletion) await sync.publish(deletion).catch(() => {});
      }

      const historyRefs: Array<{ id: string; marker: 'created' | 'destroyed' }> = [
        ...(referencedEvents ?? []),
        { id: tokenEvent.id, marker: 'created' },
      ];
      if (lastEventId) historyRefs.push({ id: lastEventId, marker: 'destroyed' });
      const history = await buildHistoryEvent(direction, amount, normalized, walletSigner, historyRefs, [getClientTag()]);
      if (history) await sync.publish(history).catch(() => {});

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
        const normalized = normalizeMintUrl(m.url)!;
        const proofs = sanitizeProofs(await getProofsForMint(normalized, activeKey, legacyEncKeyRef.current ?? undefined));
        const bal = proofs.reduce((sum: number, p: any) => {
          const amt = Number(p.amount);
          return sum + (Number.isInteger(amt) && amt > 0 ? amt : 0);
        }, 0);
        perMint[normalized] = bal;
        total += bal;
      } catch {
        perMint[normalizeMintUrl(m.url)!] = 0;
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

      // Only merge remote proofs when local store is empty; local state is authoritative.
      const hasAnyProofs = await (async () => {
        for (const m of allMintsRef.current) {
          const normalized = normalizeMintUrl(m.url)!;
          const local = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
          if (local.length > 0) return true;
        }
        return false;
      })();

      const seed = bip39SeedRef.current;
      if (!hasAnyProofs && seed) {
        await withProofLock(async () => {
          for (const [mint, remoteProofs] of Object.entries(restored.proofsByMint)) {
            const normalized = normalizeMintUrl(mint);
            if (!normalized || remoteProofs.length === 0) continue;
            try {
              const unspent = sanitizeProofs(dedupeProofs(await filterUnspentProofs(normalized, remoteProofs, seed)));
              if (unspent.length === 0) continue;
              const existing = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              const merged = dedupeProofs([...existing, ...unspent]);
              await saveProofsForMint(normalized, merged, encKey);
            } catch (e) {
              devLog.warn('Failed to merge remote NIP-60 proofs for mint:', normalized, e);
            }
          }
        });
        await calculateAllBalances();
      }

      // Adopt any mints from the remote config that we do not already know.
      if (restored.config.mints.length > 0) {
        const known = new Set(allMintsRef.current.map((m) => normalizeMintUrl(m.url)!));
        const newMints = restored.config.mints.filter((m) => !known.has(m));
        if (newMints.length > 0) {
          const valid = newMints.filter((m) => isAllowedMintUrl(m));
          if (valid.length > 0) {
            const existing = await loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined);
            const merged = dedupeByKey(
              [...existing, ...valid.map((url) => ({ name: url, url }))],
              (m) => normalizeMintUrl(m.url)!,
            );
            setCustomMints(merged);
            await saveCustomMints(merged, encKey);
          }
        }
      }
      return true;
    } catch (e) {
      devLog.error('NIP-60 restore failed:', e);
      return false;
    }
  }, [getNip60WalletSigner, calculateAllBalances, filterUnspentProofs]);

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
        const fallback = allMintsRef.current.find(m => normalizeMintUrl(m.url)! !== normalizeMintUrl(mintUrl)!);
        if (fallback) {
          try {
            const w = await getOrCreateWallet(fallback.url, seed);
            await withTimeout(w.loadMint(), 15000, 'Mint load');
            if (mountedRef.current && nonce === initNonceRef.current) {
              setWallet(w);
              setMintUrlState(normalizeMintUrl(fallback.url)!);
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
      for (const m of allMints) {
        const normalized = normalizeMintUrl(m.url)!;

        const reconcileRecovery = async (
          load: () => Promise<RecoveryEntry | null>,
          clear: (mint: string) => void,
          label: string,
        ) => {
          const recovered = await load();
          if (!recovered || recovered.proofs.length === 0) return;
          devLog.warn(`Recovered ${label} for mint`, normalized);
          try {
            const seed = bip39SeedRef.current;
            const existing = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
            const storeTs = readProofStoreTimestamp(normalized);
            if (existing.length > 0 && recovered.timestamp <= storeTs) {
              devLog.warn(`${label} is older than store, clearing stale recovery:`, normalized);
              clear(normalized);
              return;
            }
            const merged = dedupeByKey([...existing, ...recovered.proofs], (p) => String(p?.secret));
            const canonical = seed ? sanitizeProofs(await filterUnspentProofs(normalized, merged, seed)) : sanitizeProofs(merged);
            await withProofLock(async () => {
              const current = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
              const latest = dedupeByKey([...current, ...canonical], (p) => String(p?.secret));
              await saveProofsForMint(normalized, latest, encKey);
              writeProofStoreTimestamp(normalized);
              clear(normalized);
            });
          } catch (e) {
            devLog.error(`Failed to reconcile ${label}:`, e);
            // Keep existing store and recovery journal; retry later.
          }
        };

        await reconcileRecovery(() => loadProofRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), clearProofRecovery, 'proof recovery');
        await reconcileRecovery(() => loadSendRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), clearSendRecovery, 'send recovery');
        await reconcileRecovery(() => loadMeltChangeRecovery(normalized, encKey, legacyEncKeyRef.current ?? undefined), clearMeltChangeRecovery, 'melt change recovery');
      }
      await calculateAllBalances();
    } catch (e) {
      devLog.error('Proof recovery reconciliation failed:', e);
    }
  }, [wallet, allMints, calculateAllBalances, filterUnspentProofs]);

  // Keep the reconciliation callback reachable from timeout handlers.
  useEffect(() => {
    reconcileProofRecoveryRef.current = reconcileProofRecovery;
  });

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
    // Validate URL
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError('Mint URL must use HTTP or HTTPS');
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
      if (currentAll.some((m) => normalizeMintUrl(m.url)! === normalized)) return prev;
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
    const isDefault = defaultMints.some(m => normalizeMintUrl(m.url)! === normalized);
    if (isDefault) {
      devLog.warn('Cannot remove default mint:', normalized);
      setError('Default mints cannot be removed');
      return;
    }
    setCustomMints((prev) => prev.filter(m => normalizeMintUrl(m.url)! !== normalized));
    void triggerBackup();
    // Evict cached wallet for this mint
    walletCacheRef.current.delete(normalized);
    // Clean up stored proofs and recovery for this mint under the proof lock
    (async () => {
      try {
        await withProofLock(async () => {
          const key = mintStorageKey(normalized);
          localStorage.removeItem(key);
          clearProofRecovery(normalized);
          clearSendRecovery(normalized);
        });
      } catch (e) {
        devLog.error('Failed to clean up mint storage:', e);
      }
    })();
    // Remove balance entry for deleted mint so UI doesn't show stale data
    setBalances((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((k) => {
        if (normalizeMintUrl(k)! === normalized) delete updated[k];
      });
      return updated;
    });
    // If the currently-selected mint was removed, switch to the first available mint
    if (normalizeMintUrl(mintUrl)! === normalized) {
      const fallback = allMints.find(m => normalizeMintUrl(m.url)! !== normalized);
      if (fallback) {
        setMintUrlState(normalizeMintUrl(fallback.url)!);
      } else {
        setMintUrlState('');
        setWallet(null);
      }
    }
  }, [mintUrl, allMints, triggerBackup, defaultMints]);

  const refreshTransactions = useCallback(async () => {
    const encKey = encKeyRef.current;
    const txs = await loadTransactions(encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
    if (mountedRef.current) setTransactions(txs);
  }, []);

  const receiveToken = useCallback(async (tokenStr: string) => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    if (typeof tokenStr !== 'string' || tokenStr.trim().length === 0) {
      setError('Invalid Cashu token');
      return;
    }
    if (!wallet || !bip39Seed || !encKey) {
      setError('Wallet not initialized');
      return;
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
      if (processedTokenHashesRef.current.has(tokenHash) || await isProcessedTokenHash(tokenHash, encKey, legacyEncKeyRef.current ?? undefined)) {
        devLog.warn('Token already processed, skipping:', tokenHash);
        clearPendingReceive(tokenHash);
        if (mountedRef.current) setSuccessTimed('Token already received');
        return;
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
        const normalized = normalizeMintUrl(entry.mintUrl)!;
        const existing = grouped.get(normalized);
        if (existing) {
          existing.proofs.push(...entry.proofs);
        } else {
          grouped.set(normalized, { mintUrl: entry.mintUrl, proofs: [...entry.proofs] });
        }
      }

      // Load any prior partial-receive progress so we can skip mints that
      // already succeeded and avoid an infinite retry loop.
      const existingPending = await loadPendingReceive(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
      const succeededMintUrls = new Set(existingPending?.succeededMintUrls ?? []);
      const groupedEntries = Array.from(grouped.values());
      const pendingMintUrls = groupedEntries.map((e) => normalizeMintUrl(e.mintUrl)!).filter(Boolean);
      const pendingAmount = groupedEntries.reduce((sum, e) => sum + sumProofAmounts(e.proofs), 0);
      await writePendingReceive(tokenStr, tokenHash, pendingMintUrls, pendingAmount, encKey, [...succeededMintUrls]);

      let totalReceived = 0;
      for (const [normalized, entry] of grouped) {
        if (succeededMintUrls.has(normalized)) continue;
        let entryToken: string;
        try {
          entryToken = getEncodedToken({ mint: normalized, proofs: entry.proofs, unit: 'sat' });
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

          const received = await withProofLock(async () => {
            const existingProofs = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
            const tokenAmount = sumProofAmounts(entry.proofs);
            const received = await withTimeout(
              targetWallet.receive(entryToken, { proofsWeHave: existingProofs, requireDleq: true }),
              60000,
              'Receive',
              () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
            );
            let receivedProofs = sanitizeProofs(received ?? []);
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
              filterUnspentProofs(normalized, receivedProofs, bip39Seed),
              15000,
              'Check received proof states',
            );
            if (unspent.length !== receivedProofs.length) {
              throw new Error('Mint returned spent proofs');
            }
            receivedProofs = sanitizeProofs(unspent);
            const allProofs = dedupeProofs([...existingProofs, ...receivedProofs]);
            // Write recovery with merged proofs before save
            await writeProofRecovery(normalized, allProofs, encKey);
            await saveProofsForMint(normalized, allProofs, encKey);
            writeProofStoreTimestamp(normalized);
            clearProofRecovery(normalized);
            await calculateAllBalances();

            // Record the transaction while still holding the proof lock.
            // Both locks are held in the documented order: proof first, then tx.
            // If transaction recording fails, the proof update stays committed
            // (the mint has already issued the proofs) and the operation is
            // surfaced as failed.
            const receivedAmount = Array.isArray(received)
              ? received.reduce((sum: number, p: any) => sum + (Number.isInteger(p?.amount) ? p.amount : 0), 0)
              : 0;
            await withTxLock(async () => {
              await addTransaction({
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
            await writePendingReceive(tokenStr, tokenHash, pendingMintUrls, pendingAmount, encKey, [...succeededMintUrls]);
            return received;
          });

          const receivedAmount = Array.isArray(received)
            ? received.reduce((sum: number, p: any) => sum + (Number.isInteger(p?.amount) ? p.amount : 0), 0)
            : 0;
          totalReceived += receivedAmount;

          if (normalized !== normalizedMintUrl) {
            try {
              const parsed = new URL(normalized);
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                addCustomMint(normalized, normalized);
              }
            } catch {
              devLog.warn('Token contained invalid mint URL:', entry.mintUrl);
            }
          }

        } catch (entryErr: any) {
          errors.push(entryErr?.message || 'Failed to receive from mint');
          devLog.error('Failed to receive token entry:', entry.mintUrl, entryErr);
        }
      }

      const allEntriesSucceeded = grouped.size > 0 && succeededMintUrls.size === grouped.size;
      if (allEntriesSucceeded) {
        processedTokenHashesRef.current.add(tokenHash);
        try {
          await addProcessedTokenHash(tokenHash, encKey, legacyEncKeyRef.current ?? undefined);
        } catch (e) {
          devLog.warn('Failed to persist processed token hash:', e);
          // Do not fail the receive; the in-memory guard still protects this session.
        }
        clearPendingReceive(tokenHash);
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
    } catch (err: any) {
      devLog.error('Receive error:', err);
      if (mountedRef.current) setError(`Failed to receive: ${err.message}`);
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, addCustomMint, calculateAllBalances, refreshTransactions, getOrCreateWallet, filterUnspentProofs, syncNip60TokenForMint]);

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

  const sendToken = useCallback(async (amount: number, memo = ''): Promise<string | null> => {
    const encKey = encKeyRef.current;
    const bip39Seed = bip39SeedRef.current;
    const err = validateAmount(amount);
    if (err) { setError(err); return null; }
    if (typeof memo !== 'string') { setError('Memo must be a string'); return null; }
    if (memo.length > 500) { setError('Memo too long (max 500 chars)'); return null; }
    if (!wallet || !bip39Seed || !encKey) {
      setError('Wallet not initialized');
      return null;
    }
    const release = await acquireMutex(sendTokenMutexRef);
    try {
      setLoading(true);
      setError('');

      const token = await withProofLock(async () => {
        const proofs = sanitizeProofs(await getProofsForMint(normalizeMintUrl(mintUrl)!, encKey, legacyEncKeyRef.current ?? undefined));
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
        const normalizedMint = normalizeMintUrl(mintUrl)!;
        await writeProofRecovery(normalizedMint, proofs, encKey);
        const sendResult = await withTimeout(
          wallet.send(amount, proofs, { proofsWeHave: proofs }),
          60000,
          'Send',
          () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
        );
        if (!sendResult || !Array.isArray(sendResult.send) || !Array.isArray(sendResult.keep)) {
          throw new Error('Mint returned invalid send response');
        }
        const sendProofs = sanitizeProofs(dedupeProofs(sendResult.send));
        const keepProofs = sanitizeProofs(dedupeProofs(sendResult.keep));
        // Persist keep proofs for crash recovery immediately after the mint
        // returned them, before any further validation or async work.
        await writeProofRecovery(normalizedMint, keepProofs, encKey);
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
          maxFee = wallet.getFeesForProofs(proofs);
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
        // Reject if the mint tried to return unspent input proofs as outputs.
        const inputSecrets = new Set(proofs.map((p) => String(p.secret)));
        for (const p of [...sendProofs, ...keepProofs]) {
          if (inputSecrets.has(String(p.secret))) {
            throw new Error('Mint returned unspent input proofs as outputs');
          }
        }

        // Save keep proofs (so user doesn't lose their change). Crash recovery
        // was already written immediately after the mint returned the outputs.
        await saveProofsForMint(normalizedMint, keepProofs, encKey);
        writeProofStoreTimestamp(normalizedMint);
        // Proofs are persisted — clear the recovery journal
        clearProofRecovery(normalizedMint);

        // Build token string — if this throws, proofs are already safe in storage
        let tokenStr: string;
        try {
          tokenStr = getEncodedToken({ mint: normalizedMint, proofs: sendProofs, memo, unit: 'sat' });
        } catch (encodeErr) {
          devLog.error('Token encoding failed — saving recovery data:', encodeErr);
          // Save send proofs to a deterministic recovery key so they can be reconciled
          // on next load. The change (keepProofs) is already in storage.
          try {
            await writeSendRecovery(normalizedMint, sendProofs, encKey);
          } catch { /* best effort */ }
          throw new Error('Failed to encode token — your proofs have been saved for recovery');
        }
        // Encoding succeeded — clear any prior send-recovery for this mint.
        clearSendRecovery(normalizedMint);

        // Record the transaction while still holding the proof lock. Both locks
        // are held in the documented order: proof first, then tx. We cannot roll
        // back the spent proofs (the token has already been issued by the mint),
        // so if recording fails we surface the error but still return the token.
        try {
          await withTxLock(async () => {
            await addTransaction({
              type: 'send',
              amount,
              memo: memo || 'Cashu send',
              mintUrl,
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

      await syncNip60TokenForMint(normalizeMintUrl(mintUrl)!, 'out', amount);

      // Return token immediately — proof update and tx recording are complete.
      if (mountedRef.current) setSuccessTimed(`Sent ${amount} sats`);

      return token;
    } catch (err: any) {
      devLog.error('Send error:', err);
      if (mountedRef.current) setError(`Failed to send: ${err.message}`);
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
            if (k && k.startsWith('freedomid_recovery_')) toRemove.push(k);
          }
          for (const k of toRemove) {
            try { localStorage.removeItem(k); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      })();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, syncNip60TokenForMint]);

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
        await withTxLock(async () => {
          await addTransaction({
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
    const err = validateAmount(amount);
    if (err) { setError(err); return; }
    if (!quoteId || typeof quoteId !== 'string') {
      setError('Invalid quote ID');
      return;
    }
    if (!wallet || !encKey) {
      setError('Wallet not initialized');
      return;
    }
    const release = await acquireMutex(mintFromQuoteMutexRef);
    try {
      setLoading(true);
      setError('');

      const markPendingMint = async (status: Transaction['status']) => {
        try {
          const txs = await loadTransactions(encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
          const pendingIdx = txs.findIndex(
            (t) =>
              t.type === 'mint' &&
              t.status === 'pending' &&
              t.mintUrl === mintUrl &&
              (t.quoteId === quoteId || (t.amount === amount && !t.quoteId)),
          );
          if (pendingIdx >= 0) {
            await updateTransactionStatus(txs[pendingIdx].id, status, encKey ?? undefined, legacyEncKeyRef.current ?? undefined);
            await refreshTransactions();
          }
        } catch (e) {
          devLog.error('Failed to update pending mint transaction status:', e);
        }
      };

      await withProofLock(async () => {
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

        const mintedQuotes = await loadMintedQuotes(encKey, legacyEncKeyRef.current ?? undefined);
        if (mintedQuotes.includes(quoteId)) {
          throw new Error('This quote has already been minted');
        }

        const newProofs = await withTimeout(
          wallet.mintProofs(amount, quoteId),
          60000,
          'Mint proofs',
          () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
        );
        if (!Array.isArray(newProofs) || newProofs.length === 0) {
          throw new Error('Mint returned no proofs');
        }
        if (sumProofAmounts(newProofs) !== amount) {
          throw new Error('Mint returned proofs with incorrect total amount');
        }
        await writeMintedQuote(quoteId, encKey);
        const existing = sanitizeProofs(await getProofsForMint(normalizeMintUrl(mintUrl)!, encKey, legacyEncKeyRef.current ?? undefined));
        const merged = sanitizeProofs(dedupeProofs([...existing, ...newProofs]));
        await writeProofRecovery(normalizeMintUrl(mintUrl)!, merged, encKey);
        await saveProofsForMint(normalizeMintUrl(mintUrl)!, merged, encKey);
        writeProofStoreTimestamp(normalizeMintUrl(mintUrl)!);
        clearProofRecovery(normalizeMintUrl(mintUrl)!);

        // Record the completed mint transaction while still holding the proof
        // lock. Both locks are held in the documented order: proof first, then
        // tx. If recording fails, the proof update stays committed and the
        // operation is surfaced as failed.
        await withTxLock(async () => {
          const txs = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const pendingIdx = txs.findIndex(
            (t) =>
              t.type === 'mint' &&
              t.status === 'pending' &&
              t.mintUrl === mintUrl &&
              (t.quoteId === quoteId || (t.amount === amount && !t.quoteId)),
          );
          if (pendingIdx >= 0) {
            await updateTransactionStatus(txs[pendingIdx].id, 'completed', encKey, legacyEncKeyRef.current ?? undefined);
          } else {
            await addTransaction(
              { type: 'mint', amount, memo: 'Lightning deposit', mintUrl, status: 'completed', quoteId },
              encKey,
              legacyEncKeyRef.current ?? undefined
            );
          }
        });
        await refreshTransactions();

        await calculateAllBalances();
      });

      await syncNip60TokenForMint(normalizeMintUrl(mintUrl)!, 'in', amount);

      if (mountedRef.current) setSuccessTimed(`${amount} sats minted successfully!`);
    } catch (err: any) {
      if (mountedRef.current) setError(`Mint failed: ${err.message}`);
    } finally {
      release();
      if (mountedRef.current) setLoading(false);
      await triggerBackup();
    }
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, syncNip60TokenForMint]);

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
    const release = await acquireMutex(payInvoiceMutexRef);
    try {
      setLoading(true);
      setError('');

      const { amount: paidAmount, preimage, quote, state } = await withProofLock(async () => {
        const quote = await withTimeout(wallet.createMeltQuote(invoice), 30000, 'Melt quote creation');
        const proofs = sanitizeProofs(await getProofsForMint(normalizeMintUrl(mintUrl)!, encKeyRef.current!, legacyEncKeyRef.current ?? undefined));
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

        // Pre-write input proofs as crash recovery. If the app is killed after the mint
        // marks them spent but before we persist the change, the reconciliation loop
        // will ask the mint for spent-state rather than blindly restoring this snapshot.
        const normalizedMint = normalizeMintUrl(mintUrl)!;
        await writeProofRecovery(normalizedMint, proofs, encKeyRef.current!);
        const inputAmount = available;
        const meltResult = await withTimeout(
          wallet.meltProofs(quote, proofs),
          60000,
          'Melt proofs',
          () => setTimeout(() => reconcileProofRecoveryRef.current(), 0),
        );
        if (!meltResult || !Array.isArray(meltResult.change)) {
          throw new Error('Mint returned invalid melt response');
        }
        const changeAmount = sumProofAmounts(meltResult.change);
        if (changeAmount > inputAmount - quoteAmount) {
          throw new Error('Mint returned invalid change: exceeds available amount');
        }
        if (changeAmount < inputAmount - quoteAmount - feeReserve) {
          throw new Error('Mint returned invalid change: missing required amount');
        }
        const actualFee = inputAmount - changeAmount - quoteAmount;
        if (actualFee < 0 || actualFee > feeReserve || !isFeeWithinMaxPpm(actualFee, inputAmount, MAX_MINT_FEE_PPM)) {
          throw new Error('Mint returned invalid melt fee');
        }

        const changeProofs = sanitizeProofs(dedupeProofs(meltResult.change));
        // Persist change for crash recovery immediately after the mint returns it.
        if (changeProofs.length > 0) {
          await writeMeltChangeRecovery(normalizedMint, changeProofs, encKeyRef.current!);
        }

        const state = meltResult.quote?.state;
        const paidAmount = Number(quote.amount) || 0;

        // Record the melt transaction while still holding the proof lock. Both
        // locks are held in the documented order: proof first, then tx. The
        // mint has already accepted or rejected the payment, so on tx failure
        // we surface the error but still return the payment result.
        const recordMeltTx = async () => {
          try {
            await withTxLock(async () => {
              if (state === 'UNPAID') {
                await addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment (failed)',
                  mintUrl,
                  status: 'failed',
                  quoteId: quote.quote,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else if (state === 'PENDING') {
                await addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment (pending)',
                  mintUrl,
                  status: 'pending',
                  quoteId: quote.quote,
                  expiresAt: typeof quote.expiry === 'number' && quote.expiry > 0 ? quote.expiry * 1000 : undefined,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else if (state === 'PAID') {
                await addTransaction({
                  type: 'melt',
                  amount: paidAmount,
                  memo: 'Lightning payment',
                  mintUrl,
                  status: 'completed',
                  quoteId: quote.quote,
                }, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
              } else {
                // Unknown state — treat as pending to be safe.
                await addTransaction({
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
          // Mint did not spend the invoice: input proofs are still unspent.
          // Restore them from the recovery snapshot and drop any change. If we
          // cannot verify spent-state, leave the journal in place for a later retry.
          const recoveredEntry = await loadProofRecovery(normalizedMint, encKeyRef.current!, legacyEncKeyRef.current ?? undefined);
          if (recoveredEntry && recoveredEntry.proofs.length > 0) {
            const seed = bip39SeedRef.current;
            if (!seed) {
              throw new Error('Wallet seed is not available');
            }
            let recovered = recoveredEntry.proofs;
            try {
              recovered = await filterUnspentProofs(normalizedMint, recovered, seed);
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
            await saveProofsForMint(normalizedMint, recovered, encKeyRef.current!);
            writeProofStoreTimestamp(normalizedMint);
          }
          clearProofRecovery(normalizedMint);
          clearMeltChangeRecovery(normalizedMint);
          await calculateAllBalances();
          await recordMeltTx();
          return {
            quote,
            amount: paidAmount,
            preimage: meltResult.quote?.payment_preimage || undefined,
            state,
          };
        }

        // PAID / PENDING / unknown: input proofs are spent by the mint; persist change.
        // Crash-recovery for the change was already written immediately after the
        // mint returned it.
        if (state === 'PENDING' || (state !== 'PAID' && state !== 'UNPAID')) {
          // Keep the input-proof recovery journal until the quote resolves.
          await saveProofsForMint(normalizedMint, changeProofs, encKeyRef.current!);
          writeProofStoreTimestamp(normalizedMint);
          await calculateAllBalances();
          await recordMeltTx();
          return {
            quote,
            amount: paidAmount,
            preimage: meltResult.quote?.payment_preimage || undefined,
            state,
          };
        }

        // PAID: input proofs are spent; persist change and clear all recovery journals.
        await saveProofsForMint(normalizedMint, changeProofs, encKeyRef.current!);
        writeProofStoreTimestamp(normalizedMint);
        clearProofRecovery(normalizedMint);
        clearMeltChangeRecovery(normalizedMint);
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
        await syncNip60TokenForMint(normalizeMintUrl(mintUrl)!, 'out', paidAmount);
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
  }, [wallet, mintUrl, triggerBackup, calculateAllBalances, refreshTransactions, filterUnspentProofs, syncNip60TokenForMint]);

  const receiveNutzap = useCallback(async (event: NostrEvent): Promise<void> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner || !wallet) {
      devLog.warn('Cannot receive Nutzap: wallet or NIP-60 sync not ready');
      return;
    }
    if (processedNutzapIdsRef.current.has(event.id)) return;
    if (await isProcessedNutzapId(event.id, encKey, legacyEncKeyRef.current ?? undefined)) return;

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

      await withProofLock(async () => {
        const existing = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
        const tokenStr = getEncodedToken({ mint: normalized, proofs: parsed.proofs as unknown[], unit: 'sat' });
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
        const unspent = await withTimeout(filterUnspentProofs(normalized, receivedProofs, bip39SeedRef.current!), 15000, 'Check Nutzap proof states');
        if (unspent.length !== receivedProofs.length) {
          throw new Error('Nutzap proofs are already spent');
        }
        receivedProofs = sanitizeProofs(unspent);
        const merged = dedupeProofs([...existing, ...receivedProofs]);
        await saveProofsForMint(normalized, merged, encKey);
        writeProofStoreTimestamp(normalized);
        await calculateAllBalances();

        await withTxLock(async () => {
          await addTransaction({
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
        await addProcessedNutzapId(event.id, encKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to persist processed Nutzap id:', e);
      }
      setNutzaps((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev]));
    } catch (e) {
      devLog.error('Failed to receive Nutzap:', event.id, e);
    }
  }, [wallet, mintUrl, getNip60WalletSigner, getOrCreateWallet, filterUnspentProofs, calculateAllBalances, refreshTransactions, syncNip60TokenForMint, getClientTag]);

  const sendNutzap = useCallback(async (
    amount: number,
    recipientNpubOrNprofile: string,
    mintUrl: string,
    opts?: { memo?: string; zappedEvent?: { id: string; kind: number; relay?: string } },
  ): Promise<boolean> => {
    const sync = nip60SyncRef.current;
    const encKey = encKeyRef.current;
    const walletSigner = getNip60WalletSigner();
    if (!sync || !encKey || !walletSigner || !wallet) {
      setError('Wallet not initialized');
      return false;
    }
    const err = validateAmount(amount);
    if (err) { setError(err); return false; }
    if (typeof opts?.memo !== 'undefined' && (typeof opts.memo !== 'string' || opts.memo.length > 500)) {
      setError('Memo must be a string with max 500 chars');
      return false;
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
      return false;
    }

    const normalizedMint = normalizeMintUrl(mintUrl);
    if (!normalizedMint || !isAllowedMintUrl(normalizedMint)) {
      setError('Selected mint is not allowed');
      return false;
    }

    // Fetch the recipient's kind:10019 Nutzap info and verify both the author
    // and the chosen mint. A forged info event from a different author could
    // redirect Nutzaps to an attacker's wallet pubkey.
    let recipientInfo: { pubkey: string; mints: string[] } | null = null;
    try {
      const infoEvents = await sync.query({ kinds: [NUTZAP_INFO_KIND], authors: [recipientIdentityPubkey], limit: 5 });
      const sorted = infoEvents
        .filter((ev) => parseNutzapInfoEvent(ev, recipientIdentityPubkey) !== null)
        .sort((a, b) => b.created_at - a.created_at);
      recipientInfo = sorted.length > 0 ? parseNutzapInfoEvent(sorted[0], recipientIdentityPubkey) : null;
    } catch (e) {
      devLog.error('Failed to fetch recipient Nutzap info:', e);
    }
    if (!recipientInfo) {
      setError('Recipient has not published Nutzap preferences');
      return false;
    }
    if (!recipientInfo.mints.includes(normalizedMint)) {
      setError('Recipient does not accept this mint');
      return false;
    }

    const recipientP2pkPubkey = (() => {
      const pk = recipientInfo.pubkey.toLowerCase();
      if (/^[0-9a-f]{64}$/.test(pk)) return '02' + pk;
      if (/^0[23][0-9a-f]{64}$/.test(pk)) return pk;
      return null;
    })();
    if (!recipientP2pkPubkey) {
      setError('Recipient Nutzap pubkey is invalid');
      return false;
    }

    try {
      if (mountedRef.current) setLoading(true);
      if (mountedRef.current) setError('');
      const targetWallet = normalizedMint === normalizeMintUrl(mintUrl)
        ? wallet
        : await withTimeout(getOrCreateWallet(normalizedMint, bip39SeedRef.current!, true), 15000, 'Foreign mint load');

      const sendProofs = await withProofLock(async () => {
        const proofs = dedupeProofs(sanitizeProofs(await getProofsForMint(normalizedMint, encKey, legacyEncKeyRef.current ?? undefined)));
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

        await writeProofRecovery(normalizedMint, proofs, encKey);
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
        await writeProofRecovery(normalizedMint, keepProofs, encKey);
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
        const inputSecrets = new Set(proofs.map((p) => String(p.secret)));
        for (const p of [...sendProofs, ...keepProofs]) {
          if (inputSecrets.has(String(p.secret))) {
            throw new Error('Mint returned unspent input proofs as outputs');
          }
        }

        // Save keep proofs. Crash recovery was already written immediately after
        // the mint returned the outputs.
        await saveProofsForMint(normalizedMint, keepProofs, encKey);
        writeProofStoreTimestamp(normalizedMint);
        clearProofRecovery(normalizedMint);
        await withTxLock(async () => {
          await addTransaction({
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
          await savePendingNutzap(pendingEntry, encKey, legacyEncKeyRef.current ?? undefined);
        } catch (saveErr) {
          devLog.error('Failed to save pending Nutzap after build failure:', saveErr);
        }
        if (mountedRef.current) setError('Failed to build Nutzap — saved for retry');
        return false;
      }
      pendingEntry.id = event.id;
      pendingEntry.event = event;
      const publishedId = await sync.publish(event);
      if (!publishedId) {
        pendingEntry.attempts = 1;
        try {
          await savePendingNutzap(pendingEntry, encKey, legacyEncKeyRef.current ?? undefined);
        } catch (saveErr) {
          devLog.error('Failed to save pending Nutzap after publish failure:', saveErr);
        }
        if (mountedRef.current) setError('Failed to publish Nutzap — saved for retry');
        return false;
      }
      try {
        await removePendingNutzap(event.id, encKey, legacyEncKeyRef.current ?? undefined);
      } catch (e) {
        devLog.warn('Failed to clear pending Nutzap after successful publish:', e);
      }
      if (mountedRef.current) setSuccessTimed(`Sent ${amount} sats via Nutzap`);
      return true;
    } catch (err: any) {
      devLog.error('Nutzap send failed:', err);
      if (mountedRef.current) setError(`Nutzap send failed: ${err.message}`);
      return false;
    } finally {
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
      const pending = await loadPendingNutzaps(encKey, legacyEncKeyRef.current ?? undefined);
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
          await removePendingNutzap(entry.id, encKey, legacyEncKeyRef.current ?? undefined);
          devLog.log('Published pending Nutzap:', id);
        } else {
          await savePendingNutzap({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now }, encKey, legacyEncKeyRef.current ?? undefined);
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
        await withProofLock(async () => {
          const seed = bip39Seed;
          for (const entry of payload.proofs) {
            if (entry && typeof entry.mintUrl === 'string' && entry.mintUrl.length > 0 && isAllowedMintUrl(entry.mintUrl) && Array.isArray(entry.proofs) && entry.proofs.length > 0) {
              const normalized = normalizeMintUrl(entry.mintUrl)!;
              const existing = sanitizeProofs(await getProofsForMint(normalized, encKey, legacyEncKeyRef.current ?? undefined));
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
              await saveProofsForMint(normalized, merged, encKey);
            }
          }
        });
      }
      // Restore transactions — merge with local rather than overwrite.
      // Cap imported transaction count and amounts; warn on very old txs.
      if (Array.isArray(payload.transactions) && payload.transactions.length > 0) {
        await withTxLock(async () => {
          const MAX_RESTORED_TXS = 500;
          const MAX_TX_AMOUNT = Number.MAX_SAFE_INTEGER;
          const VERY_OLD_MS = 180 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          let validTxs = payload.transactions.filter((t): t is Transaction => isValidTransaction(t));
          validTxs = validTxs.filter((t) => t.amount <= MAX_TX_AMOUNT);
          const veryOld = validTxs.filter((t) => now - t.createdAt > VERY_OLD_MS);
          if (veryOld.length > 0) {
            devLog.warn(`Restore contains ${veryOld.length} transactions older than 180 days`);
          }
          validTxs = validTxs.slice(0, MAX_RESTORED_TXS);
          const localTxs = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const seen = new Set(localTxs.map((t) => t.id));
          const newTxs = validTxs.filter((t) => !seen.has(t.id));
          if (newTxs.length > 0) {
            await saveTransactions([...localTxs, ...newTxs], encKey);
            if (mountedRef.current) setTransactions(await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined));
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
          const existing = await loadCustomMints(encKey, legacyEncKeyRef.current ?? undefined);
          const merged = dedupeByKey(
            [...existing, ...valid],
            (m) => normalizeMintUrl(m.url)!,
          );
          setCustomMints(merged);
          await saveCustomMints(merged, encKey);
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
          const txs = await loadTransactions(encKey, legacyEncKeyRef.current ?? undefined);
          const pendingMelts = txs.filter(
            (t): t is Transaction & { quoteId: string } =>
              t.type === 'melt' && t.status === 'pending' && typeof t.quoteId === 'string' && t.quoteId.length > 0
          );
          for (const t of pendingMelts) {
            if (cancelled) return;
            const updated = await checkMeltQuote({ quote: t.quoteId } as MeltQuoteResponse);
            const state = updated?.state;
            if (state === 'PAID') {
              await updateTransactionStatus(t.id, 'completed', encKey, legacyEncKeyRef.current ?? undefined);
              clearProofRecovery(normalizeMintUrl(t.mintUrl)!);
              clearMeltChangeRecovery(normalizeMintUrl(t.mintUrl)!);
              await calculateAllBalances();
              if (mountedRef.current) setSuccessTimed('Lightning payment confirmed');
            } else if (state === 'UNPAID') {
              await updateTransactionStatus(t.id, 'failed', encKey, legacyEncKeyRef.current ?? undefined);
              await restoreMeltInputProofs(t.mintUrl);
              await calculateAllBalances();
            } else if (typeof updated?.expiry === 'number' && updated.expiry > 0 && Date.now() > updated.expiry * 1000) {
              await updateTransactionStatus(t.id, 'expired', encKey, legacyEncKeyRef.current ?? undefined);
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
    requestInvoice,
    mintFromQuote,
    payInvoice,
    sendNutzap,
    receiveNutzap,
    checkMintQuote,
    checkMeltQuote,
    restoreFromBackup,
    clearError: useCallback(() => setError(''), []),
    clearSuccess: useCallback(() => setSuccess(''), []),
  };
}
