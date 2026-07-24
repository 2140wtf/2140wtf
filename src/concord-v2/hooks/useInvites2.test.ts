/**
 * `fetchInviteList` (CORD-05 §4): the Invite List read MERGES every copy the
 * pool returns instead of trusting a single newest event. The spec's merge law
 * — entries immutable, tombstones union, a tombstone beats an entry
 * TERMINALLY — is what makes this safe against a stale device: a relay whose
 * "newest" copy predates another device's revocation must never let the
 * revoked link resurface (it would get refreshed with fresh keys after a
 * Refounding otherwise).
 */

import { getConversationKey } from "nostr-tools/nip44";
import { encrypt as nip44Encrypt } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { fetchInviteList } from "@/concord-v2/hooks/useInvites2";
import type { InviteList } from "@/concord-v2/lib/invite";
import { KIND_INVITE_LIST } from "@/concord-v2/lib/kinds";

import type { NUser } from "@nostrify/react/login";

function fakeUser(sk = generateSecretKey()) {
  const pubkey = getPublicKey(sk);
  const conv = (pk: string) => getConversationKey(sk, pk);
  return {
    sk,
    user: {
      pubkey,
      signer: {
        signEvent: async () => {
          throw new Error("unused");
        },
        nip44: {
          encrypt: async (pk: string, pt: string) => nip44Encrypt(pt, conv(pk)),
          decrypt: async (pk: string, ct: string) => {
            const { decrypt } = await import("nostr-tools/nip44");
            return decrypt(ct, conv(pk));
          },
        },
      },
    } as unknown as NUser,
  };
}

/** A kind-13303 replaceable copy, NIP-44-encrypted to self, at `createdAt`. */
function listCopy(sk: Uint8Array, list: InviteList, createdAt: number): NostrEvent {
  const pubkey = getPublicKey(sk);
  const content = nip44Encrypt(JSON.stringify(list), getConversationKey(sk, pubkey));
  return finalizeEvent({ kind: KIND_INVITE_LIST, content, tags: [], created_at: createdAt }, sk);
}

const entry = (token: string, communityId: string) => ({
  token,
  signer_sk: "aa".repeat(32),
  community_id: communityId,
  url: "https://example.com/invite/naddr1xyz#frag",
  created_at: 1000,
});

function poolReturning(events: NostrEvent[]) {
  return { query: async () => events } as unknown as Parameters<typeof fetchInviteList>[0];
}

describe("fetchInviteList (CORD-05 §4 merge on read)", () => {
  const cid = "cd".repeat(32);

  it("merges every returned copy: a tombstone in an OLDER copy still kills the entry a NEWER copy carries live", async () => {
    const { sk, user } = fakeUser();
    // Device 1 revoked link B at t=1000. Device 2, offline since before the
    // revocation, wrote its own copy at t=2000 with B still live. Newest-only
    // reading would resurrect B; the merge must not.
    const older = listCopy(
      sk,
      { entries: [entry("0a".repeat(16), cid)], tombstones: [{ token: "0b".repeat(16), community_id: cid }] },
      1000,
    );
    const newer = listCopy(
      sk,
      { entries: [entry("0a".repeat(16), cid), entry("0b".repeat(16), cid)], tombstones: [] },
      2000,
    );

    const { list, newestCreatedAt } = await fetchInviteList(poolReturning([newer, older]), user);

    expect(list.entries.map((e) => e.token)).toEqual(["0a".repeat(16)]); // B is gone, terminally
    expect(list.tombstones.map((t) => t.token)).toEqual(["0b".repeat(16)]); // and stays tombstoned
    expect(newestCreatedAt).toBe(2000); // replaceable-write monotonicity anchor
  });

  it("unions entries across copies (two devices' mints both survive)", async () => {
    const { sk, user } = fakeUser();
    const device1 = listCopy(sk, { entries: [entry("0a".repeat(16), cid)], tombstones: [] }, 1000);
    const device2 = listCopy(sk, { entries: [entry("0b".repeat(16), cid)], tombstones: [] }, 1001);

    const { list } = await fetchInviteList(poolReturning([device1, device2]), user);
    expect(list.entries.map((e) => e.token).sort()).toEqual(["0a".repeat(16), "0b".repeat(16)]);
  });

  it("an undecryptable copy is skipped for content but still anchors write monotonicity", async () => {
    const { sk, user } = fakeUser();
    const good = listCopy(sk, { entries: [entry("0a".repeat(16), cid)], tombstones: [] }, 1000);
    const garbage = { ...listCopy(sk, { entries: [], tombstones: [] }, 2000), content: "not-nip44" };

    const { list, newestCreatedAt } = await fetchInviteList(poolReturning([garbage, good]), user);
    expect(list.entries.map((e) => e.token)).toEqual(["0a".repeat(16)]);
    // A relay keeps only the newest replaceable per author — a rewrite must
    // outbid the garbage copy sitting there, or it would be shadowed forever.
    expect(newestCreatedAt).toBe(2000);
  });
});
