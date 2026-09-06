import fc from 'fast-check';
import { bech32 } from '@scure/base';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import type { NostrEvent } from '@nostrify/nostrify';
import type { Event as NostrToolsEvent } from 'nostr-tools/pure';

import {
  bolt11AmountSats,
  bolt11Info,
  isValidZapSats,
  MAX_ZAP_SATS,
  tallyOnchainZaps,
  tallyZaps,
  verifyZapRumor,
  zapRumorTags,
} from './zaps';

// Deterministic fuzz campaign (round 27b): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 300 });

const TARGET = 'a'.repeat(64);

// BOLT11 multipliers → msats: m=1e8, u=1e5, n=100, p=0.1. We use `n`, so a
// whole-sat amount S decodes exactly from HRP digits (S × 1000 / 100 = 10S).
const SATS_MAX = 1_000_000;
const hrpForSats = (sats: number): string => `lnbc${String(sats * 10)}n`;

/** Bytes → 5-bit bech32 words (big-endian accumulation). */
function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      words.push((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

function hexToWords(hex: string): number[] {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToWords(out);
}

/** Craft a CHECKSUM-VALID bolt11 invoice with an arbitrary HRP amount (the
 *  amount is plain ASCII in the HRP per BOLT11) and an arbitrary payment hash.
 *  Layout per BOLT11: data words = timestamp + tagged fields + RAW tail of
 *  signature(64B) + recovery flag(1B) — the tail is NOT a tagged field (the
 *  decoder strips the last 104 words). This is the attacker model: anyone can
 *  compute bech32 checksums, so only the app's field validation can reject
 *  hostile invoices. Verified against light-bolt11-decoder byte-for-byte. */
function craftInvoice(hrp: string, paymentHashHex = '15'.repeat(32), tsSec = 1_700_000_000): string {
  const words: number[] = [];
  for (let i = 6; i >= 0; i--) words.push(Math.floor(tsSec / 2 ** (5 * i)) & 31);
  const ph = hexToWords(paymentHashHex);
  words.push(1, ph.length >> 5, ph.length & 31, ...ph); // payment_hash tag (32 bytes → 52 words)
  const sigAndRecovery = new Uint8Array(65);
  sigAndRecovery.fill(0x42, 0, 64);
  sigAndRecovery[64] = 0x01; // recovery flag 1
  words.push(...bytesToWords(sigAndRecovery)); // raw 104-word tail
  return bech32.encode(hrp, words, Number.MAX_SAFE_INTEGER);
}

/** Signed kind-9735 receipt whose embedded kind-9734 request verifies, names
 *  TARGET, and carries `amountMsats` consistent with the invoice. */
function makeReceipt(amountMsats: number, invoice: string): NostrEvent {
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      tags: [['e', TARGET], ['p', getPublicKey(generateSecretKey())], ['amount', String(amountMsats)]],
      content: '',
    },
    generateSecretKey(),
  ) as unknown as NostrToolsEvent;
  return finalizeEvent(
    {
      kind: 9735,
      created_at: 1_700_000_000,
      tags: [['e', TARGET], ['bolt11', invoice], ['description', JSON.stringify(request)]],
      content: '',
    },
    generateSecretKey(),
  ) as unknown as NostrEvent;
}

const satsArb = fc.integer({ min: 1, max: SATS_MAX });

describe('bolt11Info — property hardening (round 27b)', () => {
  it('P1: sane sats decode EXACTLY (msats and sats floor), for every amount in range', () => {
    fc.assert(
      fc.property(satsArb, (sats) => {
        const invoice = craftInvoice(hrpForSats(sats));
        const info = bolt11Info(invoice);
        expect(info.amountMsats).toBe(sats * 1000);
        expect(bolt11AmountSats(invoice)).toBe(sats);
      }),
    );
  });

  it('P2: never returns a non-safe-integer or non-positive amount, for any crafted invoice', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(9), { minLength: 0, maxLength: 15 }).map((d) => d.join('')),
        fc.constantFrom('p', 'n', 'u', 'm', ''),
        fc.integer({ min: 0, max: 20 }),
        (digits, mult, zeros) => {
          const info = bolt11Info(craftInvoice(`lnbc${digits}${mult}${'0'.repeat(zeros)}`));
          if (info.amountMsats !== null) {
            expect(Number.isSafeInteger(info.amountMsats)).toBe(true);
            expect(info.amountMsats).toBeGreaterThan(0);
          }
        },
      ),
    );
  });

  it('P3: a known >2^53 invoice now fails closed (regression: lossy float acceptance)', () => {
    // 21,000,000 BTC bare = 2.1e18 msat: light-bolt11-decoder returns
    // 900719925474099200 (lossy float, isSafeInteger=false). The old code
    // accepted it into settlement math; the safe-integer contract rejects it.
    expect(Number.isSafeInteger(2_100_000_000_000_000_000)).toBe(false);
    expect(bolt11Info(craftInvoice('lnbc21000000')).amountMsats).toBeNull();
  });

  it('P4: garbage never throws, amount is null or a safe positive integer', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 250 }), (s) => {
        let info: ReturnType<typeof bolt11Info>;
        expect(() => {
          info = bolt11Info(s);
        }).not.toThrow();
        expect(info!.amountMsats === null || (Number.isSafeInteger(info!.amountMsats) && info!.amountMsats > 0)).toBe(true);
      }),
    );
  });
});

