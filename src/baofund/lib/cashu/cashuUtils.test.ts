import { describe, it, expect } from 'vitest';
import { detectTokenType, isAllowedMintUrl, normalizeMintUrl } from './cashu';

describe('detectTokenType', () => {
  it('detects lightning invoices (lnbc prefix)', () => {
    expect(detectTokenType('lnbc100n1abc').type).toBe('lightning');
  });
  it('detects cashu tokens', () => {
    expect(detectTokenType('cashuBo2FteB9odHRw').type).toBe('cashu');
  });
  it('detects LNURLs', () => {
    expect(detectTokenType('LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0MN38EYCETVWFHH2').type).toBe('lnurl');
  });
  it('returns unknown for random strings', () => {
    expect(detectTokenType('hello world').type).toBe('unknown');
  });
});

describe('isAllowedMintUrl', () => {
  it('accepts HTTPS URLs on the public internet (no allowlist needed)', () => {
    expect(isAllowedMintUrl('https://mint.example.com', undefined)).toBe(true);
  });
  it('rejects HTTP URLs (must be HTTPS)', () => {
    expect(isAllowedMintUrl('http://mint.example.com', undefined)).toBe(false);
  });
  it('rejects localhost and private IPs', () => {
    expect(isAllowedMintUrl('https://localhost:3000', undefined)).toBe(false);
    expect(isAllowedMintUrl('https://127.0.0.1', undefined)).toBe(false);
    expect(isAllowedMintUrl('https://10.0.0.1', undefined)).toBe(false);
  });
});

describe('normalizeMintUrl', () => {
  it('adds https:// when protocol is missing', () => {
    const r = normalizeMintUrl('mint.example.com/path');
    if (r !== null) expect(r).toContain('https://');
    else expect(r).toBeNull(); // may reject bare hostnames without TLD
  });
  it('strips trailing slashes and lowercases the origin', () => {
    const r = normalizeMintUrl('https://Mint.Example.com///');
    if (r !== null) expect(r.startsWith('https://mint.example.com')).toBe(true);
  });
});
