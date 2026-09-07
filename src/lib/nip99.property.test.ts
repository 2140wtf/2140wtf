import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { NostrEvent } from '@nostrify/nostrify';

import {
  MAX_LISTING_CATEGORIES,
  MAX_LISTING_IMAGES,
  MAX_LISTING_PRICE,
  MAX_LISTING_SHIPPING_REFS,
  MAX_LISTING_STRING_LENGTH,
  dedupeNip99Listings,
  formatNip99Price,
  isValidListingPrice,
  parseNip99Listing,
} from './nip99';

// Deterministic fuzz campaign (round 30): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260907, numRuns: 300 });

const HEX64 = fc.stringMatching(/^[0-9a-f]{64}$/);

/** Arbitrary nostr event: kinds around the NIP-99 surface plus unrelated ones. */
const arbEvent = fc.record({
  id: HEX64,
  pubkey: HEX64,
  kind: fc.constantFrom(30402, 30403, 1, 1063, 30406),
  tags: fc.array(
    fc.tuple(
      fc.constantFrom('d', 'title', 'summary', 'price', 'image', 't', 'status', 'published_at', 'stock', 'type', 'format', 'delivery', 'shipping_option', 'location', 'payment', 'bogus'),
      fc.string({ maxLength: 300 }),
      fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
      fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
    ).map(([k, v, v2, v3]) => (v2 === undefined ? [k, v] : v3 === undefined ? [k, v, v2] : [k, v, v2, v3])),
    { maxLength: 40 },
  ),
  content: fc.string({ maxLength: 6000 }),
  created_at: fc.integer({ min: 0, max: 4_102_444_800 }),
  sig: fc.stringMatching(/^[0-9a-f]{128}$/),
});