describe('settlement accumulators — property bounds (round 27b)', () => {
  it('P5: tallyZaps total equals sum of entries; every entry within supply bound', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ sats: satsArb }), { maxLength: 12 }),
        (specs) => {
          const receipts = specs.map(({ sats }) => makeReceipt(sats * 1000, craftInvoice(hrpForSats(sats))));
          const tally = tallyZaps(receipts, TARGET);
          const sum = tally.zaps.reduce((acc, z) => acc + z.sats, 0);
          expect(tally.totalSats).toBe(sum);
          for (const z of tally.zaps) expect(isValidZapSats(z.sats)).toBe(true);
          expect(tally.count).toBe(tally.zaps.length);
          expect(Number.isSafeInteger(tally.totalSats)).toBe(true);
          expect(tally.totalSats <= tally.count * MAX_ZAP_SATS).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('P6: same payment hash counts once even across different receipt ids', () => {
    fc.assert(
      fc.property(satsArb, (sats) => {
        const invoice = craftInvoice(hrpForSats(sats));
        const a = makeReceipt(sats * 1000, invoice);
        const b = makeReceipt(sats * 1000, invoice); // distinct id, same payment hash
        expect(a.id).not.toBe(b.id);
        expect(tallyZaps([a, b], TARGET).count).toBe(1);
      }),
      { numRuns: 40 },
    );
  });

  it('P7: over-supply onchain amounts are rejected, totals stay safe integers', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(MAX_ZAP_SATS + 1),
          fc.constant(Number.MAX_SAFE_INTEGER),
          fc.constant(9e15),
          satsArb,
        ),
        (sats) => {
          const ev = finalizeEvent(
            {
              kind: 8333,
              created_at: 1_700_000_000,
              tags: [['e', TARGET], ['i', `bitcoin:tx:${'a'.repeat(64)}`], ['amount', String(sats)]],
              content: '',
            },
            generateSecretKey(),
          ) as unknown as NostrEvent;
          const tally = tallyOnchainZaps([ev], TARGET);
          if (sats > MAX_ZAP_SATS || !Number.isSafeInteger(sats)) expect(tally.count).toBe(0);
          expect(Number.isSafeInteger(tally.totalSats)).toBe(true);
        },
      ),
    );
  });

  it('P8: isValidZapSats boundary is exact', () => {
    expect(isValidZapSats(0)).toBe(false);
    expect(isValidZapSats(-1)).toBe(false);
    expect(isValidZapSats(1)).toBe(true);
    expect(isValidZapSats(MAX_ZAP_SATS)).toBe(true);
    expect(isValidZapSats(MAX_ZAP_SATS + 1)).toBe(false);
    expect(isValidZapSats(Number.MAX_SAFE_INTEGER)).toBe(false); // > Bitcoin supply
    expect(isValidZapSats(1.5)).toBe(false);
    expect(isValidZapSats(Number.NaN)).toBe(false);
    expect(isValidZapSats(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('verifyZapRumor — property hardening (round 27b)', () => {
  it('P9: hash-consistent rumor verifies; tampered amount or preimage fails closed', () => {
    fc.assert(
      fc.property(satsArb, fc.stringMatching(/^[0-9a-f]{64}$/), fc.stringMatching(/^[0-9a-f]{64}$/), (sats, preimage, otherPreimage) => {
        const paymentHash = createHash('sha256').update(preimage, 'hex').digest('hex');
        const invoice = craftInvoice(hrpForSats(sats), paymentHash);
        const amountMsats = sats * 1000;
        const base = {
          targetId: TARGET,
          targetKind: 1,
          recipient: 'b'.repeat(64),
          bolt11: invoice,
        };
        // Consistent rumor → verifies, returns the payment hash.
        expect(
          verifyZapRumor({ kind: 9735, tags: zapRumorTags({ ...base, amountMsats, preimage }) }),
        ).toBe(paymentHash);
        // Amount tampered by any delta → voided.
        expect(
          verifyZapRumor({ kind: 9735, tags: zapRumorTags({ ...base, amountMsats: amountMsats + 1000, preimage }) }),
        ).toBeNull();
        // Different preimage (hash mismatch) → voided.
        if (otherPreimage !== preimage) {
          expect(
            verifyZapRumor({ kind: 9735, tags: zapRumorTags({ ...base, amountMsats, preimage: otherPreimage }) }),
          ).toBeNull();
        }
      }),
      { numRuns: 120 },
    );
  });
});
