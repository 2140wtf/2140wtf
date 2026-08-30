import { useQuery } from '@tanstack/react-query';

import {
  getNip05Cached,
  setNip05Cached,
  deleteNip05Cached,
  getNip05FailureCached,
  setNip05FailureCached,
} from '@/lib/nip05Cache';
import { isNostrId } from '@/lib/nostrId';

/**
 * Failure type flagging whether retrying would ever help.
 *
 * Deterministic failures — CORS-blocked responses (TypeError "Failed to
 * fetch"), HTTP 4xx, dead domains — fail identically on every retry, so the
 * old unconditional `retry: 1` doubled every blocked lookup. Transient
 * failures (timeout, HTTP 5xx) may succeed on retry.
 */
class Nip05FetchError extends Error {
  readonly deterministic: boolean;
  constructor(message: string, deterministic: boolean) {
    super(message);
    this.name = 'Nip05FetchError';
    this.deterministic = deterministic;
  }
}

/**
 * Fetches a NIP-05 nostr.json URL.
 *
 * Throws {@link Nip05FetchError} on any failure instead of returning null so
 * the caller can classify deterministic vs transient and persist a negative
 * cache entry. (CORS blocks surface as `TypeError`; the 800 ms budget as an
 * `AbortError`.)
 */
async function fetchNostrJson(url: URL, signal: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { signal });
    if (response.ok) {
      return await response.json();
    }
    // Server answered with an error status. 4xx is deterministic (the
    // identifier/domain state won't change by retrying); 5xx may be transient.
    throw new Nip05FetchError(
      `NIP-05 ${url.hostname} answered HTTP ${response.status} for ${url.searchParams.get('name')}`,
      response.status < 500,
    );
  } catch (err) {
    if (err instanceof Nip05FetchError) throw err;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const deterministic = !isTimeout;
    throw new Nip05FetchError(
      `NIP-05 fetch failed for ${url.hostname} (${err instanceof Error ? err.message : String(err)})`,
      deterministic,
    );
  }
}

/** Entries older than this are not trusted at all — show a skeleton instead. */
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Resolves a NIP-05 identifier to a pubkey by fetching the domain's
 * .well-known/nostr.json endpoint.
 *
 * Successful resolutions are persisted in IndexedDB so subsequent page
 * loads can render verified NIP-05 names instantly (no loading skeleton).
 * Entries younger than `staleTime` (1 h) render without any network
 * request.  Entries between 1 h and 7 days old render immediately while
 * a background re-check runs.  Entries older than 7 days are discarded
 * and a fresh verification is required.
 *
 * FAILURES are persisted too, as a 15-minute negative cache (see
 * nip05Cache.ts): a domain that is CORS-blocked, down, or definitively
 * missing the identifier is fast-failed on the next mounts instead of
 * being re-fetched every time any badge remounts (deterministic failures
 * are also not retried — see the `retry` callback).
 *
 * Accepts formats:
 * - `user@domain.com` → looks up `user` at `domain.com`
 * - `domain.com` (no @) → looks up `_` (default user) at `domain.com`
 */
