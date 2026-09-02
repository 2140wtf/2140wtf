/**
 * Client-side proxy bidding engine.
 *
 * Watches a live auction and, on behalf of a bidder with a committed secret
 * max, publishes the minimal visible raises needed to hold the lead — eBay
 * proxy behavior in a decentralized system:
 *
 *  - The max stays sealed (auctionCommit.ts); rivals see only the raises.
 *  - Each raise is a NEW unique bid slot (kind 30401, `d = proxy-…`) so the
 *    full raise history persists publicly and computeStandingState() — and
 *    any other client — sees the same sequence.
 *  - Escrow is exact: every raise locks exactly its own amount (the dialog
 *    locks the max up front; the engine's raise events reference the same
 *    bidder escrow P2PK, and settlement releases only the winning amount —
 *    losing raises refund via the existing locktime/operator paths).
 *  - Re-entrancy safe: the engine re-reads the freshest history (including
 *    its own raises) before each raise decision, and never raises while a
 *    publish is in flight.
 *  - Soft-close aware: raises stop when the auction is effectively closed.
 */

import { useEffect, useRef } from 'react';

import type { AuctionBid, AuctionListing } from '@/lib/cashu/auction';
import { auctionAddress } from '@/lib/cashu/auction';
import {
  isEffectivelyClosed,
  proxyRaises,
  bidIncrementSats,
} from '@/lib/cashu/auctionRules';
import { loadCommitSecret } from '@/lib/cashu/auctionCommit';

interface ProxyEngineArgs {
  auction: AuctionListing | null | undefined;
  /** Full public bid history for the auction (react-query maintained). */
  bids: AuctionBid[];
  /** The signed-in bidder's pubkey, when bidding is possible. */
  bidderPubkey: string | null | undefined;
  /** The bidder's escrow P2PK key (tags each raise). */
  escrowPubkey: string | null | undefined;
  /** Publish a signed kind-30401 raise event. */
  publishRaise: (args: {
    auctionAddress: string;
    amountSats: number;
    bidSlot: string;
    escrowPubkey: string;
    maxCommit: string;
  }) => Promise<void>;
  /** Called when the engine raises, for UI feedback. */
  onRaised?: (amountSats: number) => void;
  /** Called when the engine cannot keep the lead (outbid beyond max). */
  onOutbid?: (standingSats: number) => void;
  /** Poll interval while active, ms. */
  pollMs?: number;
}

/**
 * Drives proxy auto-raising for the signed-in bidder. Mount once per
 * auction the user is actively bidding on. All decisions flow through
 * `proxyRaises()` from auctionRules — this hook is only the loop + I/O.
 */
export function useProxyBidding(args: ProxyEngineArgs): void {
  const {
    auction,
    bids,
    bidderPubkey,
    escrowPubkey,
    publishRaise,
    onRaised,
    onOutbid,
    pollMs = 15_000,
  } = args;

  // Latest args in refs so the interval callback always sees fresh state
  // without resetting the timer on every render.
  const stateRef = useRef({ auction, bids, bidderPubkey, escrowPubkey, publishRaise, onRaised, onOutbid });
  stateRef.current = { auction, bids, bidderPubkey, escrowPubkey, publishRaise, onRaised, onOutbid };

  const busyRef = useRef(false);

  useEffect(() => {
    if (!auction || !bidderPubkey) return;
    const addr = auctionAddress(auction.pubkey, auction.dTag);

    const tick = async () => {
      const s = stateRef.current;
      if (busyRef.current || !s.auction || !s.bidderPubkey || !s.escrowPubkey) return;
      busyRef.current = true;
      try {
        // Soft-close: stop raising once the auction is effectively closed.
        if (isEffectivelyClosed({ listedClosesAt: s.auction.closesAt, bids: s.bids, nowSeconds: Math.floor(Date.now() / 1000) })) {
          return;
        }

        // The bidder's secret max — commitment was created when they placed
        // the sealed bid. No secret → not a proxy bidder here.
        const secret = loadCommitSecret({ pubkey: s.bidderPubkey, auctionAddress: addr, scope: 'max' });
        if (!secret) return;

        // Standing state from the FULL public history.
        const ordered = s.bids.slice().sort((a, b) => a.createdAt - b.createdAt || b.amountSats - a.amountSats);
        let standing: AuctionBid | null = null;
        for (const b of ordered) {
          if (standing === null || b.amountSats > standing.amountSats) standing = b;
        }
        const standingSats = standing?.amountSats ?? null;
        const mine = ordered.filter((b) => b.pubkey === s.bidderPubkey);
        const myLatest = mine[mine.length - 1] ?? null;

        // Outbid beyond our max → notify, stop raising.
        if (standing && standing.pubkey !== s.bidderPubkey) {
          const floorBid = standingSats! + bidIncrementSats(standingSats!);
          if (secret.valueSats < floorBid) {
            s.onOutbid?.(standingSats!);
            return;
          }
        }

        const raises = proxyRaises({
          standing,
          standingSats,
          myLatestBid: myLatest,
          maxSats: secret.valueSats,
          startingSats: s.auction.startingSats,
          bidderPubkey: s.bidderPubkey,
        });
        if (raises.length === 0) return;

        // Reveal-time guard: never publish a raise above the committed max.
        const amount = Math.min(raises[0].amountSats, secret.valueSats);
        if (amount <= (myLatest?.amountSats ?? 0)) return;

        await s.publishRaise({
          auctionAddress: addr,
          amountSats: amount,
          bidSlot: `proxy-${s.bidderPubkey.slice(0, 8)}-${amount}-${Math.floor(Date.now() / 1000)}`,
          escrowPubkey: s.escrowPubkey,
          maxCommit: auction.event.tags.find((t) => t[0] === 'max_commit')?.[1] ?? '',
        });
        s.onRaised?.(amount);
      } catch {
        // Network/publish failure: the next tick re-evaluates from fresh
        // history — idempotent by construction (no raise if we already lead).
      } finally {
        busyRef.current = false;
      }
    };

    // Initial evaluation after mount, then on the poll cadence. Also fires
    // on tab focus so returning to the app resolves pending raises fast.
    const timer = window.setInterval(() => void tick(), pollMs);
    void tick();
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction?.eventId, bidderPubkey, pollMs]);
}
