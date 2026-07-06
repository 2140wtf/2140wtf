import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useNostrLogin } from '@nostrify/react/login';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { deriveSilentPaymentKeysFromNsec } from '@/lib/hdWallet';
import { fetchBlockEntries, fetchIndexerTipHeight } from '@/lib/sp/indexer';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';
import { scanBatch, type SPMatchedUtxo } from '@/lib/sp/scanner';
import {
  EMPTY_SP_STORAGE,
  SP_STORAGE_VERSION,
  archiveSpentUtxos,
  matchedUtxoToStored,
  mergeUtxos,
  parseSPStorage,
  pruneSpUtxos,
  serializeSPStorage,
  spStorageBalance,
  spStorageDTag,
  type SPStorageDocument,
  type SPStoredUtxo,
} from '@/lib/sp/storage';

/** Default number of block fetches to keep in flight during a scan. */
const DEFAULT_SCAN_CONCURRENCY = 8;
const MIN_SCAN_CONCURRENCY = 1;
const MAX_SCAN_CONCURRENCY = 32;

/** Default scan window when the user clicks "Scan recent" with no explicit bounds. */
const DEFAULT_RECENT_SCAN_BLOCKS = 144; // ~24 hours of mainnet blocks.

/**
 * How far back the *automatic* background scanner reaches on a wallet that
 * has never been scanned (`scanHeight === 0`).
 */
const AUTO_SCAN_INITIAL_WINDOW_BLOCKS = 1008; // ~7 days.

/** Throttle relay republishes during a long scan (ms). */
const REPUBLISH_THROTTLE_MS = 5000;

function resolveConcurrency(configured: number | undefined): number {
  if (typeof configured !== 'number' || !Number.isInteger(configured)) {
    return DEFAULT_SCAN_CONCURRENCY;
  }
  return Math.min(MAX_SCAN_CONCURRENCY, Math.max(MIN_SCAN_CONCURRENCY, configured));
}

export interface SilentPaymentsScanProgress {
  fromHeight: number;
  toHeight: number;
  currentHeight: number;
  matchesFound: number;
}

export interface UseSilentPaymentsScanResult {
  /** True when the user is logged in with nsec and an indexer is configured. */
  enabled: boolean;
  /** Reason `enabled` is false, when applicable. */
  unavailableReason?: 'logged-out' | 'unsupported-signer' | 'no-indexer' | 'no-nip44';
  /** The wallet's BIP-352 scan/spend public keys, when available. */
  keys?: {
    scanPubKey: Uint8Array;
    spendPubKey: Uint8Array;
  };
  /** Decrypted persisted SP document. `undefined` while loading. */
  storage?: SPStorageDocument;
  /** Sum of all stored SP UTXO values, in satoshis. */
  balance: number;
  /** True while the initial storage load is in progress. */
  isLoading: boolean;
  /** True while a scan is in progress. */
  isScanning: boolean;
  /** Progress for the in-flight scan. */
  scanProgress?: SilentPaymentsScanProgress;
  /** Error from the most recent scan, if any. */
  scanError?: Error;
  /** Tip height as reported by the indexer (cached, refreshed every 60s). */
  tipHeight?: number;
  /**
   * Scan a contiguous block range. `toHeight` defaults to current tip.
   * `includeSpent` opts into a deeper rescan that archives already-spent outputs.
   */
  scanRange: (args: {
    fromHeight: number;
    toHeight?: number;
    includeSpent?: boolean;
  }) => Promise<SPMatchedUtxo[]>;
  /** Scan the most recent `DEFAULT_RECENT_SCAN_BLOCKS` blocks (or fewer if newer). */
  scanRecent: () => Promise<void>;
  /** Abort an in-flight scan. */
  cancelScan: () => void;
  /**
   * Move the given SP UTXOs to the spent archive and republish storage.
   * Call after a successful broadcast so the wallet doesn't try to spend them
   * again.
   */
  pruneSpentUtxos: (spent: ReadonlyArray<{ txid: string; vout: number }>) => void;
}

const EMPTY_RESULT: UseSilentPaymentsScanResult = {
  enabled: false,
  balance: 0,
  isLoading: false,
  isScanning: false,
  scanRange: async () => [],
  scanRecent: async () => {},
  cancelScan: () => {},
  pruneSpentUtxos: () => {},
};

