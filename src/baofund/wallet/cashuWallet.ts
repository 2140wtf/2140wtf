import { Mint, Wallet, getDecodedToken, getEncodedToken, type CounterSource, type MeltQuoteResponse, type Proof } from 'cashu-ts3';
import {
  decodeCashuToken,
  isAllowedMintUrl,
  MAX_TOKEN_LENGTH,
  normalizeProofWitnessForEncode,
  safeNormalizeMintUrl,
} from '../lib/cashu/tokenUtils';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

const STORAGE_KEY = 'bao-fund-wallet';
import { isBlockedMintUrl, PRIMARY_MINT_URL } from './mintConfig';
import { recordTransaction } from './walletHistory';
export const DEFAULT_MINT_URL = PRIMARY_MINT_URL;

/**
 * Durable journal of an in-flight mint operation (R11 crash recovery).
 *
 * `inputs` are the proofs the swap consumes; `counterStart`/`keysetId` let a
 * crashed run regenerate the deterministic (NUT-09) output secrets and recover
 * them from the mint via `restore`. Persisted BEFORE the network call, so a
 * crash between the mint accepting the swap and the proof write cannot lose
 * the change or double-spend the inputs.
 *
 * Top-up (`mint`) ops consume no local inputs: the mint issues deterministic
 * outputs for our seed/counter, so recovery is a targeted NUT-09 restore.
 */
export interface PendingOp {
  kind: 'spend' | 'receive' | 'mint' | 'melt';
  inputs: Proof[];
  counterStart: number;
  keysetId: string;
  at: number;
  /** sha256 of the received token, for receive ops (audit only). */
  tokenHash?: string;
  /** Mint quote id, for top-up ops (audit only). */
  quoteId?: string;
}

/** Per-mint wallet state: proofs, recovery seed, counter and crash journal. */
export interface MintState {
  proofs: Proof[];
  /** Hex 32-byte local seed for deterministic (NUT-09) outputs. Generated
   *  once per mint on first mint operation and persisted with the wallet.
   *  NOT a spending key: it only lets a crashed swap's outputs be re-derived. */
  seed?: string;
  /** Next unused NUT-09 counter. */
  counter?: number;
  /** In-flight operation journal; present only between the pre-mint write
   *  and the committed proof write. */
  pending?: PendingOp;
}

/**
 * Multi-mint store. `mints` is the source of truth (one bucket per mint URL);
 * the top-level fields are a compatibility view of the ACTIVE mint so existing
 * callers keep working. Every write re-syncs the active bucket from the view.
 */
export interface StoredWallet {
  /** Active mint: default target for spends and the UI's selected mint. */
  mintUrl: string;
  proofs: Proof[];
  seed?: string;
  counter?: number;
  pending?: PendingOp;
  mints: Record<string, MintState>;
}

/**
 * Counter span scanned on recovery. A swap emits at most a few dozen outputs
 * (keep + send), far below this; a signature found at the LAST scanned counter
 * means the span was exhausted and recovery fails loudly rather than silently
 * dropping outputs.
 */
export const RECOVERY_SPAN = 256;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The BAO relay-hosted Cashu mint is a SIGNET test mint (markets CBANOS
 * settlement only). It used to be the Fund wallet's default; an EMPTY legacy
 * wallet pinned to it is migrated to the mainnet fallback on load. A wallet
 * with proofs on it is left alone - funds are never silently moved or
 * relabeled.
 */
const LEGACY_SIGNET_MINT = 'https://relay.bao.network/cashu';

// ---------------------------------------------------------------------------
// Reads (unrestricted - safe at any point between writes)
// ---------------------------------------------------------------------------

function parseMintState(raw: unknown): MintState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<MintState>;
  const state: MintState = {
    proofs: Array.isArray(parsed.proofs) ? (parsed.proofs as Proof[]) : [],
  };
  if (typeof parsed.seed === 'string' && HEX64.test(parsed.seed)) state.seed = parsed.seed;
  if (Number.isSafeInteger(parsed.counter) && (parsed.counter as number) >= 0) state.counter = parsed.counter as number;
  if (parsed.pending && typeof parsed.pending === 'object' && Array.isArray(parsed.pending.inputs)) {
    state.pending = parsed.pending as PendingOp;
  }
  return state;
}

/** The active-mint compatibility view for a bucket (or an empty bucket). */
function viewOf(mintUrl: string, bucket: MintState, mints: Record<string, MintState>): StoredWallet {
  return {
    mintUrl,
    proofs: bucket.proofs,
    seed: bucket.seed,
    counter: bucket.counter,
    pending: bucket.pending,
    mints,
  };
}

function emptyWallet(mintUrl: string): StoredWallet {
  const mints: Record<string, MintState> = { [mintUrl]: { proofs: [] } };
  return viewOf(mintUrl, mints[mintUrl], mints);
}

/**
 * Load the stored wallet, migrating the legacy single-mint shape in place:
 * a store without `mints` (or an active mint missing from the map) is folded
 * into a per-mint bucket. The top-level fields always mirror the active
 * bucket so existing readers keep working.
 */
