import { describe, expect, it } from 'vitest';
import {
  sanitizeUrl,
  isAllowedHttpsUrl,
  isAllowedRelayUrl,
  isAllowedShareOrigin,
  isAllowedUrlTemplate,
  isLocalNetworkUrl,
  isAllowedBlossomUrl,
} from './sanitizeUrl';

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

  it('rejects HTTPS local-network URLs to prevent browser-side probing', () => {
    expect(sanitizeUrl('https://127.0.0.1/admin')).toBeUndefined();
    expect(sanitizeUrl('https://192.168.1.10/photo')).toBeUndefined();
    expect(sanitizeUrl('https://printer.local/status')).toBeUndefined();
  });
});

describe('URL allowlist helpers', () => {
  describe('isAllowedRelayUrl', () => {
    it('accepts wss:// relays', () => {
      expect(isAllowedRelayUrl('wss://relay.example.com')).toBe(true);
    });

    it('rejects ws:// relays outside localhost', () => {
      expect(isAllowedRelayUrl('ws://relay.example.com')).toBe(false);
    });

    it('accepts ws:// localhost relays for dev', () => {
      expect(isAllowedRelayUrl('ws://localhost:7777')).toBe(true);
      expect(isAllowedRelayUrl('ws://127.0.0.1:7777')).toBe(true);
    });

    it('rejects non-relay URLs', () => {
      expect(isAllowedRelayUrl('https://relay.example.com')).toBe(false);
      expect(isAllowedRelayUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedRelayUrl('')).toBe(false);
    });
  });

  describe('isAllowedHttpsUrl', () => {
    it('accepts https:// URLs', () => {
      expect(isAllowedHttpsUrl('https://example.com')).toBe(true);
    });

    it('accepts empty values for optional fields', () => {
      expect(isAllowedHttpsUrl('')).toBe(true);
      expect(isAllowedHttpsUrl(undefined)).toBe(true);
    });

    it('rejects http:// outside localhost', () => {
      expect(isAllowedHttpsUrl('http://example.com')).toBe(false);
    });

    it('accepts http:// localhost for dev', () => {
      expect(isAllowedHttpsUrl('http://localhost:3000')).toBe(true);
    });

    it('rejects javascript: URLs', () => {
      expect(isAllowedHttpsUrl('javascript:alert(1)')).toBe(false);
    });
  });

  describe('isAllowedShareOrigin', () => {
    it('accepts bare https origins', () => {
      expect(isAllowedShareOrigin('https://2140.wtf')).toBe(true);
    });

    it('rejects origins with path or query', () => {
      expect(isAllowedShareOrigin('https://2140.wtf/path')).toBe(false);
      expect(isAllowedShareOrigin('https://2140.wtf?x=1')).toBe(false);
    });

    it('rejects non-https origins', () => {
      expect(isAllowedShareOrigin('http://2140.wtf')).toBe(false);
    });
  });

  describe('isLocalNetworkUrl and Blossom URLs', () => {
    it('recognizes private, loopback, link-local, and local-name hosts', () => {
      expect(isLocalNetworkUrl('https://127.0.0.1')).toBe(true);
      expect(isLocalNetworkUrl('https://10.0.0.1')).toBe(true);
      expect(isLocalNetworkUrl('https://172.16.0.1')).toBe(true);
      expect(isLocalNetworkUrl('https://169.254.1.1')).toBe(true);
      expect(isLocalNetworkUrl('https://device.local')).toBe(true);
      expect(isLocalNetworkUrl('https://example.com')).toBe(false);
    });

    it('allows only public HTTPS Blossom origins', () => {
      expect(isAllowedBlossomUrl('https://cdn.example')).toBe(true);
      expect(isAllowedBlossomUrl('http://cdn.example')).toBe(false);
      expect(isAllowedBlossomUrl('https://user:pass@cdn.example')).toBe(false);
      expect(isAllowedBlossomUrl('https://localhost')).toBe(false);
    });
  });

  describe('isAllowedUrlTemplate', () => {
    it('accepts empty templates', () => {
      expect(isAllowedUrlTemplate('')).toBe(true);
    });

    it('accepts https templates with placeholders', () => {
      expect(isAllowedUrlTemplate('https://proxy.example.com/{href}')).toBe(true);
    });

    it('rejects templates starting with javascript:', () => {
      expect(isAllowedUrlTemplate('javascript:alert({href})')).toBe(false);
    });
  });
});
