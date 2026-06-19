import { useQuery } from '@tanstack/react-query';

export type VolumeRange = '1H' | '1D' | '1W' | '1M' | 'ALL';

export interface VolumeBucket {
  /** Unix timestamp in seconds of the bucket start. */
  time: number;
  /** Sats traded in that bucket. */
  volume: number;
}

export interface VolumeResponse {
  marketId: string;
  range: VolumeRange;
  buckets: VolumeBucket[];
}

const API_BASE = '/v1';

async function fetchVolume(
  marketId: string,
  range: VolumeRange,
  signal: AbortSignal,
): Promise<VolumeResponse> {
  const params = new URLSearchParams({ marketId, range });
  const res = await fetch(`${API_BASE}/volume?${params.toString()}`, { signal });

  if (!res.ok) {
    throw new Error(`Volume API returned ${res.status}`);
  }

  const data = (await res.json()) as VolumeResponse;

  if (!data.buckets || !Array.isArray(data.buckets)) {
    throw new Error('Invalid volume response: missing buckets array');
  }

  return data;
}

export function useBaoMarketVolume(marketId: string | null, range: VolumeRange = 'ALL') {
  return useQuery<VolumeResponse>({
    queryKey: ['bao-market-volume', marketId, range],
    queryFn: async ({ signal }) => {
      if (!marketId) {
        throw new Error('marketId is required');
      }
      return fetchVolume(marketId, range, signal);
    },
    enabled: !!marketId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
