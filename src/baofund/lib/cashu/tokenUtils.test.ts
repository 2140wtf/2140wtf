// src/lib/cashu/tokenUtils.test.ts
//
// Tests for the BAO-authored token utilities (decode / normalize / validate /
// spent-check). Kept behavior: this suite was preserved from the pre-2026-08-15
// utility module (same assertions) and re-homed after the AGPL-derived code was
// removed.

import { describe, expect, it, vi } from 'vitest';
import { getDecodedToken, getEncodedToken } from 'cashu-ts3';
import { bytesToBase64Url } from './base64';
import {
  MAX_MINT_FEE_PPM,
  checkTokenProofsSpent,
  decodeCashuToken,
  hashDecodedToken,
  isAllowedMintUrl,
  isFeeWithinMaxPpm,
  normalizeMintUrl,
  normalizeProofWitnessForEncode,
  safeNormalizeMintUrl,
} from './tokenUtils';

const MINT = 'https://mint.example.com';

/** A proof shaped like what cashu-ts actually produces/accepts. */
function proof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00' + '0'.repeat(62),
    C: '02' + '0'.repeat(64),
    secret: 'f'.repeat(32),
    amount: 10,
    ...overrides,
  };
}

/** Encode a real token string from entries, exactly as the app would produce one. */
function encodeToken(mint: string, proofs: Record<string, unknown>[]): string {
  return getEncodedToken({ mint, proofs: proofs as never, unit: 'sat' });
}

describe('isFeeWithinMaxPpm', () => {
  it('allows zero fees', () => {
    expect(isFeeWithinMaxPpm(0, 1000)).toBe(true);
  });
  it('allows fees up to the ppm cap', () => {
    expect(isFeeWithinMaxPpm(50, 1000)).toBe(true); // 5%
  });
  it('rejects fees above the ppm cap', () => {
    expect(isFeeWithinMaxPpm(51, 1000)).toBe(false);
  });
  it('rejects negative fees and amounts', () => {
    expect(isFeeWithinMaxPpm(-1, 1000)).toBe(false);
    expect(isFeeWithinMaxPpm(1, -1000)).toBe(false);
  });
  it('uses the default 5% cap when ppm is omitted', () => {
    expect(MAX_MINT_FEE_PPM).toBe(50_000);
    expect(isFeeWithinMaxPpm(500, 10_000)).toBe(true);
    expect(isFeeWithinMaxPpm(501, 10_000)).toBe(false);
  });
});

