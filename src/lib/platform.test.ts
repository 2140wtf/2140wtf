import { describe, expect, it } from 'vitest';

import { normalizeRelayUrl, routeParamToRelay } from './platform';

describe('platform relay URL boundaries', () => {
  it('accepts secure relays and local development relays', () => {
    expect(normalizeRelayUrl('wss://relay.example.com/')).toBe('wss://relay.example.com');
    expect(normalizeRelayUrl('ws://localhost:7777/')).toBe('ws://localhost:7777');
  });

  it('rejects cleartext remote and credential-bearing relay URLs', () => {
    expect(normalizeRelayUrl('ws://relay.example.com')).toBeUndefined();
    expect(normalizeRelayUrl('wss://user:password@relay.example.com')).toBeUndefined();
  });

  it('fails closed for malformed encoded route parameters', () => {
    expect(routeParamToRelay('%E0%A4%A')).toBeUndefined();
    expect(routeParamToRelay(encodeURIComponent('ws:relay.example.com'))).toBeUndefined();
    expect(routeParamToRelay(encodeURIComponent('wss://relay.example.com/'))).toBe('wss://relay.example.com');
  });
});