export function loadStoredWallet(): StoredWallet {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyWallet(DEFAULT_MINT_URL);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawMintUrl = typeof parsed.mintUrl === 'string' && parsed.mintUrl ? parsed.mintUrl : DEFAULT_MINT_URL;
    // Canonicalize every key on read: operations always look buckets up by
    // the normalized URL, so a legacy key like `https://Mint.Example.com/`
    // would otherwise make its funds unreachable (and a switch would create a
    // second empty bucket). Colliding raw keys union by secret.
    const mintUrl = safeNormalizeMintUrl(rawMintUrl);
    const mints: Record<string, MintState> = {};
    const mergeBucket = (url: string, state: MintState): void => {
      const existing = mints[url];
      if (!existing) {
        mints[url] = state;
        return;
      }
      mints[url] = {
        proofs: unionProofsBySecret(existing.proofs, state.proofs) as Proof[],
        ...(existing.seed !== undefined ? { seed: existing.seed } : state.seed !== undefined ? { seed: state.seed } : {}),
        counter: Math.max(existing.counter ?? 0, state.counter ?? 0),
        ...(existing.pending !== undefined ? { pending: existing.pending } : state.pending !== undefined ? { pending: state.pending } : {}),
      };
    };
    if (parsed.mints && typeof parsed.mints === 'object' && !Array.isArray(parsed.mints)) {
      for (const [url, value] of Object.entries(parsed.mints as Record<string, unknown>)) {
        if (!url) continue;
        const state = parseMintState(value);
        if (state) mergeBucket(safeNormalizeMintUrl(url), state);
      }
    }
    // Legacy single-mint shape: fold the top-level fields into the active bucket.
    const legacy: MintState = {
      proofs: Array.isArray(parsed.proofs) ? (parsed.proofs as Proof[]) : [],
      ...(typeof parsed.seed === 'string' && HEX64.test(parsed.seed) ? { seed: parsed.seed } : {}),
      ...(Number.isSafeInteger(parsed.counter) && (parsed.counter as number) >= 0 ? { counter: parsed.counter as number } : {}),
      ...(parsed.pending && typeof parsed.pending === 'object' && Array.isArray((parsed.pending as Partial<PendingOp>).inputs)
        ? { pending: parsed.pending as PendingOp }
        : {}),
    };
    if (mintUrl === LEGACY_SIGNET_MINT) {
      // Owner directive 2026-09-21: no signet Cashu wallet anywhere. Never
      // open on the test mint. An empty test-mint bucket is dropped; one with
      // proofs OR recovery state (seed/counter/pending) is KEPT in the map -
      // proofs are never destroyed and a crash journal must stay recoverable -
      // but it is never the active mint. Prefer another funded mint over the
      // fallback so demotion never lands on an empty wallet.
      const signet = mints[mintUrl] ?? legacy;
      if (signet.proofs.length > 0 || signet.pending !== undefined || signet.seed !== undefined) {
        mints[mintUrl] = signet;
      }
      const alternative = Object.keys(mints).find((url) => url !== mintUrl && (mints[url]?.proofs.length ?? 0) > 0);
      const activeUrl = alternative ?? DEFAULT_MINT_URL;
      const active = mints[activeUrl] ?? { proofs: [] };
      mints[activeUrl] = active;
      return viewOf(activeUrl, active, mints);
    }
    const active = mints[mintUrl] ?? legacy;
    mints[mintUrl] = active;
    return viewOf(mintUrl, active, mints);
  } catch {
    return emptyWallet(DEFAULT_MINT_URL);
  }
}

export function sumProofs(proofs: Proof[]): number {
  return proofs.reduce((acc, p) => acc + (p.amount ?? 0), 0);
}

export interface MintSummary {
  mintUrl: string;
  balanceSats: number;
  proofCount: number;
  active: boolean;
}

/** Every known mint with its balance, active first (then URL order). */
export function listStoredMints(): MintSummary[] {
  const stored = loadStoredWallet();
  const urls = new Set([...Object.keys(stored.mints), stored.mintUrl]);
  return [...urls]
    .map((mintUrl) => {
      const bucket = stored.mints[mintUrl] ?? { proofs: [] };
      return {
        mintUrl,
        balanceSats: sumProofs(bucket.proofs),
        proofCount: bucket.proofs.length,
        active: mintUrl === stored.mintUrl,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.mintUrl.localeCompare(b.mintUrl));
}

/** Total balance across every mint. */
export function totalStoredBalance(): number {
  return listStoredMints().reduce((acc, m) => acc + m.balanceSats, 0);
}

/**
 * Subscribe to Stored Wallet changes. Fires after every committed write in
 * this tab and whenever ANOTHER tab commits one (`storage` event). Returns an
 * unsubscribe function. UI hooks use this instead of polling raw storage.
 */
export function onStoreChange(cb: () => void): () => void {
  installStorageBridge();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function tokenHash(token: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(token)));
}

// ---------------------------------------------------------------------------
// Change notification (private)
// ---------------------------------------------------------------------------

type StoreListener = () => void;
const listeners = new Set<StoreListener>();
let storageBridgeInstalled = false;

function notifyListeners(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* a broken listener must never break a committed write */
    }
  }
}

function installStorageBridge(): void {
  if (storageBridgeInstalled || typeof window === 'undefined' || !window.addEventListener) return;
  storageBridgeInstalled = true;
  window.addEventListener('storage', (e) => {
    // `storage` fires only in tabs OTHER than the writer - exactly the
    // foreign-commit signal we want to surface through the same listeners.
    if (e.key === STORAGE_KEY) notifyListeners();
  });
}

/** Return a copy of `stored` with `next` as the bucket for `mintUrl`. */
function withMintState(stored: StoredWallet, mintUrl: string, next: MintState): StoredWallet {
  const mints = { ...stored.mints, [mintUrl]: next };
  if (mintUrl !== stored.mintUrl) return { ...stored, mints };
  return viewOf(mintUrl, next, mints);
}

function saveStoredWallet(state: StoredWallet, notify = true): void {
  // Re-sync the active bucket from the compatibility view, so callers that
  // mutate only the top-level fields (the legacy idiom) stay correct.
  const mints: Record<string, MintState> = {
    ...state.mints,
    [state.mintUrl]: {
      proofs: state.proofs,
      ...(state.seed !== undefined ? { seed: state.seed } : {}),
      ...(state.counter !== undefined ? { counter: state.counter } : {}),
      ...(state.pending !== undefined ? { pending: state.pending } : {}),
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    mintUrl: state.mintUrl,
    proofs: state.proofs,
    ...(state.seed !== undefined ? { seed: state.seed } : {}),
    ...(state.counter !== undefined ? { counter: state.counter } : {}),
    ...(state.pending !== undefined ? { pending: state.pending } : {}),
    mints,
  }));
  // Single choke point for user-visible commits. The pre-mint intent journal
  // writes with notify=false: it changes no proof/mint state the UI renders,
  // and notifying would double-fire every receive/spend.
  if (notify) notifyListeners();
}

// ---------------------------------------------------------------------------
// Mint / proof plumbing (private - reachable only through the operations below)
// ---------------------------------------------------------------------------

/**
 * Deterministic counter source seeded from the persisted per-mint counter.
 *
 * cashu-ts 3.x reserves NUT-09 counters internally, per wallet operation,
 * through a `CounterSource` - there is no per-call `counter` option any more.
 * Seeding the source at the journaled `counterStart` preserves the
 * crash-recovery contract: every output the operation creates derives from
 * `counterStart` upward, so a recovery `restore(counterStart, RECOVERY_SPAN)`
 * finds them. `next` is what the operation persisted as the new counter after
 * a successful run.
 */
