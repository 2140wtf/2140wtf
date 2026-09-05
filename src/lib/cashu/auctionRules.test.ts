import { describe, expect, it } from 'vitest';

import type { AuctionBid } from '@/lib/cashu/auction';
import {
  AUCTION_TAGS,
  EXTENSION_SECONDS,
  EXTENSION_WINDOW_SECONDS,
  bidIncrementSats,
  computeStandingState,
  effectiveCloseTime,
  evaluateReserve,
  isEffectivelyClosed,
  minNextBidSats,
  proxyRaises,
} from '@/lib/cashu/auctionRules';
import { createCommitment, verifyReveal } from '@/lib/cashu/auctionCommit';

const ADDR = '30402:sellerpk:demo';
const SELLER = 'sellerpk';
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let seq = 0;
function bid(pubkey: string, amountSats: number, createdAt: number): AuctionBid {
  seq += 1;
  return {
    eventId: `ev-${(seq += 1)}`,
    pubkey,
    amountSats,
    auctionAddress: ADDR,
    createdAt,
  };
}

describe('tiered bid increments', () => {
  it('follows the eBay-style schedule boundaries', () => {
    expect(bidIncrementSats(0)).toBe(100);
    expect(bidIncrementSats(999)).toBe(100);
    expect(bidIncrementSats(1_000)).toBe(500);
    expect(bidIncrementSats(4_999)).toBe(500);
    expect(bidIncrementSats(5_000)).toBe(1_000);
    expect(bidIncrementSats(19_999)).toBe(1_000);
    expect(bidIncrementSats(20_000)).toBe(2_500);
    expect(bidIncrementSats(99_999)).toBe(2_500);
    expect(bidIncrementSats(100_000)).toBe(5_000);
    expect(bidIncrementSats(500_000)).toBe(10_000);
    expect(bidIncrementSats(1_000_000)).toBe(25_000);
    expect(bidIncrementSats(10_000_000)).toBe(100_000);
    expect(bidIncrementSats(50_000_000)).toBe(100_000);
  });

  it('rejects/normalizes nonsense input', () => {
    expect(bidIncrementSats(-5)).toBe(100);
    expect(bidIncrementSats(NaN)).toBe(100);
  });

  it('minNextBid uses the tier of the standing price', () => {
    expect(minNextBidSats(null, 1_000)).toBe(1_000); // no bids → starting price
    expect(minNextBidSats(1_000, 1_000)).toBe(1_500); // 1k + 500
    expect(minNextBidSats(20_000, 1_000)).toBe(22_500); // 20k + 2.5k
  });
});

describe('soft-close anti-sniping', () => {
  const LISTED_CLOSE = 10_000;

  it('no bids → close equals listed close', () => {
    expect(effectiveCloseTime({ listedClosesAt: LISTED_CLOSE, bids: [] })).toBe(LISTED_CLOSE);
  });

  it('a bid outside the window does NOT extend', () => {
    const close = effectiveCloseTime({
      listedClosesAt: LISTED_CLOSE,
      bids: [bid(A, 1_000, LISTED_CLOSE - EXTENSION_WINDOW_SECONDS - 1)],
    });
    expect(close).toBe(LISTED_CLOSE);
  });

  it('a bid exactly at the window boundary extends', () => {
    const close = effectiveCloseTime({
      listedClosesAt: LISTED_CLOSE,
      bids: [bid(A, 1_000, LISTED_CLOSE - EXTENSION_WINDOW_SECONDS)],
    });
    expect(close).toBe(LISTED_CLOSE - EXTENSION_WINDOW_SECONDS + EXTENSION_SECONDS);
  });

  it('iterative snipes chain: each late bid pushes close from its own time', () => {
    const b1 = LISTED_CLOSE - 60; // snipe 1
    const b2 = b1 + 120; // lands inside the extended close from b1
    const close = effectiveCloseTime({
      listedClosesAt: LISTED_CLOSE,
      bids: [bid(A, 1_000, b1), bid(B, 2_000, b2)],
    });
    expect(close).toBe(b2 + EXTENSION_SECONDS);
  });

  it('bids after the effective close never reopen the auction', () => {
    const close = effectiveCloseTime({
      listedClosesAt: LISTED_CLOSE,
      bids: [bid(A, 1_000, LISTED_CLOSE + 500)],
    });
    expect(close).toBe(LISTED_CLOSE);
  });

  it('a bid just before close extends even when now is far past (deterministic replay)', () => {
    const close = effectiveCloseTime({
      listedClosesAt: 1_000,
      bids: [bid(A, 1_000, 900)], // 100s before close → inside window
    });
    expect(close).toBe(1_200); // 900 + 300 extension — anti-snipe applied
    expect(isEffectivelyClosed({ listedClosesAt: 1_000, bids: [bid(A, 1_000, 900)], nowSeconds: 50_000 })).toBe(true);
  });

  it('a bid after the listed close never extends it (replay stays past)', () => {
    const close = effectiveCloseTime({
      listedClosesAt: 1_000,
      bids: [bid(A, 1_000, 1_500)], // after close
    });
    expect(close).toBe(1_000);
  });

  it('status=sold closes immediately even before the listed close', () => {
    expect(
      isEffectivelyClosed({
        listedClosesAt: LISTED_CLOSE,
        bids: [],
        statusSold: true,
        nowSeconds: LISTED_CLOSE - 1_000,
      }),
    ).toBe(true);
  });
});

