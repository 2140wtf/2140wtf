import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from './sanitizeUrl';

describe('sanitizeUrl', () => {
  it('returns the href for valid https URLs', () => {
    expect(sanitizeUrl('https://example.com/path?x=1')).toBe('https://example.com/path?x=1');
  });

  it('allows https URLs with unusual but safe characters', () => {
    expect(sanitizeUrl('https://example.com/foo%20bar')).toBe('https://example.com/foo%20bar');
  });

  it('rejects javascript: URIs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('javascript://example.com/%0Aalert(1)')).toBeUndefined();
  });

  it('rejects data: URIs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('rejects http: URIs', () => {
    expect(sanitizeUrl('http://example.com')).toBeUndefined();
  });

  it('rejects malformed strings', () => {
    expect(sanitizeUrl('not a url')).toBeUndefined();
    expect(sanitizeUrl('')).toBeUndefined();
  });

  it('rejects null/undefined', () => {
    expect(sanitizeUrl(null)).toBeUndefined();
    expect(sanitizeUrl(undefined)).toBeUndefined();
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeUrl('//evil.com')).toBeUndefined();
  });
});