class StoredCounterSource implements CounterSource {
  next: number;

  constructor(start: number) {
    this.next = start;
  }

  async reserve(_keysetId: string, n: number): Promise<{ start: number; count: number }> {
    const start = this.next;
    this.next += n;
    return { start, count: n };
  }

  async advanceToAtLeast(_keysetId: string, minNext: number): Promise<void> {
    if (minNext > this.next) this.next = minNext;
  }
}

/**
 * Build a loaded wallet for a mint.
 *
 * cashu-ts 3.x requires `loadMint()` before use: it fetches /v1/info, the
 * keysets and the keys, and verifies every keyset ID with the CURRENT NUT-02
 * derivation (v1 and the final v2 spec). The 2.9.0-only
 * `KeysetCompatWallet` shim was deleted with this bump
 * (docs/KEYSET-ID-V2-COMPAT.md exit plan); cdk v2 keysets (e.g. the Minibits
 * fallback) now verify natively.
 */
async function getWallet(mintUrl: string, seedHex?: string, counters?: StoredCounterSource): Promise<Wallet> {
  const mint = new Mint(mintUrl);
  const wallet = new Wallet(mint, {
    ...(seedHex ? { bip39seed: hexToBytes(seedHex) } : {}),
    ...(counters ? { counterSource: counters } : {}),
  });
  await wallet.loadMint();
  return wallet;
}

function newSeedHex(): string {
  return bytesToHex(randomBytes(32));
}

async function receiveToken(
  wallet: Wallet,
  tokenStr: string,
  opts?: ReceiveOptions,
): Promise<Proof[]> {
  // Defensive decode FIRST: length cap + proof-shape validation + mint
  // allowlist rules from tokenUtils.
  if (typeof tokenStr !== 'string' || tokenStr.length > MAX_TOKEN_LENGTH) {
    throw new Error('Token is too large or malformed');
  }
  const decoded = getDecodedToken(tokenStr);
  if (safeNormalizeMintUrl(decoded.mint) !== safeNormalizeMintUrl(wallet.mint.mintUrl)) {
    throw new Error(`Token mint ${decoded.mint} does not match wallet mint ${wallet.mint.mintUrl}`);
  }
  if (!decodeCashuToken(tokenStr)) throw new Error('Token failed defensive validation');
  // `keysetId` binds the deterministic (NUT-09) outputs to the keyset the
  // crash journal records, so a recovery restore re-derives against the same
  // key material.
  const proofs = await wallet.receive(tokenStr, { ...opts, keysetId: wallet.keysetId });
  return Array.isArray(proofs) ? proofs : [];
}

/**
 * Union two proof lists by secret. Entries already present are never
 * replaced (first-wins), and `current` is inserted before `restored`, so
 * local proofs both win a secret collision and keep their position.
 */
function unionProofsBySecret(current: ReadonlyArray<unknown>, restored: ReadonlyArray<unknown>): unknown[] {
  const bySecret = new Map<string, unknown>();
  for (const p of current as Array<{ secret?: unknown }>) {
    const s = p?.secret;
    if (p && typeof s === 'string' && s && !bySecret.has(s)) bySecret.set(s, p);
  }
  for (const p of restored as Array<{ secret?: unknown }>) {
    const s = p?.secret;
    if (p && typeof s === 'string' && s && !bySecret.has(s)) bySecret.set(s, p);
  }
  return [...bySecret.values()];
}

interface LockManagerLike {
  request<R>(name: string, callback: () => R | Promise<R>): Promise<R>;
}

/**
 * Cross-tab exclusion: each operation runs under the per-origin web lock for
 * STORAGE_KEY, so two browser tabs can never interleave load→modify→save on
 * the same localStorage entry. Where the Locks API is unavailable (older
 * browsers, jsdom) we degrade gracefully to same-tab serialization only.
 */
function withCrossTabLock<T>(op: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  if (!locks?.request) return op();
  // The DOM LockManager flattens the callback's promise; the local structural
  // type infers R = Promise<T>, so pin the real shape here.
  return locks.request(STORAGE_KEY, op) as Promise<T>;
}

/**
 * Fail-closed guard for every mutation: an entry that cannot be parsed, or
 * that lacks the minimal top-level shape (`proofs` array + non-empty
 * `mintUrl`), must never be overwritten by `saveStoredWallet`. Those bytes
 * may hold proofs, recovery seeds or an in-flight crash journal - only a
 * human recovery/backup decision may replace them. `loadStoredWallet` stays
 * lenient (reads degrade to an empty default); every mutation funnels
 * through `enqueueOp`, so this one check covers them all.
 */
function assertStoredWalletReadable(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return; // fresh wallet: nothing to protect
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Wallet data cannot be read. Recover or back it up before using the wallet.');
  }
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    !('proofs' in parsed) || !Array.isArray((parsed as { proofs?: unknown }).proofs) ||
    !('mintUrl' in parsed) || typeof (parsed as { mintUrl?: unknown }).mintUrl !== 'string' ||
    !(parsed as { mintUrl: string }).mintUrl.trim()
  ) {
    throw new Error('Wallet data is malformed. Recover or back it up before using the wallet.');
  }
}

/**
 * Single serialized operation queue. Every mutation of the Stored Wallet -
 * spend, receive, merge, mint switch, Lightning - funnels through here:
 * within the tab via the promise chain (FIFO), across tabs via withCrossTabLock.
 * The corrupt-storage guard runs inside the lock, immediately before the
 * operation, so no mutation can observe (or overwrite) unreadable bytes.
 */
let opQueue: Promise<unknown> = Promise.resolve();

function enqueueOp<T>(op: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> =>
    withCrossTabLock(() => {
      assertStoredWalletReadable();
      return op();
    });
  const result = opQueue.then(run, run);
  opQueue = result.catch(() => {});
  return result;
}

// ---------------------------------------------------------------------------
// Crash recovery (R11)
// ---------------------------------------------------------------------------

