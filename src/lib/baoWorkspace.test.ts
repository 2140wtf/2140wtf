import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';

import { parseRepoRef, type RepoRef } from '@/lib/baoWorkspace';

// Test vectors: a known owner pubkey, its naddr (NIP-34 coordinate) and npub form.
const OWNER = '84230a6db2de1e1ce777c303a2b23bf309ff3bf8cb12c2392f9c3e4c8d85d947';
const NADDR = nip19.naddrEncode({
  kind: 30617,
  pubkey: OWNER,
  identifier: 'bao-core',
  relays: ['wss://relay.example.com/'],
});
const NPUB = nip19.npubEncode(OWNER);

describe('parseRepoRef — control-vs-data, fail-closed', () => {
  it('parses a NIP-34 naddr as the Nostr-native control-plane coordinate', () => {
    const ref = parseRepoRef(NADDR);
    expect(ref).toMatchObject({
      host: 'naddr',
      identifier: 'bao-core',
      authorHex: OWNER,
      coordinate: `30617:${OWNER}:bao-core`,
      dataPlaneFetchAllowed: false,
      raw: NADDR,
    });
    // Nostr-native refs carry no https url — relay is authoritative for state.
    expect(ref).not.toHaveProperty('url');
  });

  it('parses nostr:// with an opaque, slash-tolerant identifier', () => {
    // The identifier segment preserves its slashes (e.g. an ngit repo id);
    // a single trailing slash is dropped so `.../foo/` == `.../foo`.
    const ref = parseRepoRef(`nostr://${NPUB}/github/alice/repo/`);
    expect(ref).toMatchObject({
      host: 'ngit',
      identifier: 'github/alice/repo',
      authorHex: OWNER,
      coordinate: `30617:${OWNER}:github/alice/repo`,
      dataPlaneFetchAllowed: false,
      raw: `nostr://${NPUB}/github/alice/repo/`,
    });
    expect(ref).not.toHaveProperty('url');
  });

  it('parses percent-encoded identifiers by percent-decoding', () => {
    const ref = parseRepoRef(`nostr://${NPUB}/alice%2Fmy-repo`);
    expect(ref).toMatchObject({
      host: 'ngit',
      identifier: 'alice/my-repo',
      coordinate: `30617:${OWNER}:alice/my-repo`,
      dataPlaneFetchAllowed: false,
    });
  });

  it('parses GitHub owner/repo as a data-plane-only host ref', () => {
    const ref = parseRepoRef('https://github.com/alice/my-repo');
    expect(ref).toMatchObject({
      host: 'github',
      identifier: 'alice/my-repo',
      dataPlaneFetchAllowed: true,
      url: 'https://github.com/alice/my-repo',
      raw: 'https://github.com/alice/my-repo',
    });
    // Host refs never carry a coordinate — the relay asserts state, not the URL.
    expect(ref).not.toHaveProperty('coordinate');
    expect(ref).not.toHaveProperty('authorHex');
  });

  it('parses GitLab the same way, flagging data-plane fetch', () => {
    const ref = parseRepoRef('https://gitlab.com/team/app');
    expect(ref).toMatchObject({
      host: 'gitlab',
      identifier: 'team/app',
      dataPlaneFetchAllowed: true,
      url: 'https://gitlab.com/team/app',
    });
    expect(ref).not.toHaveProperty('coordinate');
  });

  it('rejects NIP-05 authors (no offline proof of authorship)', () => {
    // Fail-closed: resolvable-by-DNS author names carry no signed proof of authorship.
    expect(parseRepoRef('nostr://alice.example/id')).toBeUndefined();
  });

  it('rejects non-30617 naddr kinds', () => {
    const bad = nip19.naddrEncode({ kind: 30023, pubkey: OWNER, identifier: 'article' });
    expect(parseRepoRef(bad)).toBeUndefined();
  });

  it('rejects malformed inputs (fail-closed)', () => {
    expect(parseRepoRef('')).toBeUndefined();
    expect(parseRepoRef('   ')).toBeUndefined();
    expect(parseRepoRef(undefined)).toBeUndefined();
    expect(parseRepoRef(null)).toBeUndefined();
    expect(parseRepoRef({ not: 'a string' })).toBeUndefined();
    expect(parseRepoRef('not-a-url-or-naddr')).toBeUndefined();
  });

  it('rejects unsupported hosts', () => {
    expect(parseRepoRef('https://bitbucket.org/alice/repo')).toBeUndefined();
    expect(parseRepoRef('https://codeberg.org/alice/repo')).toBeUndefined();
  });

  it('rejects inputs over the 2048-byte cap', () => {
    const huge = 'naddr1' + 'q'.repeat(3000);
    expect(parseRepoRef(huge)).toBeUndefined();
  });

  it('rejects bad hex pubkeys in nostr:// author segment', () => {
    expect(parseRepoRef('nostr://self/too-short/id')).toBeUndefined();
    expect(parseRepoRef('nostr://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/id')).toBeUndefined();
  });

  it('re-derives a stable naddr from a parsed naddr ref', () => {
    const ref = parseRepoRef(NADDR)!;
    expect(parseRepoRef(ref.raw)).toEqual(ref);
  });
});
