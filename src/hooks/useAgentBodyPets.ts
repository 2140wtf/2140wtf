import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  buildAgentBodyMap,
  normalizeAgentPubkeys,
  type PetBodyInfo,
} from '@/lib/petBodies';
import { KIND_PETS_STATE, PETS_ECOSYSTEM_NAMESPACE } from '@/pets/core/lib/pets';

/** Bound on the pet-state events scanned for agent bodies. */
const AGENT_BODY_FETCH_LIMIT = 500;

/** Per-fetch relay timeout. */
const AGENT_BODY_QUERY_TIMEOUT = 10_000;

/**
 * Find the pet bodies of a set of ₿AO chat agents.
 *
 * A pet is an agent's body when its kind 31124 state event carries
 * `['agent', '<agent-pubkey>']` (see `src/lib/petFundraising.ts`). Relays
 * only index single-letter tag filters (NIP-01), so `#agent` isn't queryable;
 * instead we fetch the recent pets-ecosystem state events via the
 * single-letter `#b` namespace tag and match the `agent` tag client-side
 * (`buildAgentBodyMap`). Kind 31124 is addressable (one event per pet), so
 * the bounded scan covers the active pet population.
 *
 * The relay scan is a single shared query (`['agent-body-pets']`), so any
 * number of callers (one per chat row, per member row) share one fetch; the
 * per-caller filtering is a memo over the cached map. Relay failures degrade
 * to an empty map — the hook never throws.
 *
 * Returns the TanStack Query result fields plus `bodies`:
 * `Map<agentPubkey, PetBodyInfo>` covering the requested agents that have a
 * body (gracefully empty while loading, on error, or when nobody does).
 */
export function useAgentBodyPets(agentPubkeys: string[]) {
  const { nostr } = useNostr();

  const wanted = useMemo(() => normalizeAgentPubkeys(agentPubkeys), [agentPubkeys]);
  // Stable primitive for the memo deps below (wanted is rebuilt per render).
  const wantedKey = wanted.join(',');

  const query = useQuery<Map<string, PetBodyInfo>>({
    queryKey: ['agent-body-pets'],
    queryFn: async ({ signal }) => {
      try {
        const events = await nostr.query(
          [{
            kinds: [KIND_PETS_STATE],
            '#b': [PETS_ECOSYSTEM_NAMESPACE],
            limit: AGENT_BODY_FETCH_LIMIT,
          }],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(AGENT_BODY_QUERY_TIMEOUT)]) },
        );
        return buildAgentBodyMap(events);
      } catch (err) {
        console.warn('Failed to fetch agent pet bodies:', err);
        return new Map<string, PetBodyInfo>();
      }
    },
    enabled: wanted.length > 0,
    staleTime: 60_000, // 1 minute — bodies change only when a pet is (un)assigned
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const bodies = useMemo(() => {
    const all = query.data;
    const map = new Map<string, PetBodyInfo>();
    if (!all) return map;
    for (const pk of wantedKey ? wantedKey.split(',') : []) {
      const body = all.get(pk);
      if (body) map.set(pk, body);
    }
    return map;
  }, [query.data, wantedKey]);

  return {
    bodies,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