/**
 * React hook for scanning a BIP-352 Silent Payments indexer.
 *
 * Derives SP keys from the nsec login, loads persisted UTXO state from a
 * NIP-78 (kind 30078) NIP-44-encrypted event, runs block-range scans against
 * the configured BlindBit Oracle v2 indexer, and writes discovered UTXOs back
 * to the encrypted event.
 */
export function useSilentPaymentsScan(): UseSilentPaymentsScanResult {
  const { config } = useAppContext();
  const { logins } = useNostrLogin();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const indexerUrl = (config.bip352IndexerUrl ?? '').trim();
  const concurrency = resolveConcurrency(config.bip352ScanConcurrency);

  const nsecLogin = logins[0]?.type === 'nsec' ? logins[0] : undefined;

  const keyPair = useMemo(() => {
    if (!nsecLogin) return undefined;
    try {
      const decoded = nip19.decode(nsecLogin.data.nsec);
      if (decoded.type !== 'nsec') return undefined;
      return deriveSilentPaymentKeysFromNsec(decoded.data);
    } catch {
      return undefined;
    }
  }, [nsecLogin]);

  const keys = useMemo(
    () =>
      keyPair
        ? {
            scanPubKey: keyPair.scanPubKey,
            spendPubKey: keyPair.spendPubKey,
          }
        : undefined,
    [keyPair],
  );

  const unavailableReason: UseSilentPaymentsScanResult['unavailableReason'] =
    !nsecLogin ? 'logged-out'
    : !keyPair ? 'unsupported-signer'
    : indexerUrl === '' ? 'no-indexer'
    : !user?.signer.nip44 ? 'no-nip44'
    : undefined;
  const enabled = unavailableReason === undefined;

  const dTag = spStorageDTag(config.appId);

  // ── Tip-height query ────────────────────────────────────────────────────
  const { data: tipHeight } = useQuery<number>({
    queryKey: ['silent-payments-tip', indexerUrl],
    queryFn: ({ signal }) => fetchIndexerTipHeight(indexerUrl, signal),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // ── Persisted storage event ─────────────────────────────────────────────
  const storageEventQuery = useQuery({
    queryKey: ['silent-payments-event', user?.pubkey, dTag],
    queryFn: async ({ signal }) => {
      if (!user) return null;
      const events = await nostr.query([
        {
          kinds: [30078],
          authors: [user.pubkey],
          '#d': [dTag],
          limit: 1,
        },
      ], { signal });
      if (events.length === 0) return null;
      return events.reduce((latest, current) =>
        current.created_at > latest.created_at ? current : latest,
      );
    },
    enabled: enabled && !!user,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const storageDocQuery = useQuery<SPStorageDocument>({
    queryKey: ['silent-payments-doc', storageEventQuery.data?.id ?? '(empty)'],
    queryFn: async () => {
      const event = storageEventQuery.data;
      if (!event) return { ...EMPTY_SP_STORAGE };
      if (!user?.signer.nip44) return { ...EMPTY_SP_STORAGE };
      if (!event.content) return { ...EMPTY_SP_STORAGE };
      try {
        const plaintext = await user.signer.nip44.decrypt(user.pubkey, event.content);
        return parseSPStorage(plaintext);
      } catch (err) {
        console.warn('Failed to decrypt SP storage event; treating as empty:', err);
        return { ...EMPTY_SP_STORAGE };
      }
    },
    enabled: enabled && !!user,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // ── Optimistic in-memory copy ───────────────────────────────────────────
  const optimisticRef = useRef<SPStorageDocument | null>(null);
  const [optimisticVersion, setOptimisticVersion] = useState(0);
  void optimisticVersion;

  const storage = useMemo<SPStorageDocument | undefined>(() => {
    if (!enabled) return undefined;
    if (!storageDocQuery.data) return undefined;
    const loaded = storageDocQuery.data;
    const opt = optimisticRef.current;
    if (!opt) return loaded;
    // Prefer the optimistic copy when it has caught up scan-wise and contains
    // at least as many entries as the loaded copy.
    const optTotal = opt.utxos.length + (opt.spent?.length ?? 0);
    const loadedTotal = loaded.utxos.length + (loaded.spent?.length ?? 0);
    if (opt.scanHeight >= loaded.scanHeight && optTotal >= loadedTotal) {
      return opt;
    }
    return loaded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storageDocQuery.data, optimisticVersion]);

  // ── Publish mutation ────────────────────────────────────────────────────
  //
  // Read-modify-write: always fetch the freshest relay copy before publishing
  // so a concurrent device (or a rapid second mutation on this device) doesn't
  // get overwritten. The local `next` doc wins on scanHeight and UTXO values,
  // but spent entries provided by the caller are pruned from the remote copy
  // before the merge so a just-spent UTXO isn't resurrected.
  const publishStorage = useMutation({
    mutationFn: async (args: {
      next: SPStorageDocument;
      spent?: ReadonlyArray<{ txid: string; vout: number }>;
    }) => {
      if (!user) throw new Error('not logged in');
      if (!user.signer.nip44) throw new Error('signer does not support NIP-44');
      const { next, spent } = args;

      let prev: Awaited<ReturnType<typeof fetchFreshEvent>> = null;
      try {
        prev = await fetchFreshEvent(nostr, {
          kinds: [30078],
          authors: [user.pubkey],
          '#d': [dTag],
        });
      } catch {
        // Relay read failed — publish the local doc as-is rather than blocking.
      }

      let merged = next;
      if (prev?.content) {
        try {
          const decrypted = await user.signer.nip44.decrypt(user.pubkey, prev.content);
          const remote = parseSPStorage(decrypted);

          const remoteUtxos = spent && spent.length > 0
            ? pruneSpUtxos(remote.utxos, spent)
            : remote.utxos;

          const archiveByKey = new Map<string, SPStoredUtxo>();
          for (const u of remote.spent ?? []) archiveByKey.set(`${u.txid}:${u.vout}`, u);
          for (const u of next.spent ?? []) {
            const k = `${u.txid}:${u.vout}`;
            if (!archiveByKey.has(k)) archiveByKey.set(k, u);
          }
          // Also archive any UTXOs the remote still has but the local prune
          // just spent and hasn't archived yet.
          if (spent && spent.length > 0) {
            const spentKeys = new Set(spent.map((s) => `${s.txid}:${s.vout}`));
            for (const u of remote.utxos) {
              const k = `${u.txid}:${u.vout}`;
              if (spentKeys.has(k) && !archiveByKey.has(k)) archiveByKey.set(k, u);
            }
          }

          merged = {
            version: SP_STORAGE_VERSION,
            scanHeight: Math.max(remote.scanHeight, next.scanHeight),
            utxos: mergeUtxos(remoteUtxos, next.utxos),
            spent: Array.from(archiveByKey.values()),
          };
        } catch {
          // Undecryptable remote — publish local doc as-is.
        }
      }

      const ciphertext = await user.signer.nip44.encrypt(user.pubkey, serializeSPStorage(merged));
      const unsigned = {
        kind: 30078,
        content: ciphertext,
        tags: [
          ['d', dTag],
          ['title', `${config.appName} Silent Payment UTXOs`],
          ['client', config.appName, ...(config.client ? [config.client] : [])],
          ['alt', 'Encrypted silent-payment UTXO set'],
        ],
        created_at: Math.floor(Date.now() / 1000),
      };
      const signed = (await user.signer.signEvent(unsigned)) as NostrEvent;
      nostr.event(signed, { signal: AbortSignal.timeout(5000) }).catch((e) => {
        console.warn('Failed to publish SP storage event:', e);
      });
      return { signed, merged };
    },
    onSuccess: ({ signed, merged }) => {
      queryClient.setQueryData(['silent-payments-event', user?.pubkey, dTag], signed);
      queryClient.setQueryData(['silent-payments-doc', signed.id], merged);
    },
  });

  // ── Scan state ──────────────────────────────────────────────────────────
  const [scanProgress, setScanProgress] = useState<SilentPaymentsScanProgress | undefined>();
  const [scanError, setScanError] = useState<Error | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);
  const republishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const republishDirtyRef = useRef(false);

  const cancelScan = useCallback(() => {
    scanAbortRef.current?.abort();
  }, []);

  const flushRepublish = useCallback(() => {
    if (republishTimerRef.current) {
      clearTimeout(republishTimerRef.current);
      republishTimerRef.current = null;
    }
    const doc = optimisticRef.current;
    if (!doc) return;
    republishDirtyRef.current = false;
    publishStorage.mutate({ next: doc });
  }, [publishStorage]);

  const scheduleRepublish = useCallback(() => {
    if (republishTimerRef.current) return;
    if (!republishDirtyRef.current) return;
    republishTimerRef.current = setTimeout(() => {
      republishTimerRef.current = null;
      const doc = optimisticRef.current;
      if (!doc || !republishDirtyRef.current) return;
      republishDirtyRef.current = false;
      publishStorage.mutate({ next: doc });
    }, REPUBLISH_THROTTLE_MS);
  }, [publishStorage]);

  // ── Core scan loop ──────────────────────────────────────────────────────
  const runScan = useCallback(
    async ({
      fromHeight,
      toHeight,
      includeSpent = false,
    }: {
      fromHeight: number;
      toHeight?: number;
      includeSpent?: boolean;
    }): Promise<SPMatchedUtxo[]> => {
      if (!enabled || !keyPair || !storage) return [];
      if (!Number.isInteger(fromHeight) || fromHeight < 0) {
        throw new Error(`Invalid fromHeight: ${fromHeight}`);
      }

      const resolvedTo = toHeight ?? tipHeight ?? (await fetchIndexerTipHeight(indexerUrl));
      if (!Number.isInteger(resolvedTo) || resolvedTo < fromHeight) {
        throw new Error(`Invalid toHeight: ${resolvedTo}`);
      }

      scanAbortRef.current?.abort();
      const controller = new AbortController();
      scanAbortRef.current = controller;

      setScanError(undefined);
      setIsScanning(true);
      setScanProgress({
        fromHeight,
        toHeight: resolvedTo,
        currentHeight: fromHeight,
        matchesFound: 0,
      });

      optimisticRef.current = {
        version: SP_STORAGE_VERSION,
        scanHeight: storage.scanHeight,
        utxos: storage.utxos.slice(),
        spent: (storage.spent ?? []).slice(),
      };

      let matchesFound = 0;
      let highestContiguousScanned = fromHeight - 1;
      const mayAdvanceCursor = storage.scanHeight === 0 || fromHeight <= storage.scanHeight + 1;

      const inflight = new Map<number, Promise<SPMatchedUtxo[]>>();
      let nextToSchedule = fromHeight;

      const scheduleUpTo = (limit: number) => {
        while (
          nextToSchedule <= resolvedTo &&
          inflight.size < limit &&
          !controller.signal.aborted
        ) {
          const h = nextToSchedule++;
          inflight.set(
            h,
            fetchBlockEntries(indexerUrl, h, controller.signal, includeSpent).then((entries) =>
              scanBatch(entries, keyPair.scanPrivKey, keyPair.spendPubKey, {
                signal: controller.signal,
              }),
            ),
          );
        }
      };

      try {
        scheduleUpTo(concurrency);
        const allMatches: SPMatchedUtxo[] = [];

        for (let h = fromHeight; h <= resolvedTo; h++) {
          if (controller.signal.aborted) break;

          const pending = inflight.get(h);
          if (!pending) throw new Error(`Scan pipeline missing height ${h}`);
          inflight.delete(h);

          let blockMatches: SPMatchedUtxo[];
          try {
            blockMatches = await pending;
          } catch (err) {
            controller.abort();
            throw err;
          }

          scheduleUpTo(concurrency);

          if (blockMatches.length > 0) {
            const freshActive: SPStoredUtxo[] = [];
            const freshArchive: SPStoredUtxo[] = [];
            for (const m of blockMatches) {
              const stored = matchedUtxoToStored(m);
              if (m.spent) freshArchive.push(stored);
              else freshActive.push(stored);
            }

            const opt = optimisticRef.current;
            const spentKeys = new Set(freshArchive.map((u) => `${u.txid}:${u.vout}`));
            optimisticRef.current = {
              version: SP_STORAGE_VERSION,
              scanHeight: opt.scanHeight,
              utxos: mergeUtxos(opt.utxos, freshActive).filter(
                (u) => !spentKeys.has(`${u.txid}:${u.vout}`),
              ),
              spent: mergeUtxos(opt.spent ?? [], freshArchive),
            };
            matchesFound += blockMatches.length;
            allMatches.push(...blockMatches);
            republishDirtyRef.current = true;
          }

          if (mayAdvanceCursor && h === highestContiguousScanned + 1) {
            highestContiguousScanned = h;
            const opt = optimisticRef.current;
            optimisticRef.current = {
              ...opt,
              scanHeight: Math.max(opt.scanHeight, highestContiguousScanned),
            };
          }

          setScanProgress({
            fromHeight,
            toHeight: resolvedTo,
            currentHeight: h,
            matchesFound,
          });
          setOptimisticVersion((v) => v + 1);
          scheduleRepublish();
        }

        return allMatches;
      } catch (err) {
        if (!controller.signal.aborted) {
          setScanError(err instanceof Error ? err : new Error(String(err)));
        }
        return [];
      } finally {
        if (inflight.size > 0) {
          if (!controller.signal.aborted) controller.abort();
          for (const p of inflight.values()) {
            p.catch(() => {});
          }
          inflight.clear();
        }
        setIsScanning(false);
        flushRepublish();
        if (scanAbortRef.current === controller) {
          scanAbortRef.current = null;
        }
      }
    },
    [enabled, keyPair, storage, tipHeight, indexerUrl, concurrency, scheduleRepublish, flushRepublish],
  );

  const scanRange = useCallback<UseSilentPaymentsScanResult['scanRange']>(
    (args) => runScan(args),
    [runScan],
  );

  const scanRecent = useCallback<UseSilentPaymentsScanResult['scanRecent']>(async () => {
    if (!enabled) return;
    const tip = tipHeight ?? (await fetchIndexerTipHeight(indexerUrl));
    const from = Math.max(0, tip - DEFAULT_RECENT_SCAN_BLOCKS + 1);
    await runScan({ fromHeight: from, toHeight: tip });
  }, [enabled, indexerUrl, tipHeight, runScan]);

  // ── Auto background scanning ────────────────────────────────────────────
  const autoScannedToRef = useRef(0);
  useEffect(() => {
    autoScannedToRef.current = 0;
  }, [user?.pubkey, indexerUrl]);

  useEffect(() => {
    if (!enabled) return;
    if (!storage) return;
    if (tipHeight === undefined) return;
    if (isScanning) return;

    const resumeFrom =
      storage.scanHeight > 0
        ? storage.scanHeight + 1
        : Math.max(0, tipHeight - AUTO_SCAN_INITIAL_WINDOW_BLOCKS + 1);

    if (resumeFrom > tipHeight) return;
    if (tipHeight <= autoScannedToRef.current) return;
    autoScannedToRef.current = tipHeight;

    void runScan({ fromHeight: resumeFrom, toHeight: tipHeight }).catch((err) => {
      console.warn('Automatic SP scan failed:', err);
      autoScannedToRef.current = 0;
    });
  }, [enabled, storage, tipHeight, isScanning, runScan]);

  // ── Prune spent UTXOs after a broadcast ─────────────────────────────────
  const pruneSpentUtxos = useCallback<UseSilentPaymentsScanResult['pruneSpentUtxos']>(
    (spent) => {
      if (!spent.length || !storage) return;
      if (republishTimerRef.current) {
        clearTimeout(republishTimerRef.current);
        republishTimerRef.current = null;
      }
      republishDirtyRef.current = false;

      const base = optimisticRef.current ?? storage;
      const next = archiveSpentUtxos(base, spent);
      optimisticRef.current = next;
      setOptimisticVersion((v) => v + 1);

      const eventId = queryClient.getQueryData<{ id?: string } | null>([
        'silent-payments-event',
        user?.pubkey,
        dTag,
      ])?.id;
      if (eventId) {
        queryClient.setQueryData(['silent-payments-doc', eventId], next);
      }
      publishStorage.mutate({ next, spent });
    },
    [storage, publishStorage, queryClient, user?.pubkey, dTag],
  );

  const balance = useMemo(() => (storage ? spStorageBalance(storage) : 0), [storage]);

  if (!enabled) {
    return {
      ...EMPTY_RESULT,
      unavailableReason,
      keys,
      tipHeight,
    };
  }

  return {
    enabled: true,
    keys,
    storage,
    balance,
    isLoading: storageDocQuery.isLoading,
    isScanning,
    scanProgress,
    scanError,
    tipHeight,
    scanRange,
    scanRecent,
    cancelScan,
    pruneSpentUtxos,
  };
}
