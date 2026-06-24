import { useQuery } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import { fetchBtcPrice } from '@/lib/bitcoin';

export interface UseBtcPriceResult {
  /** Current BTC/USD price, or undefined while loading / on failure. */
  btcPrice: number | undefined;
  /** True while the first fetch is in flight. */
  isLoading: boolean;
}

/**
 * Shared BTC/USD price query.
 *
 * Uses the same TanStack Query key as the legacy inline `useQuery` calls
 * (`['btc-price', esploraApis]`) so the result is deduplicated across the
 * app. The underlying fetcher first tries the configured Esplora APIs and
 * then falls back to public exchange APIs (Coinbase, Kraken,
 * Blockchain.info, CoinGecko).
 */
export function useBtcPrice(enabled = true): UseBtcPriceResult {
  const { config } = useAppContext();

  const { data: btcPrice, isLoading } = useQuery({
    queryKey: ['btc-price', config.esploraApis],
    queryFn: ({ signal }) => fetchBtcPrice(config.esploraApis, signal),
    // Prices move; refresh every minute and treat values as fresh for 60s.
    refetchInterval: 60_000,
    staleTime: 60_000,
    // Don't surface errors — callers fall back to sats or raw price display.
    retry: 1,
    enabled,
  });

  return { btcPrice, isLoading };
}
