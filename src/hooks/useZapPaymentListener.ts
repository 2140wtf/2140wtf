import { useEffect, useRef } from 'react';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';
import type { Event } from 'nostr-tools';

/**
 * Listen to configured relays for a kind 9735 zap receipt that pays the given
 * BOLT11 invoice for the target event.
 *
 * Returns true once a matching receipt is seen so callers can switch to a
 * success state without waiting for the payer's wallet callback.
 */
export function useZapPaymentListener(
  invoice: string | null,
  target: Event | undefined,
  relayUrls: string[],
  onPaid: () => void,
): void {
  const paidRef = useRef(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    if (!invoice || !target || paidRef.current) return;

    const abortController = new AbortController();
    const since = Math.floor(Date.now() / 1000) - 60;

    const matchesInvoice = (event: NostrEvent): boolean => {
      const bolt11 = event.tags.find(([name]) => name === 'bolt11')?.[1];
      return !!bolt11 && bolt11.toLowerCase() === invoice.toLowerCase();
    };

    const listeners = relayUrls.map(async (url) => {
      if (paidRef.current || abortController.signal.aborted) return;
      const relay = new NRelay1(url);
      try {
        for await (const msg of relay.req(
          [{ kinds: [9735], '#e': [target.id], since }],
          { signal: abortController.signal },
        )) {
          if (paidRef.current || abortController.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          const event = msg[2];
          if (matchesInvoice(event)) {
            paidRef.current = true;
            onPaidRef.current();
            break;
          }
        }
      } catch {
        // Best-effort per-relay subscription; ignore errors.
      } finally {
        relay.close().catch(() => {});
      }
    });

    return () => {
      abortController.abort();
      void Promise.allSettled(listeners);
    };
  }, [invoice, target, relayUrls]);
}
