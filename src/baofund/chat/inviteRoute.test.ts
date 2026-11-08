import { describe, expect, it } from 'vitest';

import { CANONICAL_JOIN_PATH, isJoinPath, joinLinkFromLocation, normalizeJoinPath } from './inviteRoute';

// A real-shaped fragment: base64url JSON with the `cs` checksum field. The
// helper must never re-encode it, so the sample keeps `-` and `_`.
const FRAGMENT = 'eyJrIjoiYWFhIiwiY3MiOiIwMTJhYmMiLCJyb29tIjoicjEifQ-_x';

describe('invite join paths', () => {
  it('accepts both surface join paths, with or without the trailing slash', () => {
    expect(isJoinPath('/chat/join')).toBe(true);
    expect(isJoinPath('/chat/join/')).toBe(true);
    expect(isJoinPath('/fal-live/join')).toBe(true);
    expect(isJoinPath('/fal-live/join//')).toBe(true);
  });

  it('never adopts a fragment on the surfaces themselves', () => {
    // The chat page and the community/fal-live pages carry unrelated hashes
    // (anchors, campaign refs); only an explicit join path is an invite.
    for (const path of ['/', '/chat', '/community', '/fal-live', '/testnet', '/chat/joinery']) {
      expect(isJoinPath(path)).toBe(false);
      expect(joinLinkFromLocation(path, `#${FRAGMENT}`, 'https://2140.wtf')).toBeNull();
    }
  });

  it('normalizes an empty path to the root', () => {
    expect(normalizeJoinPath('')).toBe('/');
    expect(normalizeJoinPath('/')).toBe('/');
  });
});

describe('joinLinkFromLocation', () => {
  it('rebuilds the one canonical invite URL from either join path', () => {
    expect(joinLinkFromLocation('/chat/join', `#${FRAGMENT}`, 'https://2140.wtf')).toBe(
      `https://2140.wtf${CANONICAL_JOIN_PATH}#${FRAGMENT}`,
    );
    // The fal.live frame opens the room too, but the link it stores and
    // re-shares is the canonical one - two URL forms would mean two
    // credential sets for the same room.
    expect(joinLinkFromLocation('/fal-live/join/', `#${FRAGMENT}`, 'https://2140.wtf')).toBe(
      `https://2140.wtf${CANONICAL_JOIN_PATH}#${FRAGMENT}`,
    );
  });

  it('preserves the fragment verbatim, base64url padding signs and all', () => {
    expect(joinLinkFromLocation('/chat/join', `#${FRAGMENT}`, 'https://2140.wtf')).toContain(FRAGMENT);
    // No URLSearchParams round trip: `+` and `=` inside the fragment are data.
    expect(joinLinkFromLocation('/chat/join', '#a+b==c', 'https://2140.wtf')).toBe(
      `https://2140.wtf${CANONICAL_JOIN_PATH}#a+b==c`,
    );
  });

  it('treats a bare # and a missing fragment as nothing to adopt', () => {
    expect(joinLinkFromLocation('/chat/join', '#', 'https://2140.wtf')).toBeNull();
    expect(joinLinkFromLocation('/chat/join', '', 'https://2140.wtf')).toBeNull();
  });

  it('accepts a hash without the leading #', () => {
    expect(joinLinkFromLocation('/chat/join', FRAGMENT, 'https://2140.wtf')).toBe(
      `https://2140.wtf${CANONICAL_JOIN_PATH}#${FRAGMENT}`,
    );
  });

  it('normalizes a trailing slash on the origin so the link is never //', () => {
    expect(joinLinkFromLocation('/chat/join', `#${FRAGMENT}`, 'https://2140.wtf/')).toBe(
      `https://2140.wtf${CANONICAL_JOIN_PATH}#${FRAGMENT}`,
    );
  });
});
