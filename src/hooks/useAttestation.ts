import { useQuery } from '@tanstack/react-query';

import { attestationActive, fetchAttestation } from '@/lib/baoAttestation';

/**
 * Attestation state for one ₿AO Fund milestone (DEMO).
 *
 * Polls every 30s while anything is live (proof submitted / objection window
 * running / an attestation round open) and stops once the milestone resolves.
 * Settlement itself is lazy server-side — it happens the next time the
 * fundraiser is fetched after a window closes — so the UI refetches the
 * fundraiser after timers expire and says "resolves shortly after the
 * window closes" rather than promising an instant flip.
 */
export function useAttestation(fundraiserId: string | null | undefined, milestoneId: string | null | undefined) {
  return useQuery({
    queryKey: ['bao-attestation', fundraiserId, milestoneId],
    queryFn: () => fetchAttestation(fundraiserId!, milestoneId!),
    enabled: !!fundraiserId && !!milestoneId,
    refetchInterval: (query) => (attestationActive(query.state.data) ? 30_000 : false),
    retry: 1,
  });
}
