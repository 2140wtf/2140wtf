import { useEffect, useMemo, useRef } from 'react';
import { NRelay1, type NostrEvent } from '@nostrify/nostrify';
import type { Event } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';

import { receiptZapRequest } from '@/lib/zaps';

/**
 * Well-known public relays that LNURL servers commonly publish kind 9735
 * receipts to, regardless of the relay list embedded in the zap request
 * (many servers honor only the first few requested relays, or none at all).
 * Unioned with the caller's relays so a receipt published outside the
 * sender's relay set is still heard.
 */
const RECEIPT_FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
];

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
  expectedProviderPubkey?: string,
): void {
  // The invoice that was already detected as paid — NOT a bare boolean. The
  // dialog this hook lives in stays mounted between zaps and resets its
  // invoice state on each open, so a boolean latch would suppress detection
  // of every later QR zap for the lifetime of the component. Tracking the
  // paid invoice re-arms the listener as soon as a new invoice is shown.
  const paidInvoiceRef = useRef<string | null>(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // Sender's relays ∪ well-known receipt relays, deduped.
  const listenUrls = useMemo(
    () => [...new Set([...relayUrls, ...RECEIPT_FALLBACK_RELAYS])],
    [relayUrls],
  );

  useEffect(() => {
    if (!invoice || !target || paidInvoiceRef.current === invoice) return;

    const abortController = new AbortController();
    const since = Math.floor(Date.now() / 1000) - 60;

    const matchesInvoice = (event: NostrEvent): boolean => {
      const bolt11 = event.tags.find(([name]) => name === 'bolt11')?.[1];
      if (!bolt11 || bolt11.toLowerCase() !== invoice.toLowerCase()) return false;
      if (event.kind !== 9735 || !verifyEvent(event)) return false;
      if (expectedProviderPubkey && event.pubkey !== expectedProviderPubkey) return false;
      if (!event.tags.some(([name, value]) => name === 'p' && value === target.pubkey)) return false;

      // A receipt is not proof merely because it repeats a visible invoice.
      // Require the provider to commit the payer's signed kind-9734 request,
      // and require that request to name this exact recipient/target.
      const request = receiptZapRequest(event);
      if (!request?.tags.some(([name, value]) => name === 'p' && value === target.pubkey)) return false;
      if (target.kind !== 0 && !request.tags.some(([name, value]) => name === 'e' && value === target.id)) return false;
      return true;
    };

    const listeners = listenUrls.map(async (url) => {
      if (paidInvoiceRef.current === invoice || abortController.signal.aborted) return;
      let relay: NRelay1 | null = null;
      try {
        // NIP-57 receipts only carry an `e` tag when the zap targeted an
        // event — profile (kind 0) and QR-code zaps produce receipts with only
        // the recipient's `p` tag, which an `#e`-only filter never matches.
        // The exact bolt11 match above is the real disambiguator, so the broad
        // `#p` filter is safe to add (and invoices are unique per attempt).
        const filters = [
          { kinds: [9735], '#e': [target.id], since },
          { kinds: [9735], '#p': [target.pubkey], since },
        ];
        relay = new NRelay1(url);

        // First perform a bounded catch-up query. External wallets can settle
        // and the provider can publish its receipt in the short gap between
        // invoice display and the live WebSocket subscription becoming ready.
        const existing = await relay.query(
          filters.map((filter) => ({ ...filter, limit: 20 })),
          { signal: abortController.signal },
        );
        const caughtUp = existing.find(matchesInvoice);
        if (caughtUp && paidInvoiceRef.current !== invoice && !abortController.signal.aborted) {
          paidInvoiceRef.current = invoice;
          onPaidRef.current();
          return;
        }

        for await (const msg of relay.req(filters, { signal: abortController.signal })) {
          if (paidInvoiceRef.current === invoice || abortController.signal.aborted) break;
          if (msg[0] !== 'EVENT') continue;
          const event = msg[2];
          if (matchesInvoice(event)) {
            paidInvoiceRef.current = invoice;
            onPaidRef.current();
            break;
          }
        }
      } catch {
        // Best-effort per-relay subscription; ignore errors.
      } finally {
        relay?.close().catch(() => {});
      }
    });

    return () => {
      abortController.abort();
      void Promise.allSettled(listeners);
    };
  }, [invoice, target, listenUrls, expectedProviderPubkey]);
}