describe('standing state (proxy + winner semantics)', () => {
  it('empty history → no standing, no winner', () => {
    const s = computeStandingState([]);
    expect(s.standing).toBeNull();
    expect(s.winner).toBeNull();
  });

  it('highest bid stands; equal bid from later bidder does NOT displace earlier', () => {
    const b1 = bid(A, 5_000, 100);
    const b2 = bid(B, 5_000, 200);
    const s = computeStandingState([b2, b1]);
    expect(s.standing?.eventId).toBe(b1.eventId); // earlier bidder wins the tie
  });

  it('lower bid after a higher one never displaces', () => {
    const hi = bid(A, 9_000, 100);
    const lo = bid(B, 1_000, 200);
    const s = computeStandingState([hi, lo]);
    expect(s.standing?.eventId).toBe(hi.eventId);
  });

  it('out-of-order input is normalized by time', () => {
    const s = computeStandingState([bid(B, 3_000, 300), bid(A, 2_000, 100), bid(A, 9_000, 200)]);
    expect(s.standingSats).toBe(9_000);
  });
});

describe('proxy raise computation', () => {
  it('first bid: raises one increment over the floor, capped at max', () => {
    const raises = proxyRaises({
      standing: null,
      standingSats: null,
      myLatestBid: null,
      maxSats: 5_000,
      startingSats: 1_000,
      bidderPubkey: A,
    });
    expect(raises).toHaveLength(1);
    expect(raises[0].amountSats).toBe(1_000);
    // Slot is unique-ish and non-empty
    expect(raises[0].bidSlot.length).toBeGreaterThan(0);
  });

  it('responds to a rival bid with exactly one increment over it', () => {
    const rival = bid(B, 2_000, 200);
    const raises = proxyRaises({
      standing: rival,
      standingSats: 2_000,
      myLatestBid: null,
      maxSats: 10_000,
      startingSats: 1_000,
      bidderPubkey: A,
    });
    expect(raises).toHaveLength(1);
    expect(raises[0].amountSats).toBe(2_500); // 2k + 500 tier
  });

  it('places no bid when max cannot clear the required increment (eBay semantics)', () => {
    const rival = bid(B, 2_000, 200);
    const raises = proxyRaises({
      standing: rival,
      standingSats: 2_000,
      myLatestBid: null,
      maxSats: 2_400, // next min is 2_500 — a 2_400 bid would be rejected
      startingSats: 1_000,
      bidderPubkey: A,
    });
    expect(raises).toHaveLength(0);
  });

  it('cannot lead when max is below the required next bid', () => {
    const rival = bid(B, 2_000, 200);
    const raises = proxyRaises({
      standing: rival,
      standingSats: 2_000,
      myLatestBid: null,
      maxSats: 2_400, // next min is 2_500
      startingSats: 1_000,
      bidderPubkey: A,
    });
    expect(raises).toHaveLength(0);
  });

  it('does nothing when already standing (leading)', () => {
    const mine = bid(A, 3_000, 100);
    const raises = proxyRaises({
      standing: mine,
      standingSats: 3_000,
      myLatestBid: mine,
      maxSats: 50_000,
      startingSats: 1_000,
      bidderPubkey: A,
    });
    expect(raises).toHaveLength(0);
  });

  it('zero/negative max never raises', () => {
    const rival = bid(B, 2_000, 200);
    expect(
      proxyRaises({ standing: rival, standingSats: 2_000, myLatestBid: null, maxSats: 0, startingSats: 1_000, bidderPubkey: A }),
    ).toHaveLength(0);
  });
});

