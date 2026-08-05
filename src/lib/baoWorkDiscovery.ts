/**
 * Relay-first work discovery — the pure policy for "which work is still open?"
 *
 * The compute-credit protocol (src/lib/baoComputeCredits.ts) is public Nostr
 * events: kind 4971 = a request for compute funding, kind 4973 = the requester's
 * self-signed spend receipt ("I redeemed it"). A request is *open* (still
 * seeking funding) until its OWN author publishes a receipt for it — a
 * third-party 4972 fulfillment claim is never proof of payment.
 *
 * This module holds the pure filter so the discovery policy is unit-testable
 * with no relays. The impure relay query lives in scripts/work-core.ts.
 */
import type { ComputeCreditReceipt, ComputeCreditRequest } from "./baoComputeCredits";

/**
 * Requests that are still open (the author has not yet self-receipted them),
 * newest first. Receipts authored by OTHER pubkeys are ignored — only the
 * requester's own 4973 closes a request.
 */
export function openCreditRequests(
  requests: ComputeCreditRequest[],
  receipts: ComputeCreditReceipt[],
): ComputeCreditRequest[] {
  // requestId set, grouped by the receipt AUTHOR (the requester who redeemed).
  const receiptIdsByAuthor = new Map<string, Set<string>>();
  for (const r of receipts) {
    let set = receiptIdsByAuthor.get(r.pubkey);
    if (!set) {
      set = new Set();
      receiptIdsByAuthor.set(r.pubkey, set);
    }
    set.add(r.requestId);
  }

  return requests
    .filter((req) => !receiptIdsByAuthor.get(req.pubkey)?.has(req.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Sum of sats still being sought across the open requests. */
export function totalOpenSats(requests: ComputeCreditRequest[]): number {
  return requests.reduce((sum, r) => sum + r.amountSats, 0);
}