/**
 * Resolve journaled in-flight operations left by a crash, for EVERY mint.
 * Must run inside the operation queue, before any new mint call.
 *
 * The mint's `check` endpoint is the source of truth for whether the swap
 * committed:
 *   - every input UNSPENT → the swap never reached the mint; keep the inputs
 *     and drop the marker (a retry is then safe).
 *   - any input SPENT → the swap committed; re-derive the deterministic
 *     outputs from the seed at `counterStart` and recover their signatures
 *     from the mint, then replace the consumed inputs.
 *   - inputs PENDING → ambiguous/in-flight; keep the marker and refuse to act
 *     (fail closed) so a live mint operation is never raced.
 * A `mint` marker (top-up) consumes no local inputs: it is resolved by a
 * targeted NUT-09 restore, or dropped when nothing was issued.
 *
 * Idempotent: no marker → no-op; a second run after a successful recovery
 * finds no marker and does nothing.
 */
export async function hydrateStoredWallet(): Promise<{ recovered: number }> {
  return enqueueOp(async () => {
    const result = await hydrateCore();
    if (result.recovered > 0) notifyListeners();
    // Recoveries that succeeded are committed; unresolved markers still
    // surface loudly (the boot error) without erasing the others' work.
    if (result.failures.length > 0) {
      throw new Error(`wallet recovery: ${result.failures.join('; ')}`);
    }
    return { recovered: result.recovered };
  });
}

/**
 * Recovery core - MUST be called with the operation queue already held (either
 * via `hydrateStoredWallet`, or directly from an operation that already holds
 * it). Re-enqueuing here would deadlock.
 */