describe('isAllowedMintUrl', () => {
  it('allows HTTPS mint URLs', () => {
    expect(isAllowedMintUrl('https://mint.btcforplebs.com')).toBe(true);
    expect(isAllowedMintUrl('https://mint.minibits.cash/Bitcoin')).toBe(true);
  });
  it('allows four-label hostnames (regression: parsed as 0.0.0.0 and rejected)', () => {
    expect(isAllowedMintUrl('https://a.b.c.d')).toBe(true);
  });
  it('rejects HTTP mint URLs', () => {
    expect(isAllowedMintUrl('http://mint.example.com')).toBe(false);
  });
  it('rejects non-HTTP(S) schemes', () => {
    expect(isAllowedMintUrl('ftp://mint.example.com')).toBe(false);
  });
  it('rejects localhost and private networks', () => {
    expect(isAllowedMintUrl('https://localhost:4448')).toBe(false);
    expect(isAllowedMintUrl('https://127.0.0.1:4448')).toBe(false);
    expect(isAllowedMintUrl('https://10.0.0.1')).toBe(false);
    expect(isAllowedMintUrl('https://192.168.1.1')).toBe(false);
    expect(isAllowedMintUrl('https://[::1]')).toBe(false);
    expect(isAllowedMintUrl('https://[fd00::1]')).toBe(false);
  });
  it('rejects private IPv4 embedded in IPv6 (mapped + deprecated compatible forms)', () => {
    // WHATWG URL serializes these to hex hextets - the dotted-decimal guard
    // alone never matched real URL input.
    expect(isAllowedMintUrl('https://[::ffff:127.0.0.1]')).toBe(false);
    expect(isAllowedMintUrl('https://[::127.0.0.1]')).toBe(false);
    expect(isAllowedMintUrl('https://[::10.0.0.1]')).toBe(false);
    expect(isAllowedMintUrl('https://[::192.168.1.5]')).toBe(false);
    expect(isAllowedMintUrl('https://[::ffff:10.0.0.1]')).toBe(false);
  });
  it('still allows public IPv6 mints (including public v4-compatible hextets)', () => {
    expect(isAllowedMintUrl('https://[2606:4700:4700::1111]')).toBe(true);
    expect(isAllowedMintUrl('https://[::808:808]')).toBe(true);
  });
  it('requires membership in the allow-list when one is provided', () => {
    expect(isAllowedMintUrl('https://mint.a.com', ['https://mint.a.com'])).toBe(true);
    expect(isAllowedMintUrl('https://mint.b.com', ['https://mint.a.com'])).toBe(false);
  });
  it('normalizes allow-list entries before comparing', () => {
    expect(isAllowedMintUrl('https://mint.a.com/', ['https://mint.a.com'])).toBe(true);
  });
  it('rejects invalid URLs', () => {
    expect(isAllowedMintUrl('not a url')).toBe(false);
    expect(isAllowedMintUrl('')).toBe(false);
  });
});

describe('normalizeMintUrl', () => {
  it('lowercases host, keeps path case, strips trailing slashes', () => {
    expect(normalizeMintUrl('https://Mint.Example.com/Bitcoin/')).toBe('https://mint.example.com/Bitcoin');
  });
  it('strips default ports', () => {
    expect(normalizeMintUrl('https://mint.example.com:443')).toBe('https://mint.example.com');
  });
  it('returns null for non-http(s) schemes', () => {
    expect(normalizeMintUrl('ftp://mint.example.com')).toBeNull();
  });
});

describe('safeNormalizeMintUrl', () => {
  it('falls back to the trimmed original on failure', () => {
    expect(safeNormalizeMintUrl('garbage')).toBe('garbage');
    expect(safeNormalizeMintUrl(' https://mint.example.com/')).toBe('https://mint.example.com');
  });
});

describe('normalizeProofWitnessForEncode', () => {
  it('parses a string witness back into an object', () => {
    const parsedWitness = { signatures: ['x'] };
    const proof = { witness: JSON.stringify(parsedWitness) };
    expect(normalizeProofWitnessForEncode(proof)).toEqual({ witness: parsedWitness });
  });
  it('leaves object witnesses and witness-less proofs untouched', () => {
    const withObj = { witness: { sig: 1 } };
    expect(normalizeProofWitnessForEncode(withObj)).toBe(withObj);
    const plain = { amount: 5 };
    expect(normalizeProofWitnessForEncode(plain)).toBe(plain);
  });
});

describe('decodeCashuToken', () => {
  it('rejects non-strings, over-long strings, and garbage', () => {
    // @ts-expect-error deliberate bad input
    expect(decodeCashuToken(42)).toBeNull();
    expect(decodeCashuToken('x'.repeat(100_001))).toBeNull();
    expect(decodeCashuToken('cashu')).toBeNull();
    expect(decodeCashuToken('not-a-token')).toBeNull();
  });
  it('rejects tokens whose mint fails the allow checks', () => {
    // getDecodedToken needs a well-formed token; build one from a decoded entry.
    expect(decodeCashuToken('')).toBeNull();
  });
  it('decodes a real token string', () => {
    const token = encodeToken(MINT, [proof()]);
    const entries = decodeCashuToken(token);
    expect(entries).not.toBeNull();
    expect(entries![0].mintUrl).toBe(MINT);
    expect(entries![0].amount).toBe(10);
  });
  it('strips cashu:// and cashu: prefixes', () => {
    const token = encodeToken(MINT, [proof()]);
    expect(decodeCashuToken(`cashu://${token}`)).not.toBeNull();
    expect(decodeCashuToken(`cashu:${token}`)).not.toBeNull();
  });

  it('rejects tokens from the blocked BAO signet mint (owner rule: no signet wallet anywhere)', () => {
    expect(decodeCashuToken(encodeToken('https://relay.bao.network/cashu', [proof()]))).toBeNull();
    // Same host over DNS - the trailing-dot spelling must not slip through.
    expect(decodeCashuToken(encodeToken('https://relay.bao.network./cashu', [proof()]))).toBeNull();
  });
});