export function useNip05Resolve(identifier: string | undefined) {
  // Read cache synchronously so TanStack Query can skip the pending state.
  const cached = identifier ? getNip05Cached(identifier) : undefined;

  // Discard entries that are too old to trust (or lack a verification stamp
  // entirely) — force a fresh verification.
  const usableCache =
    cached && typeof cached.lastVerified === 'number' && (Date.now() - cached.lastVerified < MAX_CACHE_AGE)
      ? cached
      : undefined;

  return useQuery<string | null>({
    queryKey: ['nip05-resolve', identifier],
    queryFn: async ({ signal }) => {
      if (!identifier) return null;

      // Recent failure (CORS block / down / absent, < 15 min old)? Fast-fail
      // instead of hitting the domain again — this is what stops the per-mount
      // refetch spam. A stale-but-usable positive cache still renders via
      // initialData while the negative entry suppresses the background check.
      if (getNip05FailureCached(identifier)) {
        throw new Nip05FetchError(`NIP-05 negative cache: ${identifier}`, true);
      }

      let name: string;
      let domain: string;

      // Strip leading @ (e.g. "@chad@chadwick.site" from URLs like /@chad@chadwick.site)
      const cleaned = identifier.startsWith('@') ? identifier.slice(1) : identifier;

      if (cleaned.includes('@')) {
        const atIndex = cleaned.indexOf('@');
        name = cleaned.slice(0, atIndex);
        domain = cleaned.slice(atIndex + 1);
      } else {
        // No @ means it's just a domain, look up the default user (_)
        name = '_';
        domain = cleaned;
      }

      if (!domain) return null;

      const url = new URL('/.well-known/nostr.json', `https://${domain}`);
      url.searchParams.set('name', name);

      const fetchSignal = AbortSignal.any([signal, AbortSignal.timeout(800)]);

      let data: Record<string, unknown>;
      try {
        data = await fetchNostrJson(url, fetchSignal);
      } catch (err) {
        // CORS/HTTP/network failure — persist a negative entry (15-min TTL) so
        // other mounts skip straight to the relay fallback instead of spamming
        // this domain, then surface the classified error upward.
        void setNip05FailureCached(identifier);
        throw err;
      }

      const names = data.names;
      if (!names || typeof names !== 'object') {
        // The domain responded but the identifier is gone — evict stale cache
        // AND arm a 15-min negative entry so absent identifiers stop being
        // re-fetched on every mount (the relay fallback covers verification).
        void deleteNip05Cached(identifier);
        void setNip05FailureCached(identifier);
        return null;
      }

      // Look up by exact name first; fall back to case-insensitive search
      // in case the server normalises casing differently from the stored metadata value
      const namesRecord = names as Record<string, string>;
      let pubkey: string | undefined = namesRecord[name];
      if (typeof pubkey !== 'string') {
        const entry = Object.entries(namesRecord).find(([k]) => k.toLowerCase() === name.toLowerCase());
        pubkey = entry?.[1];
      }
      if (typeof pubkey !== 'string') {
        // Identifier no longer in the JSON — evict stale cache + arm negative.
        void deleteNip05Cached(identifier);
        void setNip05FailureCached(identifier);
        return null;
      }

      // Validate that the returned value is a well-formed 64-char lowercase
      // hex pubkey. Without this check, a malicious or broken NIP-05 server
      // could return arbitrary strings that get persisted to IndexedDB and
      // later fed into Nostr filters or passed to downstream consumers.
      if (!isNostrId(pubkey)) {
        // Invalid pubkey from this domain — evict stale cache + arm negative.
        void deleteNip05Cached(identifier);
        void setNip05FailureCached(identifier);
        return null;
      }

      // Persist the successful resolution to IndexedDB (fire-and-forget).
      void setNip05Cached(identifier, pubkey);

      return pubkey;
    },
    enabled: !!identifier,
    staleTime: 60 * 60 * 1000,  // 1 hour — NIP-05 records rarely change
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    // Deterministic failures (CORS, network down, HTTP 4xx — see
    // Nip05FetchError) fail identically every time, so retrying only doubles
    // the spam against a blocked domain. Retry only transient ones (timeout,
    // HTTP 5xx), and only once.
    retry: (failureCount, error) =>
      !(error instanceof Nip05FetchError && error.deterministic) && failureCount < 1,

    // Seed from IndexedDB cache so the first render already has data.
    // TanStack Query compares initialDataUpdatedAt against staleTime:
    //   - < 1 h old  → fresh, no network request
    //   - 1 h – 7 d  → renders cached value, background refetch
    //   - > 7 d      → usableCache is undefined, normal pending/skeleton
    ...(usableCache
      ? {
        initialData: usableCache.pubkey,
        initialDataUpdatedAt: usableCache.lastVerified,
      }
      : {}),
  });
}