describe('parseNip99Listing — property fuzz (round 30)', () => {
  it('never throws and returns null or a bounded listing for ANY event', () => {
    fc.assert(
      fc.property(arbEvent, (event) => {
        let listing: ReturnType<typeof parseNip99Listing> = null as ReturnType<typeof parseNip99Listing>;
        expect(() => {
          listing = parseNip99Listing(event as unknown as NostrEvent);
        }).not.toThrow();

        if (!listing) return;
        // Wrong kinds and d-tag-less events are the only rejections.
        if (event.kind !== 30402 && event.kind !== 30403) {
          expect(listing).toBeNull();
          return;
        }
        const hasD = event.tags.some((t) => t[0] === 'd' && t[1]);
        if (!hasD) {
          expect(listing).toBeNull();
          return;
        }

        // Every output field respects the round-30 caps.
        expect(listing!.title.length).toBeLessThanOrEqual(MAX_LISTING_STRING_LENGTH);
        expect(listing!.summary.length).toBeLessThanOrEqual(MAX_LISTING_STRING_LENGTH);
        expect(listing!.content.length).toBeLessThanOrEqual(MAX_LISTING_STRING_LENGTH);
        expect(listing!.images.length).toBeLessThanOrEqual(MAX_LISTING_IMAGES);
        expect(listing!.images.every((u) => u.length <= MAX_LISTING_STRING_LENGTH)).toBe(true);
        expect(listing!.images.every((u) => /^https?:\/\//.test(u))).toBe(true);
        expect(listing!.categories.length).toBeLessThanOrEqual(MAX_LISTING_CATEGORIES);
        expect(listing!.categories.every((c) => c.length <= 64)).toBe(true);
        expect(listing!.shippingOptionRefs.length).toBeLessThanOrEqual(MAX_LISTING_SHIPPING_REFS);
        expect(
          listing!.shippingOptionRefs.every(
            (r) => r.extraCost === undefined || (Number.isFinite(r.extraCost) && r.extraCost >= 0 && r.extraCost <= MAX_LISTING_PRICE),
          ),
        ).toBe(true);
        if (listing!.price !== null) {
          expect(isValidListingPrice(listing!.price.value)).toBe(true);
        }
        if (listing!.publishedAt !== undefined) {
          expect(Number.isFinite(listing!.publishedAt)).toBe(true);
          expect(listing!.publishedAt).toBeGreaterThan(0);
          expect(listing!.publishedAt).toBeLessThanOrEqual(4_102_444_800);
        }
        if (listing!.stock !== undefined) {
          expect(Number.isFinite(listing!.stock)).toBe(true);
          expect(listing!.stock).toBeGreaterThanOrEqual(0);
        }
        expect(Number.isFinite(listing!.createdAt)).toBe(true);
      }),
    );
  });

  it('price is null whenever the raw tag would not survive downstream math', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 20 }),
        (raw, currency) => {
          const event = {
            id: 'a'.repeat(64),
            pubkey: 'b'.repeat(64),
            kind: 30402,
            tags: [['d', 'x'], ['price', raw, currency]],
            content: '',
            created_at: 1_700_000_000,
            sig: 'c'.repeat(128),
          } as unknown as NostrEvent;
          const listing = parseNip99Listing(event);
          if (!listing?.price) return;
          const parsed = Number(raw);
          // Invariant: a price object exists only for exactly-parsed, in-range values.
          expect(listing.price.value).toBe(parsed);
          expect(isValidListingPrice(parsed)).toBe(true);
          // Currency is never longer than the cap regardless of input.
          expect(listing.price.currency.length).toBeLessThanOrEqual(16);
        },
      ),
    );
  });

  it('Infinity-crafting inputs are rejected (the Number("1e999") class)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('1e999', '-1e999', '9'.repeat(400) + 'e10', '1e400', '0.00001e999'),
        (raw) => {
          const event = {
            id: 'a'.repeat(64),
            pubkey: 'b'.repeat(64),
            kind: 30402,
            tags: [['d', 'x'], ['price', raw]],
            content: '',
            created_at: 1_700_000_000,
            sig: 'c'.repeat(128),
          } as unknown as NostrEvent;
          const listing = parseNip99Listing(event);
          const value = listing?.price?.value;
          if (value !== undefined) {
            expect(Number.isFinite(value)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('dedupeNip99Listings — property fuzz (round 30)', () => {
  it('output is unique by (pubkey,dTag), sorted desc, and picks the newest event per key', () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 60 }), (events) => {
        const listings = dedupeNip99Listings(events as unknown as NostrEvent[]);

        const keys = listings.map((l) => `${l.pubkey}:${l.dTag}`);
        expect(new Set(keys).size).toBe(keys.length);

        for (let i = 1; i < listings.length; i++) {
          expect(listings[i - 1]!.createdAt).toBeGreaterThanOrEqual(listings[i]!.createdAt);
        }

        // For each output listing, no input event with the same key parsed
        // from a NEWER created_at exists (newest-wins).
        for (const listing of listings) {
          const key = `${listing.pubkey}:${listing.dTag}`;
          for (const ev of events) {
            const d = ev.tags.find((t) => t[0] === 'd')?.[1];
            if (!d || `${ev.pubkey}:${d}` !== key) continue;
            if (ev.kind !== 30402 && ev.kind !== 30403) continue;
            expect(ev.created_at).toBeLessThanOrEqual(listing.createdAt);
          }
        }
      }),
    );
  });
});

describe('formatNip99Price — property fuzz (round 30)', () => {
  it('never throws and returns a non-empty string for any bounded price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_LISTING_PRICE }),
        fc.string({ maxLength: 16 }),
        fc.option(fc.string({ maxLength: 64 }), { nil: undefined }),
        (value, currency, frequency) => {
          let out: string;
          expect(() => {
            out = formatNip99Price({ value, currency, frequency });
          }).not.toThrow();
          expect(out!.length).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('formats USD with exactly two decimals for whole values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (cents) => {
        const out = formatNip99Price({ value: cents / 100, currency: 'usd' });
        expect(out).toMatch(/^\$[\d,]+\.\d{2}$/);
      }),
    );
  });

  it('sats formatting round-trips through locale parsing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9_000_000_000 }), (sats) => {
        const out = formatNip99Price({ value: sats, currency: 'sats' });
        const digits = out.replace(/[^0-9]/g, '');
        expect(Number(digits)).toBe(sats);
      }),
    );
  });
});