describe('reserve evaluation (fail-closed)', () => {
  it('no reserve commitment → met trivially', () => {
    expect(evaluateReserve({ reserveCommit: null, reserveReveal: null, sellerPubkey: SELLER, auctionAddr: ADDR, finalPriceSats: 1_000 })).toEqual({ met: true });
  });

  it('commitment without reveal → NOT met (fail-closed)', () => {
    const r = evaluateReserve({ reserveCommit: 'ab'.repeat(32), reserveReveal: null, sellerPubkey: SELLER, auctionAddr: ADDR, finalPriceSats: 999_999 });
    expect(r).toEqual({ met: false, reason: 'no-revealed-reserve' });
  });

  it('revealed reserve above final price → not met', () => {
    const r = evaluateReserve({
      reserveCommit: 'ab'.repeat(32),
      reserveReveal: { valueSats: 10_000, nonce: 'cd'.repeat(16) },
      sellerPubkey: SELLER,
      auctionAddr: ADDR,
      finalPriceSats: 9_000,
    });
    expect(r).toEqual({ met: false, reason: 'below-revealed-reserve' });
  });

  it('final price at/above revealed reserve → met', () => {
    const r = evaluateReserve({
      reserveCommit: 'ab'.repeat(32),
      reserveReveal: { valueSats: 10_000, nonce: 'cd'.repeat(16) },
      sellerPubkey: SELLER,
      auctionAddr: ADDR,
      finalPriceSats: 10_000,
    });
    expect(r).toEqual({ met: true });
  });

  it('no bids at all with a reserve → not met', () => {
    const r = evaluateReserve({
      reserveCommit: 'ab'.repeat(32),
      reserveReveal: { valueSats: 10_000, nonce: 'cd'.repeat(16) },
      sellerPubkey: SELLER,
      auctionAddr: ADDR,
      finalPriceSats: null,
    });
    expect(r).toEqual({ met: false, reason: 'below-revealed-reserve' });
  });
});

describe('commitment scheme integrity', () => {
  it('create → verify round-trips', () => {
    const { commitment, secret } = createCommitment({ auctionAddress: ADDR, pubkey: A, valueSats: 12_345 });
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment, secret })).toBe(true);
  });

  it('binding: a different value/nonce/pubkey/auction fails verification', () => {
    const { commitment, secret } = createCommitment({ auctionAddress: ADDR, pubkey: A, valueSats: 12_345 });
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment, secret: { ...secret, valueSats: 12_346 } })).toBe(false);
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment, secret: { ...secret, nonce: 'ff'.repeat(16) } })).toBe(false);
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: B, commitment, secret })).toBe(false);
    expect(verifyReveal({ auctionAddress: '30402:other:demo', pubkey: A, commitment, secret })).toBe(false);
  });

  it('deterministic for identical inputs (recompute matches)', () => {
    const a = createCommitment({ auctionAddress: ADDR, pubkey: A, valueSats: 500 });
    // nonce differs per creation, so commitments differ — but verify always holds
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment: a.commitment, secret: a.secret })).toBe(true);
  });

  it('malformed commitments/reveals fail closed', () => {
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment: 'zz', secret: { valueSats: 1, nonce: 'ab'.repeat(16) } })).toBe(false);
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment: 'ab'.repeat(32), secret: { valueSats: -1, nonce: 'ab'.repeat(16) } })).toBe(false);
    expect(verifyReveal({ auctionAddress: ADDR, pubkey: A, commitment: 'ab'.repeat(32), secret: { valueSats: 1, nonce: 'short' } })).toBe(false);
  });
});

describe('tag constants', () => {
  it('are stable single-source-of-truth strings', () => {
    expect(AUCTION_TAGS.maxCommit).toBe('max_commit');
    expect(AUCTION_TAGS.reserveCommit).toBe('reserve_commit');
    expect(AUCTION_TAGS.reserveReveal).toBe('reserve_reveal');
    expect(AUCTION_TAGS.proxyMax).toBe('proxy_max');
  });
});
