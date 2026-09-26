import { describe, expect, it } from 'vitest';
import { FALLBACK_MINT_URL, isBlockedMintUrl, parseMintUrls } from './mintConfig';

describe('parseMintUrls', () => {
  it('returns [] for missing/blank input', () => {
    expect(parseMintUrls(undefined)).toEqual([]);
    expect(parseMintUrls('')).toEqual([]);
    expect(parseMintUrls('   ,  ')).toEqual([]);
  });

  it('parses comma/space/newline separated https mints, normalizing trailing slashes', () => {
    expect(parseMintUrls('https://mint.example/cashu/, https://mint2.example\nhttps://mint3.example')).toEqual([
      'https://mint.example/cashu',
      'https://mint2.example',
      'https://mint3.example',
    ]);
  });

  it('dedupes repeats', () => {
    expect(parseMintUrls('https://mint.example/a https://mint.example/a/')).toEqual(['https://mint.example/a']);
  });

  it('rejects non-http(s) schemes and junk entries', () => {
    expect(parseMintUrls('javascript:alert(1), ftp://mint.example, not-a-url')).toEqual([]);
  });

  it('allows http only for localhost', () => {
    expect(parseMintUrls('http://127.0.0.1:3338/cashu')).toEqual(['http://127.0.0.1:3338/cashu']);
    expect(parseMintUrls('http://mint.example')).toEqual([]);
  });

  it('caps oversized and over-count input', () => {
    expect(parseMintUrls(`https://mint.example/${'a'.repeat(600)}`)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `https://mint${i}.example`).join(',');
    expect(parseMintUrls(many)).toHaveLength(8);
  });

  it('rejects the BAO signet mint host even when configured', () => {
    expect(parseMintUrls('https://relay.bao.network/cashu')).toEqual([]);
    expect(parseMintUrls('https://mint.example,https://relay.bao.network/cashu')).toEqual(['https://mint.example']);
  });

  it('rejects the blocked signet host written with a trailing DNS dot (same host over DNS)', () => {
    // `https://relay.bao.network./cashu` resolves to the same signet mint, but
    // the raw hostname carries a trailing dot - a stale/typo'd env var must
    // not slip the signet mint past the blocklist.
    expect(isBlockedMintUrl('https://relay.bao.network./cashu')).toBe(true);
    expect(parseMintUrls('https://relay.bao.network./cashu')).toEqual([]);
    expect(parseMintUrls('https://mint.example,https://relay.bao.network./cashu')).toEqual(['https://mint.example']);
  });

  it('fallback mint is a public https MAINNET mint, never the signet test mint', () => {
    expect(FALLBACK_MINT_URL.startsWith('https://')).toBe(true);
    expect(FALLBACK_MINT_URL).toBe('https://mint.minibits.cash/Bitcoin');
    // Regression lock: the BAO relay-hosted mint is a signet test mint
    // (cashu-mint.service on bao8gb, markets CBANOS settlement only) and
    // must never be the Fund wallet's default.
    expect(FALLBACK_MINT_URL).not.toContain('relay.bao.network/cashu');
  });
});
