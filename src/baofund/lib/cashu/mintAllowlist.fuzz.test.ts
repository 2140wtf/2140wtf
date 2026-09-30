/**
 * WS9 round-4 fuzz: mint allowlist across ADDRESS-LITERAL TRANSITIONS.
 *
 * Round-3 closed the NAT64/6to4 hole and the deprecated IPv4-compatible/
 * translated forms: a private/loopback target hides behind a public-looking
 * IPv6 literal and the browser (or the NAT64/6to4 gateway) routes it to the
 * v4 destination. The property under fuzz is family-level: NO spelling of a
 * private v4 - dotted, hex, mapped, translated, compatible, NAT64, 6to4 -
 * may pass `isAllowedMintUrl`, while ordinary public https hosts still do.
 *
 * Deterministic; pure string/URL parsing.
 */
import { describe, expect, it } from 'vitest';
import { isAllowedMintUrl, normalizeMintUrl } from './tokenUtils';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRIVATE_V4 = ['127.0.0.1', '10.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1'];

describe('mint allowlist transitions - fuzz (round 4)', () => {
  it('every transition spelling of a private v4 is rejected (no bypass, no throw)', () => {
    for (const quad of PRIVATE_V4) {
      const [a, b, c, d] = quad.split('.').map(Number);
      const hi = (((a! << 8) | b!) >>> 0).toString(16);
      const lo = (((c! << 8) | d!) >>> 0).toString(16);
      const forms = [
        quad,
        `::ffff:${quad}`,
        `::ffff:0:${quad}`,
        `::${quad}`,
        `::ffff:${hi}:${lo}`,
        `::ffff:0:${hi}:${lo}`,
        `::${hi}:${lo}`,
        `64:ff9b::${quad}`,
        `64:ff9b::${hi}:${lo}`,
        `64:ff9b:1::${quad}`,
        `64:ff9b:1::${hi}:${lo}`,
        `2002:${hi}:${lo}::`,
        `2002:${hi}:${lo}::1`,
        `${quad}:3338`,
      ];
      for (const host of forms) {
        const urls = [
          `https://${host}`,
          `https://[${host}]`,
          `https://[${host}]:3338`,
          `https://user:pass@[${host}]`,
        ];
        for (const url of urls) {
          expect(() => isAllowedMintUrl(url)).not.toThrow();
          // The bracketed forms are the real URL shape; a bare v4 with port is
          // covered too. Every spelling must fail closed.
          expect(isAllowedMintUrl(url)).toBe(false);
        }
      }
    }
  });

  it('public controls stay allowed and random hosts never crash the parser', () => {
    const rnd = mulberry32(0x5eed40);
    for (let i = 0; i < 200; i++) {
      const pub = `https://mint${Math.floor(rnd() * 10_000)}.example.com/Bitcoin`;
      expect(isAllowedMintUrl(pub)).toBe(true);
    }
    expect(isAllowedMintUrl('https://8.8.8.8:3338')).toBe(true);
    expect(isAllowedMintUrl('https://[2001:4860:4860::8888]')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('mintUrl');

    const junk = ['', 'not a url', 'https://', 'http://mint.example.com', 'https://exa mple.com', 'https://[::]', 'javascript:alert(1)'];
    for (let i = 0; i < 300; i++) {
      const u = junk[Math.floor(rnd() * junk.length)]! + (rnd() < 0.3 ? `?x=${i}` : '');
      expect(() => isAllowedMintUrl(u)).not.toThrow();
      expect(typeof isAllowedMintUrl(u)).toBe('boolean');
      expect(() => normalizeMintUrl(u)).not.toThrow();
    }
  });
});
