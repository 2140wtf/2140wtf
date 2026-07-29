import { describe, expect, it, vi } from 'vitest';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { getEncodedToken } from '@cashu/cashu-ts';
import { hashToCurve } from '@cashu/cashu-ts/crypto/common';

import { deriveNutzapKey, isFeeWithinMaxPpm, MAX_MINT_FEE_PPM, isAllowedMintUrl, checkTokenProofsSpent } from './cashu';

describe('isFeeWithinMaxPpm', () => {
  it('allows zero fees', () => {
    expect(isFeeWithinMaxPpm(0, 1000, MAX_MINT_FEE_PPM)).toBe(true);
  });

  it('allows fees up to the ppm cap', () => {
    expect(isFeeWithinMaxPpm(50, 1000, 50_000)).toBe(true);
  });

  it('rejects fees above the ppm cap', () => {
    expect(isFeeWithinMaxPpm(51, 1000, 50_000)).toBe(false);
  });

  it('rejects negative fees and amounts', () => {
    expect(isFeeWithinMaxPpm(-1, 1000, MAX_MINT_FEE_PPM)).toBe(false);
    expect(isFeeWithinMaxPpm(1, -1, MAX_MINT_FEE_PPM)).toBe(false);
  });

  it('uses the default 5% cap when ppm is omitted', () => {
    expect(isFeeWithinMaxPpm(50_000, 1_000_000)).toBe(true);
    expect(isFeeWithinMaxPpm(50_001, 1_000_000)).toBe(false);
  });
});

describe('isAllowedMintUrl', () => {
  it('allows HTTPS mint URLs', () => {
    expect(isAllowedMintUrl('https://mint.example.com')).toBe(true);
  });

  it('rejects HTTP mint URLs', () => {
    expect(isAllowedMintUrl('http://mint.example.com')).toBe(false);
  });

  it('rejects non-HTTP(S) schemes', () => {
    expect(isAllowedMintUrl('ftp://mint.example.com')).toBe(false);
    expect(isAllowedMintUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects localhost and private networks', () => {
    expect(isAllowedMintUrl('https://localhost')).toBe(false);
    expect(isAllowedMintUrl('https://127.0.0.1')).toBe(false);
    expect(isAllowedMintUrl('https://10.0.0.1')).toBe(false);
    expect(isAllowedMintUrl('https://192.168.1.1')).toBe(false);
  });

  it('requires membership in the allow-list when one is provided', () => {
    const allowed = ['https://trusted.mint.com', 'https://another.mint.com'];
    expect(isAllowedMintUrl('https://trusted.mint.com', allowed)).toBe(true);
    expect(isAllowedMintUrl('https://untrusted.mint.com', allowed)).toBe(false);
  });

  it('normalizes allow-list entries before comparing', () => {
    const allowed = ['https://trusted.mint.com/'];
    expect(isAllowedMintUrl('https://trusted.mint.com', allowed)).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedMintUrl('not a url')).toBe(false);
  });
});

describe('deriveNutzapKey', () => {
  it('derives a deterministic compressed pubkey from a seed phrase', () => {
    const phrase = generateMnemonic(wordlist);
    const a = deriveNutzapKey(phrase);
    const b = deriveNutzapKey(phrase);

    expect(a.pubkey).toBe(b.pubkey);
    expect(a.pubkey).toMatch(/^0[2-3][0-9a-f]{64}$/i);
    expect(a.privkey).toHaveLength(32);

    // The public key matches the private key.
    const pubkeyBytes = secp256k1.getPublicKey(a.privkey, true);
    expect(Buffer.from(pubkeyBytes).toString('hex')).toBe(a.pubkey.toLowerCase());
  });

  it('produces different keys for different seed phrases', () => {
    const a = deriveNutzapKey(generateMnemonic(wordlist));
    const b = deriveNutzapKey(generateMnemonic(wordlist));
    expect(a.pubkey).not.toBe(b.pubkey);
  });

  it('derives a key different from the BIP-39 seed', () => {
    const phrase = generateMnemonic(wordlist);
    const seed = mnemonicToSeedSync(phrase);
    const nutzap = deriveNutzapKey(phrase);
    // The nutzap private key must not equal the raw seed.
    expect(Buffer.from(nutzap.privkey).toString('hex')).not.toBe(Buffer.from(seed.slice(0, 32)).toString('hex'));
  });
});

describe('checkTokenProofsSpent (hunt regression [16])', () => {
  const MINT = 'https://mint.example.com';
  const encoder = new TextEncoder();

  function tokenWithSecrets(...secrets: string[]): string {
    return getEncodedToken({
      mint: MINT,
      proofs: secrets.map((secret) => ({
        id: '009a1f293253e41e',
        amount: 1,
        secret,
        C: `02${'cd'.repeat(32)}`,
      })),
    });
  }

  function yOf(secret: string): string {
    return hashToCurve(encoder.encode(secret)).toHex(true);
  }

  /** Stubs global fetch so the mint's /v1/checkstate marks `spentSecrets` SPENT. */
  function stubCheckstate(spentSecrets: string[]) {
    const spentYs = new Set(spentSecrets.map(yOf));
    return vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as { Ys?: string[] };
      const Ys = body.Ys ?? [];
      return new Response(
        JSON.stringify({ states: Ys.map((Y) => ({ Y, state: spentYs.has(Y) ? 'SPENT' : 'UNSPENT' })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
  }

  it('returns true when every proof is SPENT at the mint', async () => {
    const token = tokenWithSecrets('secret-a', 'secret-b');
    vi.stubGlobal('fetch', stubCheckstate(['secret-a', 'secret-b']));
    await expect(checkTokenProofsSpent(token)).resolves.toBe(true);
  });

  it('returns false when at least one proof is still unspent', async () => {
    const token = tokenWithSecrets('secret-a', 'secret-b');
    vi.stubGlobal('fetch', stubCheckstate(['secret-a']));
    await expect(checkTokenProofsSpent(token)).resolves.toBe(false);
  });

  it('returns null for an undecodable token', async () => {
    vi.stubGlobal('fetch', stubCheckstate([]));
    await expect(checkTokenProofsSpent('not-a-cashu-token')).resolves.toBeNull();
  });

  it('returns null when the mint cannot be reached', async () => {
    const token = tokenWithSecrets('secret-a');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(checkTokenProofsSpent(token)).resolves.toBeNull();
  });
});
