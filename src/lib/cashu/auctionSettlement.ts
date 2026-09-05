/**
 * Auction settlement — closing, releasing the winner's escrow to the seller,
 * and refunding losing bidders.
 *
 * Settlement rides the SAME escrow operator the pet battles use
 * (`VITE_PETS_BATTLE_ESCROW_URL`): a 2-of-3 multisig release where the
 * operator co-signs only when the on-chain-of-record (relay) evidence agrees.
 * For auctions the evidence is the bid history itself — kind-30401 bid events
 * are public and signature-verified, so the operator can independently
 * determine the highest bidder at close.
 *
 * Three phases:
 *  1. CLOSE  — the seller republishes the kind-30402 auction with
 *              `status = sold` once the close time has passed (or early via
 *              "close now"). This freezes the winner: the highest bid event
 *              visible at the `close` timestamp wins.
 *  2. RELEASE — the seller asks the operator to release the WINNING bid's
 *              escrow token to them (operator + seller co-sign; the bidder's
 *              signature is not needed because they won). The seller submits
 *              the winning bid event + the auction event; the operator
 *              verifies both signatures and the lock shape.
 *  3. REFUND — every outbid bidder reclaims their own token through the
 *              standard NUT-11 refund path (their key is the sole refund
 *              signer after the locktime), or via an operator-assisted
 *              refund release if they want it back sooner.
 */

import type { NostrEvent } from '@nostrify/nostrify';

import {
  type AuctionBid,
  type AuctionListing,
  auctionAddress,
} from '@/lib/cashu/auction';
import {
  AUCTION_TAGS,
  evaluateReserve,
  type ReserveOutcome,
} from '@/lib/cashu/auctionRules';
import { verifyReveal } from '@/lib/cashu/auctionCommit';

/** localStorage prefix for the bidder's own escrow deposit tokens. */
const PENDING_BID_DEPOSIT_PREFIX = 'bao_auction_bid_';

export interface PendingAuctionBidDeposit {
  /** NIP-33 address of the auction (`30402:<seller>:<d>`). */
  auctionAddress: string;
  /** The locked deposit token — the bidder's only handle on the funds. */
  token: string;
  /** Sats locked (for display). */
  amountSats: number;
  /** When the escrow refund path unlocks (unix seconds). */
  locktime: number;
}

function bidDepositKey(address: string): string {
  return `${PENDING_BID_DEPOSIT_PREFIX}${address}`;
}

/** Persist the deposit token for a bid the user just placed. Best-effort. */
export function savePendingBidDeposit(deposit: PendingAuctionBidDeposit): void {
  try {
    localStorage.setItem(
      bidDepositKey(deposit.auctionAddress),
      JSON.stringify(deposit),
    );
  } catch {
    // storage blocked — in-memory journal only
  }
}

/** Load every auction bid deposit this browser still holds. */
export function loadPendingBidDeposits(): PendingAuctionBidDeposit[] {
  const out: PendingAuctionBidDeposit[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PENDING_BID_DEPOSIT_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as PendingAuctionBidDeposit;
        if (parsed && typeof parsed.token === 'string' && typeof parsed.auctionAddress === 'string') {
          out.push(parsed);
        }
      } catch {
        // corrupt entry — ignore
      }
    }
  } catch {
    // storage blocked
  }
  return out;
}

/** Remove the journal entry once the deposit was refunded or released. */
export function clearPendingBidDeposit(auctionAddress: string): void {
  try {
    localStorage.removeItem(bidDepositKey(auctionAddress));
  } catch {
    // ignore
  }
}

/**
 * Build the seller's close/settle update for an auction: republish the
 * kind-30402 event with `status = sold`. Relays replace by `d`, so this is
 * idempotent and the winner is whoever holds the highest valid bid event
 * authored before the operator's check time.
 */
export function buildAuctionSettleTags(auction: AuctionListing): string[][] {
  const tags = auction.event.tags.map((tag) =>
    tag[0] === 'status' ? ['status', 'sold'] : tag,
  );
  if (!tags.some(([name]) => name === 'status')) {
    tags.push(['status', 'sold']);
  }
  return tags;
}

