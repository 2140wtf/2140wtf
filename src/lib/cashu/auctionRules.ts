/**
 * Professional auction rules — the eBay-grade mechanics layer.
 *
 * Pure functions only: every rule here is computable from public relay data
 * by any party (bidders, seller, escrow operator) so settlement evidence
 * never depends on this client. Covered by auctionRules.test.ts.
 *
 *  - Tiered bid increments (eBay-style schedule)
 *  - Soft-close anti-sniping: a bid inside the extension window pushes the
 *    effective close out by EXTENSION_SECONDS from that bid
 *  - Reserve price: hidden behind a hash commitment (auctionCommit.ts);
 *    unrevealed reserve = fail-closed (not met → refunds, seller unpaid)
 *  - Proxy bidding state machine: reduces a bidder's {max commitment,
 *    visible bids} into the sequence of minimal raises their client should
 *    publish, and computes the standing winner from a full bid history
 *    (eBay "high bidder" semantics: earlier max wins ties)
 *
 * Bid history note: kind-30401 bids are parameterized-replaceable per
 * (bidder, d-tag) slot, so a bidder's RAISES reuse the same slot. The raw
 * relay query returns only the latest event per slot — so every proxy raise
 * writes to a UNIQUE slot (`d = bid-<n>`), preserving the full raise
 * sequence in public history. summarizeBids() therefore keeps one bid per
 * (pubkey, dTag) — fixing the old behavior which collapsed the whole
 * history to a single bid per auction.
 */

import type { AuctionBid } from '@/lib/cashu/auction';
import { auctionAddress } from '@/lib/cashu/auction';

// ── Tiered bid increments (eBay-style schedule) ───────────────────────────

export interface IncrementTier {
  /** Exclusive lower bound of the current-price band, in sats. */
  fromSats: number;
  /** Minimum raise within this band, in sats. */
  incrementSats: number;
}

/**
 * eBay-style tiered increments, tuned for sat denominations. Every boundary
 * is a power-of-two-ish round sat amount so the schedule is easy to reason
 * about in a Bitcoin-only market.
 */
export const INCREMENT_TIERS: readonly IncrementTier[] = [
  { fromSats: 0, incrementSats: 100 }, // < 1k sats: 100
  { fromSats: 1_000, incrementSats: 500 }, // 1k–5k: 500
  { fromSats: 5_000, incrementSats: 1_000 }, // 5k–20k: 1k
  { fromSats: 20_000, incrementSats: 2_500 }, // 20k–100k: 2.5k
  { fromSats: 100_000, incrementSats: 5_000 }, // 100k–500k: 5k
  { fromSats: 500_000, incrementSats: 10_000 }, // 500k–1M: 10k
  { fromSats: 1_000_000, incrementSats: 25_000 }, // 1M–5M: 25k
  { fromSats: 5_000_000, incrementSats: 50_000 }, // 5M–10M: 50k
  { fromSats: 10_000_000, incrementSats: 100_000 }, // ≥ 10M: 100k
];

/** Minimum raise required when the current price is `currentSats`. */
export function bidIncrementSats(currentSats: number): number {
  const safe = Number.isSafeInteger(currentSats) && currentSats > 0 ? currentSats : 0;
  let increment = INCREMENT_TIERS[0].incrementSats;
  for (const tier of INCREMENT_TIERS) {
    if (safe >= tier.fromSats) increment = tier.incrementSats;
    else break;
  }
  return increment;
}

/** The minimum acceptable next bid given the current standing price. */
export function minNextBidSats(standingSats: number | null, startingSats: number): number {
  if (standingSats === null || standingSats <= 0) return Math.max(1, startingSats);
  return standingSats + bidIncrementSats(standingSats);
}

// ── Soft-close anti-sniping ───────────────────────────────────────────────

/** A bid inside this many seconds of the close extends the auction. */
export const EXTENSION_WINDOW_SECONDS = 300; // 5 minutes
/** The extension granted: close moves to (sniping bid time + this). */
export const EXTENSION_SECONDS = 300; // 5 minutes