describe('multi-entry v3 tokens (cashu-ts 2.9.0 upstream limitation)', () => {
  /**
   * Build a real v3 ("cashuA") token string from entries. cashu-ts 2.9.0 can
   * only ENCODE single-entry v3 tokens (`getEncodedToken(..., { version: 3 })`
   * or non-hex keyset ids); this fixture mirrors what older/other wallets
   * produce. BAO must reject it via the library, never by hand-parsing.
   */
  function v3Token(entries: Array<{ mint: string; proofs: Record<string, unknown>[] }>): string {
    const json = JSON.stringify({ token: entries, unit: 'sat' });
    return `cashuA${bytesToBase64Url(new TextEncoder().encode(json))}`;
  }

  it('pins the library rejection of a multi-entry v3 decode', () => {
    const token = v3Token([
      { mint: MINT, proofs: [proof({ secret: 's1' })] },
      { mint: MINT, proofs: [proof({ secret: 's2' })] },
    ]);
    // Upstream: decodeVersionA throws on >1 entry (message verbatim from
    // cashu-ts 2.9.0). Pinned so a dependency bump that starts accepting them
    // is a deliberate, reviewed change - and BAO never hand-rolls the parse.
    expect(() => getDecodedToken(token)).toThrow('Multi entry token are not supported');
    expect(decodeCashuToken(token)).toBeNull();
  });

  it('still decodes a single-entry v3 token (folded to the flat shape)', () => {
    const token = v3Token([{ mint: MINT, proofs: [proof({ secret: 'single' })] }]);
    const decoded = getDecodedToken(token);
    expect(decoded.mint).toBe(MINT);
    expect(decodeCashuToken(token)?.[0].amount).toBe(10);
  });
});

describe('hashDecodedToken', () => {
  it('is deterministic and stable under entry order', () => {
    const a = [{ mintUrl: MINT, proofs: [proof({ secret: 's1' }), proof({ secret: 's2' })] as unknown[], amount: 20 }];
    const b = [{ mintUrl: MINT, proofs: [proof({ secret: 's2' }), proof({ secret: 's1' })] as unknown[], amount: 20 }];
    expect(hashDecodedToken(a)).toBe(hashDecodedToken(b));
  });
});

