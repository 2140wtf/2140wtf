import { describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import type { NostrEvent } from 'nostr-tools/pure';
import { encrypt as nip44Encrypt } from 'nostr-tools/nip44';

import { defaultCreateRelays, resolveBundle } from './useCommunityActions2';
import { mintCommunity } from '@/concord-v2/lib/community';
import { bytesToHex, inviteBundleKey, random32 } from '@/concord-v2/lib/derive';
import { mintLinkSigner, mintToken, type InviteBundle } from '@/concord-v2/lib/invite';
import { KIND_INVITE_BUNDLE, VSK_INVITE_LIVE, VSK_INVITE_REVOKED } from '@/concord-v2/lib/kinds';
import { MAX_COMMUNITY_RELAYS } from '@/concord-v2/lib/types';

describe('defaultCreateRelays', () => {
  it('uses the stock interop floor only when no private or configured relay exists', () => {
    const relays = defaultCreateRelays([], []);
    expect(relays.length).toBeGreaterThan(0);
    expect(relays.length).toBeLessThanOrEqual(MAX_COMMUNITY_RELAYS);
  });

  it('uses only configured app relays when no DM relay is available', () => {
    const relays = defaultCreateRelays(['wss://my.relay/'], []);
    expect(relays).toEqual(['wss://my.relay']);
  });

  it('prefers only DM relays and stays within the community relay cap', () => {
    const relays = defaultCreateRelays(['wss://my.relay/'], ['wss://my-inbox.relay/']);
    expect(relays).toEqual(['wss://my-inbox.relay']);
  });
});

// ── resolveBundle: revocation tie-break at the bundle coordinate ─────────────

describe('resolveBundle revocation tie-break', () => {
  const RELAY = 'wss://relay.test';

  interface Filter {
    kinds?: number[];
    authors?: string[];
    '#d'?: string[];
    limit?: number;
  }

  /** A relay that answers a limited query with the FIRST-matching events it
   * stored — the "stale edition satisfies limit:1" behavior the fix defends
   * against. Insertion order stands in for an arbitrary store order. */
  class FakeRelay {
    events: NostrEvent[] = [];
    async query(filters: Filter[]): Promise<NostrEvent[]> {
      const f = filters[0];
      const out = this.events.filter(
        (ev) =>
          (!f.kinds || f.kinds.includes(ev.kind)) &&
          (!f.authors || f.authors.includes(ev.pubkey)) &&
          (!f['#d'] || f['#d'].includes(ev.tags.find((t) => t[0] === 'd')?.[1] ?? '')),
      );
      return f.limit !== undefined ? out.slice(0, f.limit) : out;
    }
  }

  function setup() {
    const owner = bytesToHex(random32());
    const { community } = mintCommunity('Fleet', owner, [RELAY]);
    const link = mintLinkSigner();
    const token = mintToken();
    const bundle: InviteBundle = {
      community_id: community.idHex,
      owner: community.owner,
      owner_salt: bytesToHex(community.ownerSalt),
      community_root: bytesToHex(random32()),
      root_epoch: 0,
      channels: [],
      relays: [RELAY],
      name: 'Fleet',
      creator_npub: owner,
    };
    // Valid signatures at FIXED timestamps — a same-second revoke/refresh tie
    // is real (second-granularity clocks), so the test must not rely on
    // Date.now() landing in one second.
    const liveAt = 1_800_000_000;
    const live = finalizeEvent(
      {
        kind: KIND_INVITE_BUNDLE,
        content: nip44Encrypt(JSON.stringify(bundle), inviteBundleKey(token)),
        tags: [
          ['d', ''],
          ['vsk', VSK_INVITE_LIVE],
        ],
        created_at: liveAt,
      },
      link.sk,
    );
    const tombstone = (created_at: number) =>
      finalizeEvent(
        { kind: KIND_INVITE_BUNDLE, content: '', tags: [['d', ''], ['vsk', VSK_INVITE_REVOKED]], created_at },
        link.sk,
      );
    const relay = new FakeRelay();
    const nostr = { relay: () => relay } as never;
    const invite = { linkSigner: link.pk, token, bootstrapRelays: [RELAY], naddr: '' };
    return { relay, live, tombstone, nostr, invite, bundle };
  }

  it('a revocation tombstone wins a created_at TIE with the live bundle', async () => {
    const { relay, live, tombstone, nostr, invite } = setup();
    // The stale LIVE edition is stored first: a limit:1 query would be
    // satisfied by it and the revocation would never be seen.
    relay.events = [live, tombstone(live.created_at)];
    await expect(resolveBundle(nostr, invite, [])).rejects.toThrow(/revoked/);
  });

  it('a STRICTLY newer live bundle (re-mint) overrides an older tombstone', async () => {
    const { relay, live, tombstone, nostr, invite, bundle } = setup();
    relay.events = [tombstone(live.created_at - 1), live];
    const resolved = await resolveBundle(nostr, invite, []);
    expect(resolved.community_id).toBe(bundle.community_id);
  });
});