/**
 * Resolve the winning bid for a closed auction: highest, tie → EARLIEST
 * (eBay first-mover rule; a later equal bid never displaces the leader).
 * Bids after the effective close (soft-close already applied by the caller
 * passing only pre-close bids) are ignored.
 */
export function resolveWinningBid(
  bids: AuctionBid[],
  _auction: AuctionListing,
): AuctionBid | null {
  const valid = bids.filter((b) => Number.isSafeInteger(b.amountSats) && b.amountSats > 0);
  if (valid.length === 0) return null;
  return valid.reduce((best, bid) =>
    bid.amountSats > best.amountSats ||
    (bid.amountSats === best.amountSats && bid.createdAt < best.createdAt)
      ? bid
      : best,
  );
}

/** Result of reserve-gated settlement. */
export interface ReserveGatedSettlement {
  outcome: ReserveOutcome;
  /** The winning bid, only meaningful when outcome.met is true. */
  winningBid: AuctionBid | null;
}

/**
 * Reserve-gated winner resolution (fail-closed):
 *  - no reserve commitment → winner stands;
 *  - reserve committed but seller hasn't revealed → NOT met, everyone
 *    refunds, seller unpaid until they reveal;
 *  - reveal present but final price below it → NOT met (refunds).
 * The reveal must cryptographically verify against the auction's published
 * `reserve_commit` — a bogus reveal is rejected, not merely ignored.
 */
export function resolveSettlementWithReserve(args: {
  auction: AuctionListing;
  bids: AuctionBid[];
  /** The seller's published reveal, if any (from a `reserve_reveal` tag). */
  reserveReveal: { valueSats: number; nonce: string } | null;
}): ReserveGatedSettlement {
  const addr = auctionAddress(args.auction.pubkey, args.auction.dTag);
  const reserveCommit =
    args.auction.event.tags.find((t) => t[0] === AUCTION_TAGS.reserveCommit)?.[1] ?? null;

  const winningBid = resolveWinningBid(args.bids, args.auction);

  // Verify the reveal binds to the commitment before trusting its value.
  let verifiedReveal: { valueSats: number; nonce: string } | null = null;
  if (reserveCommit && args.reserveReveal) {
    const ok = verifyReveal({
      auctionAddress: addr,
      pubkey: args.auction.pubkey,
      commitment: reserveCommit,
      secret: args.reserveReveal,
    });
    if (ok) verifiedReveal = args.reserveReveal;
  }

  const outcome = evaluateReserve({
    reserveCommit,
    reserveReveal: verifiedReveal,
    sellerPubkey: args.auction.pubkey,
    auctionAddr: addr,
    finalPriceSats: winningBid?.amountSats ?? null,
  });

  return { outcome, winningBid: outcome.met ? winningBid : null };
}

/**
 * Build the seller's reserve-reveal update: republish the auction with a
 * `reserve_reveal` tag carrying `{"v":<sats>,"n":"<hex nonce>"}`. Any party
 * can then verify it against `reserve_commit`. Publish once the reserve is
 * met (or at close) — an unrevealed reserve pays nobody.
 */
export function buildReserveRevealTags(auction: AuctionListing, secret: { valueSats: number; nonce: string }): string[][] {
  const tags = auction.event.tags.filter((t) => t[0] !== AUCTION_TAGS.reserveReveal);
  tags.push([
    AUCTION_TAGS.reserveReveal,
    JSON.stringify({ v: secret.valueSats, n: secret.nonce }),
  ]);
  return tags;
}

/** Parse a `reserve_reveal` tag published by the seller. */
export function parseReserveReveal(auction: AuctionListing): { valueSats: number; nonce: string } | null {
  const raw = auction.event.tags.find((t) => t[0] === AUCTION_TAGS.reserveReveal)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; n?: unknown };
    if (typeof parsed.v !== 'number' || !Number.isSafeInteger(parsed.v) || parsed.v < 0) return null;
    if (typeof parsed.n !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.n)) return null;
    return { valueSats: parsed.v, nonce: parsed.n };
  } catch {
    return null;
  }
}

