import { useQuery } from '@tanstack/react-query';

import { fetchLightningNetworkStats } from '@/lib/lightningObservatory';

/** Live Lightning Network aggregate stats from lightningobservatory.com (1 min refresh). */
export function useLightningNetworkStats() {
  return useQuery({
    queryKey: ['lightning-observatory-network'],
    queryFn: ({ signal }) => fetchLightningNetworkStats(signal),
    refetchInterval: 60_000,
    // The public endpoint has no CORS headers, so without a same-origin proxy
    // every fetch fails — don't compound that with retries.
    retry: 1,
  });
}