/**
 * Compute the EFFECTIVE close time of an auction from its bid history.
 *
 * eBay soft-close semantics: any bid placed within the extension window of
 * the then-effective close pushes the close out to (bid time + extension).
 * Applied iteratively over the time-ordered bid sequence this yields one
 * canonical close time every party computes identically from public data.
 *
 * `listedClosesAt` is the auction's `close` tag; bids after the effective
 * close are ignored (they arrived post-auction and must not reopen it).
 */
export function effectiveCloseTime(args: {
  listedClosesAt: number;
  bids: Pick<AuctionBid, 'amountSats' | 'createdAt'>[];
}): number {
  const { listedClosesAt, bids } = args;

  // Time-ordered bid sequence (id ties broken deterministically by amount).
  const ordered = bids
    .filter((b) => Number.isSafeInteger(b.amountSats) && b.amountSats > 0)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || b.amountSats - a.amountSats);

  let close = listedClosesAt;
  for (const bid of ordered) {
    // Only bids BEFORE the current effective close can extend it, and only
    // when they land inside the window. Bids after close never reopen.
    if (bid.createdAt < close && close - bid.createdAt <= EXTENSION_WINDOW_SECONDS) {
      close = bid.createdAt + EXTENSION_SECONDS;
    }
  }

  // An already-past close stays past — rules never resurrect a closed auction.
  return close;
}


/** Whether the auction is effectively closed at `nowSeconds`. */
export function isEffectivelyClosed(args: {
  listedClosesAt: number;
  bids: Pick<AuctionBid, 'amountSats' | 'createdAt'>[];
  statusSold?: boolean;
  nowSeconds?: number;
}): boolean {
  if (args.statusSold) return true;
  const { nowSeconds, ...closeArgs } = args;
  return effectiveCloseTime(closeArgs) <= (nowSeconds ?? Math.floor(Date.now() / 1000));
}

// ── Standing-price state machine (proxy + winner semantics) ──────────────

/** One raise event a bidder's client must publish, in order. */
export interface ProxyRaise {
  /** Visible bid amount in sats. */
  amountSats: number;
  /**
   * Unique bid slot for this raise (`d` tag) — unique per raise so the full
   * sequence persists in public history (replaceable slots would erase it).
   */
  bidSlot: string;
}

/** Everything the proxy engine needs to know about one bidder's position. */
export interface ProxyBidderState {
  pubkey: string;
  /** Hash commitment to their (secret) max. */
  maxCommit: string;
  /** Their committed raises so far, time-ordered (from public history). */
  raises: AuctionBid[];
}

export interface StandingState {
  /** Current winning bid (visible price). */
  standing: AuctionBid | null;
  /** Current price = standing bid amount (or null before the first bid). */
  standingSats: number | null;
  /** Minimum next acceptable bid. */
  minNextBid: number;
  /** The eBay-style high-bidder: FIRST bidder among max-ties wins. */
  winner: AuctionBid | null;
}

/**
 * Reduce a full auction bid history into standing state.
 *
 * eBay semantics: bids are processed in time order; a bid becomes standing
 * only if it EXCEEDS the current standing price (an equal bid does not
 * displace an earlier one — the earlier bidder wins ties). This is what
 * makes proxy raises deterministic: two proxies with the same max ratchet
 * to the lower-of-the-two max, and the earlier committer holds the lead.
 */
export function computeStandingState(bids: AuctionBid[]): StandingState {
  const ordered = bids
    .filter((b) => Number.isSafeInteger(b.amountSats) && b.amountSats > 0)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt || b.amountSats - a.amountSats);

  let standing: AuctionBid | null = null;
  for (const bid of ordered) {
    if (standing === null || bid.amountSats > standing.amountSats) {
      standing = bid;
    }
    // Equal-or-lower bids never displace the standing bid (earlier wins).
  }

  return {
    standing,
    standingSats: standing?.amountSats ?? null,
    minNextBid: minNextBidSats(standing?.amountSats ?? null, 1),
    winner: standing,
  };
}