/**
 * Ask the escrow operator to release the WINNING bid's locked token to the
 * seller. Mirrors `requestEscrowRelease` from the pet-battle flow but the
 * evidence is the public bid history instead of battle attestations.
 *
 * The operator verifies:
 *  - the auction event signature + `close` timestamp is in the past,
 *  - the winning bid event signature, its `a` tag targets this auction, and
 *  - the deposit token locks to {winner P2PK, seller, operator} with n_sigs 2.
 *
 * On success the returned token is locked to {seller, operator} 2-of-2 from
 * the seller's perspective — the seller sweeps it with their wallet key.
 */
export async function requestAuctionRelease(args: {
  serviceUrl: string;
  auction: AuctionListing;
  winningBid: AuctionBid;
  winningBidEvent: NostrEvent;
  /** The winner's deposit token, as delivered by the bidder (out-of-band). */
  depositToken: string;
  sellerPubkey: string;
}): Promise<{ token: string } | null> {
  const url = args.serviceUrl.replace(/\/$/, '') + '/auction/release';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auctionId: auctionAddress(args.sellerPubkey, args.auction.dTag),
      auctionEvent: {
        id: args.auction.event.id,
        pubkey: args.auction.event.pubkey,
        sig: args.auction.event.sig,
        created_at: args.auction.event.created_at,
        kind: args.auction.event.kind,
        tags: args.auction.event.tags,
        content: args.auction.event.content,
      },
      winningBidEvent: {
        id: args.winningBidEvent.id,
        pubkey: args.winningBidEvent.pubkey,
        sig: args.winningBidEvent.sig,
        created_at: args.winningBidEvent.created_at,
        kind: args.winningBidEvent.kind,
        tags: args.winningBidEvent.tags,
        content: args.winningBidEvent.content,
      },
      winnerPubkey: args.winningBid.pubkey,
      sellerPubkey: args.sellerPubkey,
      depositToken: args.depositToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Auction release request failed');
    throw new Error(text);
  }
  const data = (await res.json()) as { token?: string };
  return data.token ? { token: data.token } : null;
}

/**
 * Ask the escrow operator for an EARLY refund of the user's own losing bid
 * (before the locktime). The operator co-signs the refund when the bid is
 * demonstrably NOT the winning bid at close — public bid history again.
 * After the locktime the standard refund path works without the operator.
 */
export async function requestAuctionRefund(args: {
  serviceUrl: string;
  auction: AuctionListing;
  /** The requester's own bid event. */
  bidEvent: NostrEvent;
  bid: AuctionBid;
  depositToken: string;
}): Promise<{ token: string } | null> {
  const url = args.serviceUrl.replace(/\/$/, '') + '/auction/refund';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auctionId: args.bid.auctionAddress,
      auctionEvent: {
        id: args.auction.event.id,
        pubkey: args.auction.event.pubkey,
        sig: args.auction.event.sig,
        created_at: args.auction.event.created_at,
        kind: args.auction.event.kind,
        tags: args.auction.event.tags,
        content: args.auction.event.content,
      },
      bidEvent: {
        id: args.bidEvent.id,
        pubkey: args.bidEvent.pubkey,
        sig: args.bidEvent.sig,
        created_at: args.bidEvent.created_at,
        kind: args.bidEvent.kind,
        tags: args.bidEvent.tags,
        content: args.bidEvent.content,
      },
      bidderPubkey: args.bid.pubkey,
      depositToken: args.depositToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Auction refund request failed');
    throw new Error(text);
  }
  const data = (await res.json()) as { token?: string };
  return data.token ? { token: data.token } : null;
}

/** Whether the standard refund path has unlocked for a deposit. */
export function refundUnlocked(
  deposit: Pick<PendingAuctionBidDeposit, 'locktime'>,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return nowSeconds >= deposit.locktime;
}
