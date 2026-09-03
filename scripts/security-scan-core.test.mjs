import { describe, expect, it } from 'vitest';

import { findCapabilityLeaks, redactedEvidence } from './security-scan-core.mjs';

const fragment = 'A'.repeat(80);
const secret = 'a'.repeat(64);

describe('BAO capability leak detection', () => {
  it('detects complete human and agent invite fragments', () => {
    expect(findCapabilityLeaks(`https://2140.social/chat/join#${fragment}`)).toHaveLength(1);
    expect(findCapabilityLeaks(`https://2140.social/agent#${fragment}`)).toHaveLength(1);
  });

  it('detects room-link fields, split secrets, and issued short links', () => {
    expect(findCapabilityLeaks(`{ "joinLink": "#${fragment}" }`)).toHaveLength(1);
    expect(findCapabilityLeaks(`room=test\nsecret=${secret}\nrelay=wss://example.test`)).toHaveLength(1);
    const issuedShortUrl = ['https://2140.social', 'i', 'Abc_123-xy'].join('/');
    expect(findCapabilityLeaks(issuedShortUrl)).toHaveLength(1);
  });

  it('allows documentation placeholders and capability-building code', () => {
    expect(findCapabilityLeaks('https://2140.social/agent#<fragment>')).toEqual([]);
    expect(findCapabilityLeaks('https://2140.social/i/<code>')).toEqual([]);
    expect(findCapabilityLeaks('createJoinLink(host, secret, roomId)')).toEqual([]);
  });

  it('reports only a non-reversible fingerprint, never the capability', () => {
    const capability = `https://2140.social/agent#${fragment}`;
    const serialized = JSON.stringify(redactedEvidence(capability));
    expect(serialized).not.toContain(capability);
    expect(redactedEvidence(capability)).toMatchObject({
      chars: capability.length,
      sha256: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
  });
});
