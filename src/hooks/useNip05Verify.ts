import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useNip05Resolve } from '@/hooks/useNip05Resolve';
import { setNip05Cached } from '@/lib/nip05Cache';

/**
 * Verifies a NIP-05 identifier against an expected pubkey.
 *
 * Primary path delegates to useNip05Resolve so both hooks share the same
 * TanStack Query cache entry — one network request serves verification and
 * resolution.
 *
 * FALLBACK (relay kind-0, VERIFICATION ONLY): when the HTTP well-known check
 * fails — CORS block, HTTP 4xx, network error (including a fresh negative-
 * cache hit inside useNip05Resolve) — or definitively reports the identifier
 * absent, we query the expected pubkey's kind-0 metadata event through the
 * app's existing Nostr pool and check whether its content JSON declares the
 * same `nip05` identifier. This is only possible for VERIFICATION because we
 * already hold the pubkey, so a single `authors: [pubkey]` filter answers the
 * question. Relay-based RESOLUTION (identifier → pubkey) is NOT attempted
 * here or in useNip05Resolve — Nostr filters cannot search event content, so
 * it is not practical.
 *
 * Returns `true` only when the identifier resolves to exactly the expected
 * pubkey (HTTP path) or the pubkey's kind-0 metadata claims the identifier
 * (relay fallback). Returns `false` while pending or if verification fails.
 */
export function useNip05Verify(nip05: string | undefined, pubkey: string | undefined) {
  const { nostr } = useNostr();
  const resolveQuery = useNip05Resolve(nip05);

  // The HTTP verification "failed" when it errored (CORS/4xx/network —
  // including the negative-cache fast-fail) or returned a definitive null
  // (identifier absent from the well-known document). While the resolve
  // query is merely pending there is nothing to fall back from yet.
  const httpFailed = !!nip05 && !!pubkey && (resolveQuery.isError || resolveQuery.data === null);

  const fallbackQuery = useQuery<boolean>({
    queryKey: ['nip05-verify-relay', nip05, pubkey],
    queryFn: async ({ signal }) => {
      // VERIFICATION-ONLY relay fallback: one kind-0 query for the pubkey we
      // already have (mirrors the pool usage in useAuthor.ts / authorQueryOptions).
      const [event] = await nostr.query(
        [{ kinds: [0], authors: [pubkey!], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );
      if (!event) return false;
      try {
        const content = JSON.parse(event.content) as { nip05?: unknown };
        // NIP-05 identifiers are case-insensitive per spec; compare modulo
        // case so a profile claiming "Chad@host" matches the URL's
        // "chad@host" — mirroring the case-insensitive name lookup in
        // useNip05Resolve.
        const matches = typeof content.nip05 === 'string'
          && content.nip05.toLowerCase() === nip05!.toLowerCase();
        if (matches) {
          // The kind-0 claim doubles as a resolution (identifier → pubkey):
          // feed it into the SAME NIP-05 cache the resolve hook uses, so
          // future visits skip both the HTTP fetch and this relay query.
          void setNip05Cached(nip05!, pubkey!);
        }
        return matches;
      } catch {
        return false; // malformed kind-0 content — cannot verify
      }
    },
    enabled: httpFailed,
    staleTime: 60 * 60 * 1000,  // 1 hour — same freshness window as resolve
    gcTime: 2 * 60 * 60 * 1000,
    retry: 1, // relay queries can transiently fail (EOSE races, flaky relays)
  });

  const { data: resolvedPubkey, ...rest } = resolveQuery;

  // Prefer the shared HTTP resolution; when it failed, the relay kind-0
  // fallback feeds the same boolean result into the same query state.
  const verified = resolvedPubkey != null
    ? !!pubkey && resolvedPubkey === pubkey
    : fallbackQuery.data === true;

  return {
    ...rest,
    data: verified,
    // A successful fallback supersedes the HTTP failure so callers see a
    // clean success instead of a confusing isError + data pair.
    isError: rest.isError && !verified,
  };
}