async function hydrateCore(targetMint?: string): Promise<{ recovered: number; failures: string[] }> {
  let recovered = 0;
  const failures: string[] = [];
  // Snapshot the mint list; each recovery re-loads committed state. One
  // mint's unresolved marker must not block recovery (or operations) on the
  // others: collect failures and let the caller decide.
  const urls = targetMint ? [targetMint] : Object.keys(loadStoredWallet().mints);
  for (const mintUrl of urls) {
    const bucket = loadStoredWallet().mints[mintUrl];
    if (!bucket?.pending) continue;
    try {
      recovered += await recoverPendingForMint(mintUrl, bucket.pending);
    } catch (e) {
      failures.push(`${mintUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { recovered, failures };
}

/** Recover one mint's journaled operation. Returns proofs recovered (0-…). */
async function recoverPendingForMint(mintUrl: string, pending: PendingOp): Promise<number> {
  const dropMarker = (): void => {
    const stored = loadStoredWallet();
    const bucket = stored.mints[mintUrl];
    if (bucket) saveStoredWallet(withMintState(stored, mintUrl, { ...bucket, pending: undefined }));
  };
  // Top-up (mint) ops consume NO local inputs: a targeted restore recovers
  // deterministic outputs. Nothing issued → the marker is dropped (the quote
  // can be completed later).
  if (pending.kind === 'mint') {
    const bucket = loadStoredWallet().mints[mintUrl];
    if (!bucket?.seed) {
      dropMarker();
      return 0;
    }
    const wallet = await getWallet(mintUrl, bucket.seed);
    const { proofs: recoveredProofs, lastCounterWithSignature } = await wallet.restore(
      pending.counterStart,
      RECOVERY_SPAN,
      pending.keysetId ? { keysetId: pending.keysetId } : undefined,
    );
    if (recoveredProofs.length === 0) {
      dropMarker();
      return 0;
    }
    const current = loadStoredWallet();
    const cur = current.mints[mintUrl] ?? { proofs: [] };
    const merged = unionProofsBySecret(cur.proofs, recoveredProofs) as Proof[];
    saveStoredWallet(withMintState(current, mintUrl, {
      ...cur,
      proofs: merged,
      seed: cur.seed ?? bucket.seed,
      counter: Math.max(cur.counter ?? 0, (lastCounterWithSignature ?? pending.counterStart - 1) + 1),
      pending: undefined,
    }));
    return recoveredProofs.length;
  }
  const bucket = loadStoredWallet().mints[mintUrl];
  if (!bucket) return 0;
  if (!bucket.seed) {
    // No seed → deterministic outputs cannot be re-derived. Drop the marker
    // only when the inputs are provably unspent; otherwise fail loudly.
    const wallet = await getWallet(mintUrl);
    const states = await wallet.checkProofsStates(pending.inputs);
    if (states.some((s) => s.state !== 'UNSPENT')) {
      throw new Error('wallet recovery: in-flight operation with no recovery seed - manual reconciliation required');
    }
    dropMarker();
    return 0;
  }
  const wallet = await getWallet(mintUrl, bucket.seed);
  const states = await wallet.checkProofsStates(pending.inputs);
  if (states.some((s) => s.state === 'PENDING')) {
    throw new Error('wallet recovery: inputs are PENDING at the mint - retry once the mint settles');
  }
  if (!states.some((s) => s.state === 'SPENT')) {
    dropMarker();
    return 0;
  }
  const { proofs: recovered, lastCounterWithSignature } = await wallet.restore(
    pending.counterStart,
    RECOVERY_SPAN,
    pending.keysetId ? { keysetId: pending.keysetId } : undefined,
  );
  if (recovered.length > 0 && lastCounterWithSignature === pending.counterStart + RECOVERY_SPAN - 1) {
    throw new Error(`wallet recovery: counter span ${RECOVERY_SPAN} exhausted - increase RECOVERY_SPAN`);
  }
  // Drop ONLY the inputs the mint actually reports SPENT. A swap rejected
  // because one input was already spent elsewhere leaves the other selected
  // proofs UNSPENT - deleting them all (the old behavior) destroyed real
  // funds with no journal left to recover them.
  const spentSecrets = new Set(
    pending.inputs
      .filter((_, i) => states[i]?.state === 'SPENT')
      .map((p) => p.secret),
  );
  const current = loadStoredWallet();
  const cur = current.mints[mintUrl] ?? { proofs: [] };
  const kept = cur.proofs.filter((p) => !spentSecrets.has(p.secret));
  const merged = unionProofsBySecret(kept, recovered) as Proof[];
  saveStoredWallet(withMintState(current, mintUrl, {
    ...cur,
    proofs: merged,
    seed: cur.seed ?? bucket.seed,
    counter: Math.max(cur.counter ?? 0, (lastCounterWithSignature ?? pending.counterStart - 1) + 1),
    pending: undefined,
  }));
  return recovered.length;
}

/**
 * Recover journaled crashes inside the already-held operation queue. With a
 * target mint only that mint's marker is resolved (and only its failure can
 * block the operation); without one, every marker is attempted and any
 * failure surfaces after the others committed.
 */
async function recoverPendingInQueue(targetMint?: string): Promise<void> {
  if (!listStoredMints().length) return;
  const stored = loadStoredWallet();
  const urls = targetMint ? [targetMint] : Object.keys(stored.mints);
  if (!urls.some((url) => stored.mints[url]?.pending)) return;
  const { failures } = await hydrateCore(targetMint);
  if (failures.length > 0) throw new Error(`wallet recovery: ${failures.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Operations (the interface - every read-modify-write cycle lives inside one)
// ---------------------------------------------------------------------------

/** Greedy input selection (fewest proofs covering the amount). */
function selectProofs(proofs: Proof[], amount: number): Proof[] {
  const selected: Proof[] = [];
  let selectedSum = 0;
  for (const p of proofs) {
    selected.push(p);
    selectedSum += p.amount;
    if (selectedSum >= amount) break;
  }
  if (selectedSum < amount) throw new Error('Insufficient balance');
  return selected;
}

/**
 * Spend `amount` sats from one mint (the active mint by default): recover any
 * prior crash → load → select → journal the intent → swap at a deterministic
 * counter → persist change, all inside the queue. Returns the encoded send
 * token, the resulting balance at that mint and which mint was spent.
 * Callers must NOT wrap their own loadStoredWallet/saveStoredWallet around
 * this - use an operation instead.
 */
export async function spendFromStoredWallet(
  amount: number,
  mintUrl?: string,
): Promise<{ token: string; balanceAfter: number; mintUrl: string }> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive whole number of sats');
  return enqueueOp(async () => {
    const target = safeNormalizeMintUrl(mintUrl ?? loadStoredWallet().mintUrl);
    // Only THIS mint's crash marker can block this operation. Reload after
    // recovery - the recovered change is the spend's balance.
    await recoverPendingInQueue(target);
    const stored = loadStoredWallet();
    const bucket = stored.mints[target] ?? { proofs: [] };
    const seed = bucket.seed ?? newSeedHex();
    const counterStart = bucket.counter ?? 0;
    // The counter source starts exactly at the journaled counterStart; the
    // wallet reserves from it internally before the swap hits the mint.
    const counters = new StoredCounterSource(counterStart);
    const wallet = await getWallet(target, seed, counters);
    const selected = selectProofs(bucket.proofs, amount);
    saveStoredWallet(
      withMintState(stored, target, {
        proofs: bucket.proofs,
        seed,
        counter: counterStart,
        pending: { kind: 'spend', inputs: selected, counterStart, keysetId: wallet.keysetId, at: Date.now() },
      }),
      false,
    );
    const { token, change } = await sendSats(wallet, bucket.proofs, amount);
    const current = loadStoredWallet();
    recordTransaction({ type: 'send', mintUrl: target, amountSats: amount });
    saveStoredWallet(withMintState(current, target, { proofs: change, seed, counter: counters.next }));
    return { token, balanceAfter: sumProofs(change), mintUrl: target };
  });
}

/** Options forwarded to cashu-ts `receive` (e.g. P2PK unlock key). */
export interface ReceiveOptions {
  /** Wallet private key (hex) needed to spend P2PK-locked proofs. */
  privkey?: string;
}

/**
 * Receive a Cashu token into the Stored Wallet atomically, routing EVERY
 * token entry to its own mint bucket (multi-mint): recover any prior crash →
 * per entry: validate + redeem against its mint at a deterministic counter →
 * persist the new proofs inside the queue. Tokens from mints the wallet has
 * not seen before are adopted automatically - a token is self-describing and
 * cannot orphan anything because each mint keeps its own bucket.
 *
 * Error boundary: cashu-ts (2.x and 3.x) cannot decode multi-entry v3
 * ("cashuA") tokens - its decoder throws "Multi entry token are not
 * supported" (an upstream limitation, see tokenUtils.decodeCashuToken). Such tokens fail
 * closed here with "Token failed defensive validation" before any journal
 * write or mint call; BAO deliberately does NOT hand-parse them. Single-entry
 * v3 tokens are folded to the flat shape by the library and still work.
 */
export async function receiveIntoStoredWallet(
  tokenStr: string,
  opts?: ReceiveOptions,
): Promise<{ received: Proof[]; receivedSats: number; balanceAfter: number; mintUrls: string[] }> {
  return enqueueOp(async () => {
    if (typeof tokenStr !== 'string' || tokenStr.length > MAX_TOKEN_LENGTH) {
      throw new Error('Token is too large or malformed');
    }
    // Fully validate the token BEFORE journaling, so a malformed token never
    // leaves a spurious recovery marker behind.
    const entries = decodeCashuToken(tokenStr);
    if (!entries || entries.length === 0) throw new Error('Token failed defensive validation');
    const receivedAll: Proof[] = [];
    const mintUrls: string[] = [];
    for (const entry of entries) {
      const mintUrl = safeNormalizeMintUrl(entry.mintUrl);
      // Only the entry's own mint can block its receive.
      await recoverPendingInQueue(mintUrl);
      const stored = loadStoredWallet();
      const bucket = stored.mints[mintUrl] ?? { proofs: [] };
      const seed = bucket.seed ?? newSeedHex();
      const counterStart = bucket.counter ?? 0;
      const counters = new StoredCounterSource(counterStart);
      const wallet = await getWallet(mintUrl, seed, counters);
      saveStoredWallet(
        withMintState(stored, mintUrl, {
          proofs: bucket.proofs,
          seed,
          counter: counterStart,
          pending: {
            kind: 'receive',
            inputs: entry.proofs as Proof[],
            counterStart,
            keysetId: wallet.keysetId,
            at: Date.now(),
            tokenHash: tokenHash(tokenStr),
          },
        }),
        false,
      );
      // Re-encode the single entry for its own mint: witness strings are
      // parsed back to objects first (a double-encoded witness fails P2PK
      // signature checks at the mint).
      const entryToken = getEncodedToken({
        mint: mintUrl,
        proofs: (entry.proofs as Proof[]).map(normalizeProofWitnessForEncode),
        unit: 'sat',
      });
      const received = await receiveToken(wallet, entryToken, opts);
      const current = loadStoredWallet();
      const cur = current.mints[mintUrl] ?? { proofs: [] };
      const next = [...cur.proofs, ...received];
      recordTransaction({ type: 'receive', mintUrl, amountSats: sumProofs(received), tokenHash: tokenHash(tokenStr) });
      saveStoredWallet(withMintState(current, mintUrl, {
        proofs: next,
        seed: cur.seed ?? seed,
        counter: counters.next,
      }));
      receivedAll.push(...received);
      mintUrls.push(mintUrl);
    }
    return {
      received: receivedAll,
      receivedSats: sumProofs(receivedAll),
      balanceAfter: totalStoredBalance(),
      mintUrls,
    };
  });
}

/**
 * Merge restored per-mint proof sets into the Stored Wallet atomically.
 * Every incoming mint keeps its own bucket (union by secret, local wins), so
 * restoring a NIP-60 wallet with several mints never drops or relabels
 * anything. Active-mint selection: keep the current active mint when it holds
 * proofs; otherwise prefer `preferredMint`, then the first mint with proofs,
 * then the default.
 */
export async function mergeStoredProofs(
  proofsByMint: Record<string, unknown[]>,
  preferredMint?: string,
): Promise<{ activeMint: string; balanceAfter: number }> {
  return enqueueOp(async () => {
    const stored = loadStoredWallet();
    const mints: Record<string, MintState> = { ...stored.mints };
    for (const [rawUrl, incoming] of Object.entries(proofsByMint)) {
      if (!rawUrl || !Array.isArray(incoming) || incoming.length === 0) continue;
      const mintUrl = safeNormalizeMintUrl(rawUrl);
      // Restored NIP-60 events are stale by nature (another device may have
      // spent them): ask the mint which are still UNSPENT before unioning,
      // or the wallet shows a phantom balance whose next send is rejected.
      // On a check failure keep everything - never drop proofs we could not
      // prove spent.
      let additions = incoming;
      try {
        // checkProofsStates only hits /v1/check - no key material needed, so
        // no loadMint() here: it would add an /v1/info round-trip inside the
        // serialized op queue (and outside the bound below).
        const wallet = new Wallet(new Mint(mintUrl));
        // Bounded: this runs inside the serialized op queue, so a
        // black-holing mint must not stall every wallet action.
        const states = await Promise.race([
          wallet.checkProofsStates(incoming as Proof[]),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
        ]);
        if (Array.isArray(states) && states.length === incoming.length) {
          additions = incoming.filter((_, i) => states[i]?.state !== 'SPENT');
        }
      } catch {
        /* mint unreachable: keep the restored proofs */
      }
      const bucket = mints[mintUrl] ?? { proofs: [] };
      mints[mintUrl] = { ...bucket, proofs: unionProofsBySecret(bucket.proofs, additions) as Proof[] };
    }
    const hasProofs = (url: string | undefined): boolean => Boolean(url && (mints[url]?.proofs.length ?? 0) > 0);
    const preferred = preferredMint ? safeNormalizeMintUrl(preferredMint) : undefined;
    const activeMint =
      hasProofs(stored.mintUrl) ? stored.mintUrl
        : hasProofs(preferred) ? (preferred as string)
          : Object.keys(mints).find(hasProofs) ?? preferred ?? Object.keys(mints)[0] ?? stored.mintUrl;
    const bucket = mints[activeMint] ?? { proofs: [] };
    mints[activeMint] = bucket;
    saveStoredWallet(viewOf(activeMint, bucket, mints));
    return {
      activeMint,
      balanceAfter: Object.values(mints).reduce((acc, b) => acc + sumProofs(b.proofs), 0),
    };
  });
}

/**
 * Select the ACTIVE mint (adding it when new). Multi-mint semantics: proofs
 * stay attached to the mint that issued them, so switching never orphans
 * funds - each mint keeps its own bucket, seed, counter and crash journal.
 * Refuses malformed storage rather than overwriting possible recovery data.
 */
export async function switchStoredMint(mintUrl: string): Promise<void> {
  return enqueueOp(async () => {
    if (typeof mintUrl !== 'string' || !mintUrl.trim()) throw new Error('Mint URL is required');
    const target = safeNormalizeMintUrl(mintUrl);
    // Corrupt storage is rejected by the queue guard before this body runs.
    const stored = loadStoredWallet();
    if (target === stored.mintUrl) return;
    const existing = stored.mints[target];
    // A blocked host (BAO signet test mint) is refused even when a bucket
    // already exists: the legacy migration keeps a funded signet bucket in the
    // map so its proofs survive, but it must never become the active mint
    // (owner rule 2026-09-21: no signet wallet anywhere).
    if (isBlockedMintUrl(target) || (!existing && !isAllowedMintUrl(target))) {
      throw new Error('Mint URL must be a public https:// address (test-network mints cannot be added)');
    }
    const bucket = existing ?? { proofs: [] };
    const mints = { ...stored.mints, [target]: bucket };
    saveStoredWallet(viewOf(target, bucket, mints));
  });
}

/**
 * Forget a mint. Refuses while it holds proofs or a crash marker, so removal
 * can never strand funds or recovery data. Switching the active mint away
 * happens automatically when the removed mint was active.
 */
export async function removeStoredMint(mintUrl: string): Promise<void> {
  return enqueueOp(async () => {
    const target = safeNormalizeMintUrl(mintUrl);
    const stored = loadStoredWallet();
    const bucket = stored.mints[target];
    if (bucket && bucket.proofs.length > 0) {
      throw new Error('Cannot remove a mint that still holds proofs. Move or redeem those funds first.');
    }
    if (bucket?.pending) {
      throw new Error('Cannot remove a mint while an operation is recovering. Retry once recovery completes.');
    }
    const mints = { ...stored.mints };
    delete mints[target];
    const activeMint = stored.mintUrl === target ? Object.keys(mints)[0] ?? DEFAULT_MINT_URL : stored.mintUrl;
    const active = mints[activeMint] ?? { proofs: [] };
    mints[activeMint] = active;
    saveStoredWallet(viewOf(activeMint, active, mints));
  });
}

// ---------------------------------------------------------------------------
// Lightning (NUT-04 mint / NUT-05 melt) — the wallet's own on/off ramp
// ---------------------------------------------------------------------------

export interface LightningTopUp {
  quoteId: string;
  invoice: string;
  amountSats: number;
  expiry: number | null;
  /** Mint the quote belongs to. */
  mintUrl: string;
}

/**
 * Persisted open top-up quote. NUT-04 has no auto-refund: if the invoice is
 * paid while the UI is unmounted, the quote id must survive or the sats stay
 * uncredited at the mint forever. One open quote at a time is enough for the
 * wallet UI (and the pledge top-up panel).
 */
const TOPUP_QUOTE_KEY = 'bao-fund-wallet-topup';

export function loadPendingTopUp(): LightningTopUp | null {
  try {
    const raw = localStorage.getItem(TOPUP_QUOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LightningTopUp>;
    if (
      typeof parsed.quoteId !== 'string' || !parsed.quoteId ||
      typeof parsed.invoice !== 'string' || !parsed.invoice ||
      typeof parsed.mintUrl !== 'string' || !parsed.mintUrl ||
      !Number.isSafeInteger(parsed.amountSats) || (parsed.amountSats as number) <= 0
    ) {
      return null;
    }
    // Expired quotes can never mint: drop them.
    if (typeof parsed.expiry === 'number' && parsed.expiry > 0 && parsed.expiry < Math.floor(Date.now() / 1000)) {
      clearPendingTopUp();
      return null;
    }
    return {
      quoteId: parsed.quoteId,
      invoice: parsed.invoice,
      amountSats: parsed.amountSats as number,
      expiry: typeof parsed.expiry === 'number' ? parsed.expiry : null,
      mintUrl: parsed.mintUrl,
    };
  } catch {
    return null;
  }
}

export function clearPendingTopUp(): void {
  try {
    localStorage.removeItem(TOPUP_QUOTE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Mintable amount of the persisted open quote, when it is the quote being
 * completed at this mint. The NUT-04 check response is NOT required to carry
 * `amount` (cashu-ts's string overload returns the mint body raw), so a
 * spec-shaped reply must fall back to what the create response stored - a
 * PAID invoice would otherwise be stranded at the mint forever.
 */
function persistedTopUpAmount(mintUrl: string, quoteId: string): number {
  const pending = loadPendingTopUp();
  if (!pending || pending.quoteId !== quoteId) return 0;
  if (safeNormalizeMintUrl(pending.mintUrl) !== mintUrl) return 0;
  return pending.amountSats;
}

/**
 * Create a Lightning invoice that mints sats into the stored wallet (NUT-04).
 * `mintUrl` defaults to the active mint. The quote is persisted so a paid
 * invoice can still be minted after a reload/tab switch.
 */
export async function createLightningTopUp(amountSats: number, mintUrl?: string): Promise<LightningTopUp> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Amount must be a positive whole number of sats');
  const stored = loadStoredWallet();
  const target = safeNormalizeMintUrl(mintUrl ?? stored.mintUrl);
  const bucket = stored.mints[target] ?? { proofs: [] };
  const wallet = await getWallet(target, bucket.seed ?? newSeedHex());
  const quote = await wallet.createMintQuote(amountSats);
  if (!quote?.quote || !quote?.request) throw new Error('The mint did not return a Lightning invoice');
  const topUp: LightningTopUp = {
    quoteId: quote.quote,
    invoice: quote.request,
    amountSats: quote.amount ?? amountSats,
    expiry: (quote as { expiry?: number | null }).expiry ?? null,
    mintUrl: target,
  };
  try {
    localStorage.setItem(TOPUP_QUOTE_KEY, JSON.stringify(topUp));
  } catch {
    /* storage unavailable: the in-memory quote still works this session */
  }
  return topUp;
}

/**
 * Complete a top-up once the invoice is paid: check the quote, mint at the
 * deterministic counter (journaled first) and persist the proofs. Safe to
 * poll; returns `pending` until the mint sees the payment.
 */
export async function completeLightningTopUp(
  quoteId: string,
  mintUrl?: string,
): Promise<{ state: 'paid' | 'pending'; minted: number; balanceAfter: number }> {
  if (typeof quoteId !== 'string' || quoteId.length === 0 || quoteId.length > 256) throw new Error('A mint quote id is required');
  return enqueueOp(async () => {
    const target = safeNormalizeMintUrl(mintUrl ?? loadStoredWallet().mintUrl);
    await recoverPendingInQueue(target);
    const stored = loadStoredWallet();
    const bucket = stored.mints[target] ?? { proofs: [] };
    const seed = bucket.seed ?? newSeedHex();
    const counterStart = bucket.counter ?? 0;
    const counters = new StoredCounterSource(counterStart);
    const wallet = await getWallet(target, seed, counters);
    const quote = await wallet.checkMintQuote(quoteId);
    if (quote.state === 'ISSUED') {
      // Already minted (crash between mint and commit): recover via restore.
      const { proofs: recovered, lastCounterWithSignature } = await wallet.restore(counterStart, RECOVERY_SPAN, { keysetId: wallet.keysetId });
      const current = loadStoredWallet();
      const cur = current.mints[target] ?? { proofs: [] };
      const merged = unionProofsBySecret(cur.proofs, recovered) as Proof[];
      const added = Math.max(0, merged.length - cur.proofs.length);
      // Record BEFORE the notifying save so the store listener's refresh sees
      // the entry, and only for genuinely NEW proofs: a second caller on an
      // already-ISSUED quote restores nothing new and must not re-record.
      if (added > 0) {
        recordTransaction({ type: 'topup', mintUrl: target, amountSats: sumProofs(recovered) });
      }
      saveStoredWallet(withMintState(current, target, {
        proofs: merged,
        seed: cur.seed ?? seed,
        counter: Math.max(counterStart, (lastCounterWithSignature ?? counterStart - 1) + 1),
      }));
      clearPendingTopUp();
      return { state: 'paid' as const, minted: sumProofs(recovered), balanceAfter: sumProofs(merged) };
    }
    if (quote.state !== 'PAID') return { state: 'pending' as const, minted: 0, balanceAfter: sumProofs(bucket.proofs) };
    const amount = quote.amount ?? persistedTopUpAmount(target, quoteId);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('The mint quote has no mintable amount');
    saveStoredWallet(
      withMintState(stored, target, {
        proofs: bucket.proofs,
        seed,
        counter: counterStart,
        pending: { kind: 'mint', inputs: [], counterStart, keysetId: wallet.keysetId, at: Date.now(), quoteId },
      }),
      false,
    );
    const minted = await wallet.mintProofs(amount, quoteId, { keysetId: wallet.keysetId });
    const current = loadStoredWallet();
    const cur = current.mints[target] ?? { proofs: [] };
    const next = unionProofsBySecret(cur.proofs, minted) as Proof[];
    recordTransaction({ type: 'topup', mintUrl: target, amountSats: sumProofs(minted) });
    saveStoredWallet(withMintState(current, target, { proofs: next, seed: cur.seed ?? seed, counter: counters.next }));
    clearPendingTopUp();
    return { state: 'paid' as const, minted: sumProofs(minted), balanceAfter: sumProofs(next) };
  });
}

export interface LightningPaymentQuote {
  /** Raw melt quote — pass back to `payLightningQuote`. */
  quote: MeltQuoteResponse;
  amountSats: number;
  feeReserveSats: number;
  expiry: number | null;
  /** Mint the quote belongs to. */
  mintUrl: string;
}

/** Get a melt quote for a bolt11 invoice (NUT-05) — no funds move yet. */
export async function quoteLightningPayment(invoice: string, mintUrl?: string): Promise<LightningPaymentQuote> {
  const bolt11 = String(invoice ?? '').replace(/^lightning:/i, '').trim();
  if (!/^ln(bc|tb|tbs|bcrt|sb)[0-9a-z]+$/i.test(bolt11) || bolt11.length > 4096) throw new Error('Paste a valid Lightning invoice');
  const stored = loadStoredWallet();
  const target = safeNormalizeMintUrl(mintUrl ?? stored.mintUrl);
  const bucket = stored.mints[target] ?? { proofs: [] };
  const wallet = await getWallet(target, bucket.seed ?? newSeedHex());
  const quote = await wallet.createMeltQuote(bolt11);
  if (!quote?.quote) throw new Error('The mint did not return a payment quote');
  return {
    quote,
    amountSats: quote.amount,
    feeReserveSats: quote.fee_reserve,
    expiry: (quote as { expiry?: number | null }).expiry ?? null,
    mintUrl: target,
  };
}

/**
 * Pay a quoted Lightning invoice. Consumes proofs (journaled first; a crash
 * recovers the deterministic change via the same NUT-09 restore path as a
 * spend) and persists the returned change.
 */
export async function payLightningQuote(
  quote: MeltQuoteResponse,
  mintUrl?: string,
): Promise<{ paid: boolean; changeSats: number; balanceAfter: number; state: string }> {
  if (!quote || typeof quote.quote !== 'string' || quote.quote.length === 0) throw new Error('A payment quote is required');
  return enqueueOp(async () => {
    const target = safeNormalizeMintUrl(mintUrl ?? loadStoredWallet().mintUrl);
    await recoverPendingInQueue(target);
    const stored = loadStoredWallet();
    const bucket = stored.mints[target] ?? { proofs: [] };
    const seed = bucket.seed ?? newSeedHex();
    const counterStart = bucket.counter ?? 0;
    const counters = new StoredCounterSource(counterStart);
    const wallet = await getWallet(target, seed, counters);
    // A re-submitted quote (double click / retry after a lost response) can
    // already be PAID at the mint: melting it again would consume the fresh
    // inputs without the mint taking them. Fail closed on any non-UNPAID
    // state instead.
    const fresh = await wallet.checkMeltQuote(quote.quote);
    const freshState = String((fresh as { state?: unknown }).state ?? 'UNPAID');
    if (freshState !== 'UNPAID') {
      return {
        paid: freshState === 'PAID',
        changeSats: 0,
        balanceAfter: sumProofs(bucket.proofs),
        state: freshState,
      };
    }
    const selected = selectProofs(bucket.proofs, quote.amount + quote.fee_reserve);
    saveStoredWallet(
      withMintState(stored, target, {
        proofs: bucket.proofs,
        seed,
        counter: counterStart,
        pending: { kind: 'melt', inputs: selected, counterStart, keysetId: wallet.keysetId, at: Date.now(), quoteId: quote.quote },
      }),
      false,
    );
    const result = await wallet.meltProofs(quote, selected, { keysetId: wallet.keysetId });
    const selectedSet = new Set(selected);
    const kept = bucket.proofs.filter((p) => !selectedSet.has(p));
    const change = (result?.change ?? []) as Proof[];
    const next = [...kept, ...change];
    // NUT-09: the mint was handed deterministic blank outputs for the WHOLE
    // leftover (cashu-ts: ceil(log2(leftover)) || 1), not just the ones it
    // used as change. `counters.next` has advanced past every submitted
    // counter (cashu-ts reserved them), so the next op never re-derives
    // already-submitted secrets.
    const leftover = Math.max(0, sumProofs(selected) - quote.amount);
    const state = String(result?.quote?.state ?? 'PAID');
    recordTransaction({
      type: 'pay',
      mintUrl: target,
      amountSats: quote.amount,
      // Actual fee = leftover after the minted amount minus the returned
      // change (the fee reserve is only an upper bound).
      feeSats: Math.max(0, leftover - sumProofs(change)),
    });
    saveStoredWallet(withMintState(loadStoredWallet(), target, {
      proofs: next,
      seed,
      counter: counters.next,
    }));
    return { paid: state === 'PAID', changeSats: sumProofs(change), balanceAfter: sumProofs(next), state };
  });
}

// ---------------------------------------------------------------------------
// Send internals (private - only ever reached through spendFromStoredWallet)
// ---------------------------------------------------------------------------

async function sendSats(
  wallet: Wallet,
  proofs: Proof[],
  amount: number,
): Promise<{ token: string; change: Proof[] }> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Amount must be a positive whole number of sats');
  const selected = selectProofs(proofs, amount);
  // `keysetId` pins the deterministic (NUT-09) outputs to the journaled
  // keyset; the counters come from the wallet's seeded counter source.
  const { keep, send } = await wallet.send(amount, selected, { keysetId: wallet.keysetId });
  // CRITICAL: cashu-ts `send` only returns change (keep) for the proofs we
  // PASSED IN. Any unselected tail of the wallet would be silently dropped
  // by callers that persist `change` as the new wallet - real, unspent,
  // valid proofs erased client-side. Carry the tail through.
  const selectedSet = new Set(selected);
  const unselected = proofs.filter((p) => !selectedSet.has(p));
  // Flat v3 token shape ({ mint, proofs }) - the { token: [...] } container is
  // the decode-side vocabulary; encoding with it crashes on hasNonHexId.
  const token = getEncodedToken({ mint: wallet.mint.mintUrl, proofs: send, unit: 'sat' });
  return { token, change: [...keep, ...unselected] };
}
