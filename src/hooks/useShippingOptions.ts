import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  dedupeShippingOptions,
  parseShippingOption,
  parseShippingOptionAddress,
  SHIPPING_OPTION_KIND,
  type ShippingOption,
} from '@/lib/shippingOption';

const QUERY_TIMEOUT_MS = 15_000;

export function useSellerShippingOptions(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<ShippingOption[]>({
    queryKey: ['shipping-options', pubkey],
    enabled: !!pubkey,
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      try {
        const events = await nostr.query(
          [{ kinds: [SHIPPING_OPTION_KIND], authors: [pubkey], limit: 100 }],
          { signal: controller.signal },
        );
        return dedupeShippingOptions(events);
      } finally {
        clearTimeout(timeoutId);
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

export function useShippingOption(address: string | undefined) {
  const { nostr } = useNostr();
  const parsed = useMemo(() => (address ? parseShippingOptionAddress(address) : null), [address]);

  return useQuery<ShippingOption | null>({
    queryKey: ['shipping-option', address],
    enabled: !!parsed,
    queryFn: async ({ signal }) => {
      if (!parsed) return null;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      try {
        const events = await nostr.query(
          [
            {
              kinds: [parsed.kind],
              authors: [parsed.pubkey],
              '#d': [parsed.dTag],
              limit: 1,
            },
          ],
          { signal: controller.signal },
        );
        const latest = events.reduce<NostrEvent | undefined>((acc, ev) => {
          if (!acc || ev.created_at > acc.created_at) return ev;
          return acc;
        }, undefined);
        return latest ? parseShippingOption(latest) : null;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
