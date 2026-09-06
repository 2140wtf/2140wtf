import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isAllowedMintUrl } from './cashu';

// Deterministic fuzz campaign (round 25): fixed seed so failures reproduce.
fc.configureGlobal({ seed: 20260906, numRuns: 2_000 });

/** Render a uint32 IPv4 in every textual encoding a URL parser accepts.
 *  Each encoding decodes back to exactly n (WHATWG IPv4 parser rules). */
function v4Encodings(n: number): string[] {
  const o1 = (n >>> 24) & 0xff;
  const o2 = (n >>> 16) & 0xff;
  const o3 = (n >>> 8) & 0xff;
  const o4 = n & 0xff;
  return [
    `${o1}.${o2}.${o3}.${o4}`, // canonical dotted-quad
    String(n), // pure integer: https://2130706433/
    `0x${n.toString(16).padStart(8, '0')}`, // hex: https://0x7f000001/
    `0${o1.toString(8)}.${o2}.${o3}.${o4}`, // octal-laced first octet
    `${o1}.${n & 0xffffff}`, // 2-part hybrid (last part = 24 bits)
    `${o1}.${o2}.${n & 0xffff}`, // 3-part hybrid (last part = 16 bits)
  ];
}

/** Generator over the private/loopback/link-local IPv4 space. */
const privateIPv4Arb = fc.oneof(
  fc.integer({ min: 0x7f000000, max: 0x7fffffff }), // 127/8 loopback
  fc.integer({ min: 0x0a000000, max: 0x0affffff }), // 10/8 private
  fc.integer({ min: 0xac100000, max: 0xac1fffff }), // 172.16/12 private
  fc.integer({ min: 0xc0a80000, max: 0xc0a8ffff }), // 192.168/16 private
  fc.integer({ min: 0xa9fe0000, max: 0xa9feffff }), // 169.254/16 link-local
  fc.constant(0x00000000), // 0.0.0.0 this-host
);

/** Whether a canonical dotted-quad IPv4 is in a blocked class. */
function isPrivateV4Dotted(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b, c] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  return false;
}

describe('isAllowedMintUrl — SSRF policy fuzzing (round 25)', () => {
  it('P1: rejects private/loopback/link-local IPv4 in every textual encoding (whole classes)', () => {
    fc.assert(
      fc.property(privateIPv4Arb, (n) => {
        for (const host of v4Encodings(n)) {
          const url = `https://${host}/v1`;
          // Either the URL parser canonicalizes to a form the guard catches,
          // or it refuses the host — both must yield rejection. Acceptance of
          // ANY encoding of a private address is the SSRF bug this pins.
          let canonical = 'unparseable';
          let threw = false;
          try {
            canonical = new URL(url).hostname;
          } catch {
            threw = true;
          }
          expect(isAllowedMintUrl(url), `accepted private-host URL ${url} (canonical: ${canonical}, threw: ${threw})`).toBe(false);
        }
      }),
    );
  });

  it('P2: IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) must be rejected', () => {
    for (const host of ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:a00:1]', '[::ffff:c0a8:101]']) {
      const url = `https://${host}/v1`;
      expect(isAllowedMintUrl(url), `mapped IPv6 accepted: ${url}`).toBe(false);
    }
  });

  it('P3: totality — arbitrary strings return a boolean, never throw', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 3 }),
        (url, allowList) => {
          expect(typeof isAllowedMintUrl(url, allowList)).toBe('boolean');
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it('P4: non-blocked HTTPS URLs are allowed — decision is a pure function of the canonical host', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['https'], withQueryParameters: true }),
        (url) => {
          const u = new URL(url);
          const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
          // Oracle on the CANONICAL host: dotted-quad private classes, mapped
          // IPv6 with an embedded private IPv4, and localhost are blocked;
          // everything else (including hex-domain hosts like 0.aa) is public.
          const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{1,4}:[0-9a-f]{1,4})$/.exec(host);
          let embeddedPrivate = false;
          if (mapped) {
            const v4 = mapped[1]!.includes('.')
              ? mapped[1]!
              : (() => {
                  const hi = parseInt(mapped[1]!.split(':')[0]!, 16);
                  const lo = parseInt(mapped[1]!.split(':')[1]!, 16);
                  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
                })();
            embeddedPrivate = isPrivateV4Dotted(v4);
          }
          const blocked = host === 'localhost' || isPrivateV4Dotted(host) || embeddedPrivate;
          expect(isAllowedMintUrl(url)).toBe(!blocked);
        },
      ),
    );
  });
});
