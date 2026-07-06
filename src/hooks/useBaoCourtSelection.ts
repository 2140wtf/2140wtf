import { useQuery } from '@tanstack/react-query';
import { NRelay1, type NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  BAO_COURT_SELECTION_KIND,
  parseSelectionEvent,
  validateSelectionEvent,
  type SelectedJuror,
} from '@bao/frost-court';

const RELAY = 'wss://relay.bao.network';
const QUERY_TIMEOUT_MS = 15_000;

export interface BaoCourtSelectionResult {
  readonly selectedJurors: SelectedJuror[];
  readonly myJurorIdx: number;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Fetch the kind 38030 jury-selection event for a dispute and map it to the
 * `SelectedJuror[]` shape expected by `useJurorSession`. Non-selected users
 * get `myJurorIdx = -1`.
 */
export function useBaoCourtSelection(disputeId: string | undefined): BaoCourtSelectionResult {
  const { user } = useCurrentUser();

  const query = useQuery<SelectedJuror[], Error>({
    queryKey: ['bao-court-selection', disputeId],
    queryFn: async ({ signal }) => {
      if (!disputeId) return [];

      const relay = new NRelay1(RELAY);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const filter: NostrFilter = {
          kinds: [BAO_COURT_SELECTION_KIND],
          '#dispute': [disputeId],
          limit: 20,
        };
        const events = await relay.query([filter], { signal: controller.signal });

        // Pick the latest valid selection event.
        let selected: SelectedJuror[] = [];
        let latest = 0;
        for (const event of events) {
          const parsed = parseSelectionEvent(event);
          if (!parsed || parsed.disputeId !== disputeId) continue;
          const validation = validateSelectionEvent(event, parsed.disputeId);
          if (!validation.valid) continue;
          if (event.created_at > latest) {
            latest = event.created_at;
            selected = parsed.selected.map((entry) => ({
              idx: entry.idx,
              nostrPubkey: entry.pubkey,
              stakeCapacitySats: entry.stake,
              stakeCommitment: {
                amountSats: entry.stake,
                bondAddress: '',
                status: 'confirmed' as const,
                committedAt: event.created_at,
              },
              wotScore: 80,
              categories: [],
              registeredAt: event.created_at,
              priority: entry.idx,
            }));
          }
        }
        return selected;
      } finally {
        clearTimeout(timeoutId);
        relay.close().catch(() => {});
      }
    },
    enabled: !!disputeId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const selectedJurors = query.data ?? [];
  const myJurorIdx = user
    ? selectedJurors.find((j) => j.nostrPubkey === user.pubkey)?.idx ?? -1
    : -1;

  return {
    selectedJurors,
    myJurorIdx,
    isLoading: query.isLoading,
    error: query.error,
  };
}
