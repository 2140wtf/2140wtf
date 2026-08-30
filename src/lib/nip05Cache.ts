import { openDatabase, STORE } from '@/lib/db';

// ============================================================================
// NIP-05 IndexedDB Cache
//
// Caches NIP-05 lookup results so repeat visits skip the loading skeleton
// (and, just as importantly, stop re-fetching identifiers that are known to
// fail — e.g. CORS-blocked or absent domains). A single record per
// identifier may carry:
//   - `pubkey` + `lastVerified` for successful lookups (positive cache), and
//   - `failedAt` for failed lookups (negative cache, short 15-min TTL).
// Both can coexist: a fresh failure must never clobber a previously-resolved
// pubkey (stale data still renders), and a new success clears any earlier
// failure. Callers distinguish "known-failed recently" from "never looked
// up" via {@link getNip05FailureCached}.
// ============================================================================

/** How long a failed lookup stays negatively-cached before we retry it. */
export const NIP05_FAILURE_TTL = 15 * 60 * 1000; // 15 minutes

export interface Nip05CacheEntry {
  /** The NIP-05 identifier (e.g. "user@domain.com") */
  identifier: string;
  /** The resolved hex pubkey — present only for successful lookups. */
  pubkey?: string;
  /** Unix-ms timestamp of the last successful verification. */
  lastVerified?: number;
  /** Unix-ms timestamp of the most recent failed lookup (negative cache). */
  failedAt?: number;
}

/** Read view of a recent failure, returned by {@link getNip05FailureCached}. */
export interface Nip05FailureEntry {
  /** The NIP-05 identifier (e.g. "user@domain.com") */
  identifier: string;
  /** Unix-ms timestamp of the failed lookup. */
  failedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory mirror — hydrated once from IndexedDB so React hooks can read
// synchronously on first render (no async waterfall).
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, Nip05CacheEntry>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/** Ensure the in-memory mirror is populated.  Safe to call many times. */
export function hydrateNip05Cache(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const db = await openDatabase();
      if (!db) return; // IndexedDB unavailable — skip hydration.
      const entries: Nip05CacheEntry[] = await db.getAll(STORE.NIP05);
      for (const entry of entries) {
        memoryCache.set(entry.identifier, entry);
      }
    } catch {
      // IndexedDB read failure — silently degrade.
    } finally {
      hydrated = true;
    }
  })();

  return hydratePromise;
}

/** Read a cached entry synchronously from the in-memory mirror. */
export function getNip05Cached(identifier: string): Nip05CacheEntry | undefined {
  return memoryCache.get(identifier);
}

/**
 * Read a recent failure for `identifier` from the negative cache.
 *
 * Returns `undefined` when the identifier was never looked up OR the failure
 * is older than {@link NIP05_FAILURE_TTL} (expired → a retry is allowed).
 * This is the "known-failed recently" vs "never looked up" signal for hooks.
 */
export function getNip05FailureCached(identifier: string): Nip05FailureEntry | undefined {
  const entry = memoryCache.get(identifier);
  if (!entry?.failedAt) return undefined;
  if (Date.now() - entry.failedAt >= NIP05_FAILURE_TTL) return undefined;
  return { identifier, failedAt: entry.failedAt };
}

/**
 * Persist a failed lookup (negative cache, 15-min TTL).
 * Updates both the in-memory mirror and IndexedDB, preserving any earlier
 * successful resolution — a transient failure must not evict a known-good
 * pubkey that stale-cache rendering still depends on.
 */
export async function setNip05FailureCached(identifier: string): Promise<void> {
  const previous = memoryCache.get(identifier);
  const entry: Nip05CacheEntry = {
    identifier,
    pubkey: previous?.pubkey,
    lastVerified: previous?.lastVerified,
    failedAt: Date.now(),
  };

  memoryCache.set(identifier, entry);

  try {
    const db = await openDatabase();
    if (db) await db.put(STORE.NIP05, entry, identifier);
  } catch {
    // Write failure is non-critical — the in-memory cache still works.
  }
}

/**
 * Persist a successful NIP-05 resolution.
 * Updates both the in-memory mirror and IndexedDB. The written record has no
 * `failedAt`, which also clears any earlier negative entry for this
 * identifier — a fresh success supersedes a stale failure.
 */
export async function setNip05Cached(identifier: string, pubkey: string): Promise<void> {
  const entry: Nip05CacheEntry = {
    identifier,
    pubkey,
    lastVerified: Date.now(),
  };

  memoryCache.set(identifier, entry);

  try {
    const db = await openDatabase();
    if (db) await db.put(STORE.NIP05, entry, identifier);
  } catch {
    // Write failure is non-critical — the in-memory cache still works.
  }
}

/**
 * Remove a single entry — positive result AND negative entry together
 * (e.g. when verification fails after previously succeeding, indicating
 * the NIP-05 is no longer valid).
 */
export async function deleteNip05Cached(identifier: string): Promise<void> {
  memoryCache.delete(identifier);

  try {
    const db = await openDatabase();
    if (db) await db.delete(STORE.NIP05, identifier);
  } catch {
    // Non-critical.
  }
}

/** Clear the entire NIP-05 cache (positive and negative entries). */
export async function clearNip05Cache(): Promise<void> {
  memoryCache.clear();

  try {
    const db = await openDatabase();
    if (db) await db.clear(STORE.NIP05);
  } catch {
    // Non-critical.
  }
}
