import { describe, expect, it } from 'vitest';

import { blossomFallbackUrls } from './useBlossomFallback';

describe('blossomFallbackUrls', () => {
  const servers = [
    'https://blossom.ditto.pub/',
    'https://blossom.primal.net/',
    'https://cdn.nostr.build/',
  ];

  it('returns [] for a non-Blossom URL', () => {
    expect(blossomFallbackUrls('https://cdn.example/video.mp4', servers)).toEqual([]);
  });

  it('tries the same origin without a fake extension before other servers', () => {
    const hash = 'a'.repeat(64);
    const original = `https://blossom.ditto.pub/${hash}.mp4`;
    const urls = blossomFallbackUrls(original, servers);

    expect(urls[0]).toBe(`https://blossom.ditto.pub/${hash}`);
    expect(urls).toContain(`https://blossom.primal.net/${hash}.mp4`);
    expect(urls).toContain(`https://blossom.primal.net/${hash}`);
    expect(urls).not.toContain(original);
  });

  it('does not invent an extensionless hop when the path has none', () => {
    const hash = 'b'.repeat(64);
    const original = `https://cdn.nostr.build/${hash}`;
    const urls = blossomFallbackUrls(original, servers);

    expect(urls.some((u) => u.endsWith('.mp4'))).toBe(false);
    expect(urls).toContain(`https://blossom.ditto.pub/${hash}`);
    expect(urls).not.toContain(original);
  });
});