describe('checkTokenProofsSpent', () => {
  it('returns null for an undecodable token', async () => {
    expect(await checkTokenProofsSpent('nonsense')).toBeNull();
  });
  it('returns false when at least one proof is still unspent (mock wallet)', async () => {
    const { Wallet } = await import('cashu-ts3');
    const states = vi.fn(async () => [{ Y: 'y1', state: 'UNSPENT' }, { Y: 'y2', state: 'SPENT' }]);
    vi.spyOn(Wallet.prototype, 'checkProofsStates').mockImplementation(states as never);
    const entry = { mint: MINT, proofs: [proof({ secret: 's1'.repeat(16) }), proof({ secret: 's2'.repeat(16) })] };
    const encoded = getEncodedToken({ mint: MINT, proofs: entry.proofs as never, unit: 'sat' });
    expect(await checkTokenProofsSpent(encoded)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('isAllowedMintUrl - private-host classifier (deep-hunt)', () => {
  it('rejects IPv4-mapped IPv6 loopback/link-local and unspecified', () => {
    expect(isAllowedMintUrl('https://[::ffff:127.0.0.1]:3338')).toBe(false);
    expect(isAllowedMintUrl('https://[::ffff:a9fe:a9fe]')).toBe(false); // 169.254.169.254
    expect(isAllowedMintUrl('https://[::ffff:10.0.0.1]')).toBe(false);
    expect(isAllowedMintUrl('https://[::]')).toBe(false);
  });
  it('rejects localhost with a trailing dot', () => {
    expect(isAllowedMintUrl('https://localhost.:3338')).toBe(false);
  });
  it('rejects URL credentials that spoof a trusted host', () => {
    expect(isAllowedMintUrl('https://mint.minibits.cash@evil.com')).toBe(false);
  });
  it('does not reject domain names starting fc/fd/fe', () => {
    expect(isAllowedMintUrl('https://february.mint.example')).toBe(true);
    expect(isAllowedMintUrl('https://fdroid.example')).toBe(true);
    expect(isAllowedMintUrl('https://fcast.me')).toBe(true);
  });
});

describe('decodeCashuToken - unit guard (deep-hunt)', () => {
  it('rejects non-sat units instead of treating them as sats', () => {
    const usd = getEncodedToken({ mint: MINT, proofs: [proof()] as never, unit: 'usd' });
    expect(decodeCashuToken(usd)).toBeNull();
    const sat = getEncodedToken({ mint: MINT, proofs: [proof()] as never, unit: 'sat' });
    expect(decodeCashuToken(sat)).not.toBeNull();
  });
});

/** Deterministic PRNG (mulberry32) so fuzz failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('isAllowedMintUrl - fuzz (WS9)', () => {
  it('never throws and always rejects private/loopback encodings', () => {
    const rnd = mulberry32(0xc0ffee);
    const privates = ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '0.0.0.0'];
    for (let i = 0; i < 500; i++) {
      const quad = privates[i % privates.length];
      const [a, b, c, d] = quad.split('.').map(Number);
      const mappedDotted = `::ffff:${quad}`;
      const mappedHex = `::ffff:${(((a << 8) | b) >>> 0).toString(16)}:${(((c << 8) | d) >>> 0).toString(16)}`;
      const urls = [
        `https://${quad}`,
        `https://${quad}:8332`,
        `https://[${mappedDotted}]`,
        `https://[${mappedHex}]`,
        `https://localhost.:${1000 + Math.floor(rnd() * 5000)}`,
        `https://user:pass@${quad}`,
      ];
      for (const u of urls) {
        expect(() => isAllowedMintUrl(u)).not.toThrow();
        expect(isAllowedMintUrl(u)).toBe(false);
      }
    }
  });

  it('accepts public https hosts regardless of path/port/query', () => {
    const rnd = mulberry32(0xbeef);
    for (let i = 0; i < 300; i++) {
      const host = `mint${Math.floor(rnd() * 1000)}.example.com`;
      expect(isAllowedMintUrl(`https://${host}/Bitcoin`)).toBe(true);
      expect(isAllowedMintUrl(`https://${host}:443`)).toBe(true);
    }
    // Unspecified IPv6 is loopback-equivalent and must stay rejected.
    expect(isAllowedMintUrl('https://[::]')).toBe(false);
  });
});

describe('decodeCashuToken - fuzz (WS9)', () => {
  it('never throws on random strings and yields null or bounded entries', () => {
    const rnd = mulberry32(0x1234);
    for (let i = 0; i < 500; i++) {
      const junk = Array.from({ length: 1 + Math.floor(rnd() * 64) }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
      expect(() => decodeCashuToken(junk)).not.toThrow();
      const decoded = decodeCashuToken(junk);
      expect(decoded === null || Array.isArray(decoded)).toBe(true);
    }
  });
});