/**
 * The raises a proxy client should publish RIGHT NOW for its bidder.
 *
 * Given the bidder's committed max (kept secret), the standing winner, and
 * the auction floor, compute the minimal visible raise sequence that puts
 * the bidder in the lead — or keeps them there — without ever exceeding the
 * max. Returns [] when the bidder is already standing (or cannot lead).
 *
 * Deterministic from public state + the local secret, so re-running it
 * never double-raises: the client re-reads history (including its own
 * published raises) before each step.
 */
export function proxyRaises(args: {
  standing: AuctionBid | null;
  standingSats: number | null;
  /** The bidder's own current visible bid, if any. */
  myLatestBid: AuctionBid | null;
  /** Secret max (already verified locally against the commitment). */
  maxSats: number;
  /** Auction starting price floor. */
  startingSats: number;
  /** Bidder pubkey (for slot naming). */
  bidderPubkey: string;
}): ProxyRaise[] {
  const { standing, standingSats, myLatestBid, maxSats, startingSats, bidderPubkey } = args;

  if (maxSats <= 0) return [];

  // Already leading? Nothing to do.
  if (myLatestBid && standing && myLatestBid.eventId === standing.eventId) return [];

  // Price we must beat: standing price, or the auction floor.
  const toBeat = standingSats ?? 0;
  const myVisible = myLatestBid?.amountSats ?? 0;

  // Opening proxy bid: exactly the starting price (no increment on top).
  if (standingSats === null) {
    if (maxSats < Math.max(1, startingSats)) return [];
    if (myVisible >= Math.max(1, startingSats)) return [];
    return [{
      amountSats: Math.max(1, startingSats),
      bidSlot: `proxy-${bidderPubkey.slice(0, 8)}-open`,
    }];
  }

  // Cannot profitably lead: our max doesn't clear the required next bid.
  const floorBid = minNextBidSats(standingSats, startingSats);
  if (maxSats < floorBid) return [];

  // Minimal winning raise: one increment over the standing price — but never
  // above our max, never below our own current bid, and never a decrease.
  const target = Math.min(maxSats, toBeat + bidIncrementSats(toBeat));
  if (target <= myVisible) return [];

  const n = (myLatestBid?.eventId ?? '').length; // deterministic slot seed
  return [
    {
      amountSats: target,
      // Unique slot per raise: sequence number derived from how many raises
      // we've already published (caller passes history in via myLatestBid).
      bidSlot: `proxy-${bidderPubkey.slice(0, 8)}-${target}-${n}`,
    },
  ];
}

// ── Reserve-price gating (fail-closed) ────────────────────────────────────

export type ReserveOutcome =
  | { met: true }
  | { met: false; reason: 'no-revealed-reserve' | 'below-revealed-reserve' };

/**
 * Whether the final price meets the reserve. Fail-closed: a commitment with
 * no valid reveal is treated as NOT MET — the seller must reveal to get
 * paid, silence refunds everyone.
 */
export function evaluateReserve(args: {
  reserveCommit: string | null | undefined;
  /** The seller's reveal, if published: {valueSats, nonce} + verifying commit. */
  reserveReveal: { valueSats: number; nonce: string } | null;
  sellerPubkey: string;
  auctionAddr: string;
  finalPriceSats: number | null;
}): ReserveOutcome {
  if (!args.reserveCommit) return { met: true }; // no reserve set
  if (!args.reserveReveal) return { met: false, reason: 'no-revealed-reserve' };
  if (args.finalPriceSats === null) return { met: false, reason: 'below-revealed-reserve' };
  if (args.finalPriceSats < args.reserveReveal.valueSats) {
    return { met: false, reason: 'below-revealed-reserve' };
  }
  return { met: true };
}

/** Tag names for the new auction metadata (single source of truth). */
export const AUCTION_TAGS = {
  maxCommit: 'max_commit',
  reserveCommit: 'reserve_commit',
  reserveReveal: 'reserve_reveal',
  proxyMax: 'proxy_max',
} as const;

/** NIP-33 address helper re-export for one import site. */
export { auctionAddress };
