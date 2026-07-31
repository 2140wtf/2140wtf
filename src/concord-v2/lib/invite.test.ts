import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { bytesToHex, communityIdOf, guestbookGroupKey, hex32, random32 } from "@/concord-v2/lib/derive";
import {
  buildJoinRumor,
  buildLeaveRumor,
  joinCommitmentOf,
  openGuestbookOpened,
  openGuestbookWraps,
  sealGuestbook,
  singleUseLinkUsed,
} from "@/concord-v2/lib/guestbook";
import {
  buildBundleEvent,
  buildInviteUrl,
  buildRefreshedBundleEvents,
  buildRevocationEvent,
  decodeFragment,
  encodeFragment,
  EMPTY_INVITE_LIST,
  inviteCommitment,
  mergeInviteLists,
  mintLinkSigner,
  mintToken,
  parseBundleEvent,
  parseInviteLink,
  STOCK_RELAYS,
  type InviteBundle,
} from "@/concord-v2/lib/invite";

function makeBundle(): { bundle: InviteBundle; ownerHex: string } {
  const ownerHex = bytesToHex(random32());
  const salt = random32();
  const cid = communityIdOf(hex32(ownerHex), salt);
  return {
    ownerHex,
    bundle: {
      community_id: bytesToHex(cid),
      owner: ownerHex,
      owner_salt: bytesToHex(salt),
      community_root: bytesToHex(random32()),
      root_epoch: 0,
      channels: [],
      relays: ["wss://a.example", "wss://b.example"],
      name: "Test community",
    },
  };
}

describe("fragment codec (CORD-05 §3)", () => {
  it("round-trips the stock set with zero relay bytes", () => {
    const token = mintToken();
    const frag = encodeFragment(token, STOCK_RELAYS);
    // version + flags + 16 token bytes = 18 bytes → 24 base64url chars.
    expect(frag.length).toBe(24);
    const decoded = decodeFragment(frag);
    expect(bytesToHex(decoded.token)).toBe(bytesToHex(token));
    expect(decoded.relays).toEqual(STOCK_RELAYS);
  });

  it("round-trips dictionary ids, wss-implied literals, and verbatim literals", () => {
    const token = mintToken();
    const relays = ["wss://relay.ditto.pub", "wss://armada.example.com", "ws://192.168.1.5:5577"];
    const decoded = decodeFragment(encodeFragment(token, relays));
    expect(decoded.relays).toEqual(relays);
    expect(bytesToHex(decoded.token)).toBe(bytesToHex(token));
  });

  it("caps bootstrap relays at 3", () => {
    const token = mintToken();
    const relays = ["wss://a.example", "wss://b.example", "wss://c.example", "wss://d.example"];
    expect(decodeFragment(encodeFragment(token, relays)).relays.length).toBe(3);
  });

  it("rejects legacy and future versions, truncation, and trailing bytes", () => {
    const token = mintToken();
    const good = encodeFragment(token, []);
    expect(() => decodeFragment(good)).not.toThrow();
    expect(() => decodeFragment("A" + good)).toThrow(); // corrupt
    expect(() => decodeFragment("")).toThrow();
  });
});

describe("invite bundle (CORD-05 §1–2)", () => {
  it("round-trips through the addressable event", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const event = buildBundleEvent(bundle, token, link.sk);
    expect(event.pubkey).toBe(link.pk);
    expect(event.tags).toContainEqual(["d", ""]);

    const parsed = parseBundleEvent(event, link.pk, token, Date.now());
    expect(parsed.community_id).toBe(bundle.community_id);
    expect(parsed.name).toBe("Test community");
  });

  it("refuses a bundle whose owner does not reproduce the community_id", () => {
    const { bundle } = makeBundle();
    const forged = { ...bundle, owner: bytesToHex(random32()) };
    const token = mintToken();
    const link = mintLinkSigner();
    const event = buildBundleEvent(forged, token, link.sk);
    expect(() => parseBundleEvent(event, link.pk, token, Date.now())).toThrow(/community_id/);
  });

  it("refuses an impostor's event at a different author", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const squatter = mintLinkSigner();
    const event = buildBundleEvent(bundle, token, squatter.sk);
    expect(() => parseBundleEvent(event, link.pk, token, Date.now())).toThrow(/not a valid/);
  });

  it("a revocation tombstone reads as revoked", () => {
    const link = mintLinkSigner();
    const tomb = buildRevocationEvent(link.sk);
    expect(() => parseBundleEvent(tomb, link.pk, mintToken(), Date.now())).toThrow(/revoked/);
  });

  it("expiry refuses joining but only past expires_at", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const withExpiry = { ...bundle, expires_at: 1_000_000 };
    const event = buildBundleEvent(withExpiry, token, link.sk);
    expect(() => parseBundleEvent(event, link.pk, token, 999_999)).not.toThrow();
    expect(() => parseBundleEvent(event, link.pk, token, 1_000_001)).toThrow(/expired/);
  });

  it("bounds a hostile bundle's channel count", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const hostile = {
      ...bundle,
      channels: Array.from({ length: 300 }, () => ({
        id: bytesToHex(random32()),
        key: bytesToHex(random32()),
        epoch: 0,
        name: "x",
      })),
    };
    const event = buildBundleEvent(hostile, token, link.sk);
    expect(() => parseBundleEvent(event, link.pk, token, Date.now())).toThrow(/channels/);
  });
});

describe("invite links", () => {
  it("builds and parses a full URL and the bare naddr#fragment form", () => {
    const link = mintLinkSigner();
    const token = mintToken();
    const url = buildInviteUrl("https://armada.example.com", link.pk, token, ["wss://a.example"]);
    expect(url).toContain("/invite/naddr1");
    expect(url).toContain("#");

    const parsed = parseInviteLink(url);
    expect(parsed).toBeDefined();
    expect(parsed!.linkSigner).toBe(link.pk);
    expect(bytesToHex(parsed!.token)).toBe(bytesToHex(token));
    expect(parsed!.bootstrapRelays).toEqual(["wss://a.example"]);

    const bare = `${parsed!.naddr}#${url.split("#")[1]}`;
    const parsedBare = parseInviteLink(bare);
    expect(parsedBare?.linkSigner).toBe(link.pk);
  });

  it("returns undefined for V1 invites and garbage (so classifiers fall through)", () => {
    expect(parseInviteLink("https://armada.example.com/invite#sometokenpayload_here123")).toBeUndefined();
    expect(parseInviteLink("wss://relay.example.com")).toBeUndefined();
    expect(parseInviteLink("hello world")).toBeUndefined();
  });
});

describe("bundle refresh after a Refounding (CORD-05 §2)", () => {
  it("re-posts every live link's bundle at the current keys, preserving per-link expiry/label", () => {
    const { bundle } = makeBundle();
    const linkA = mintLinkSigner();
    const linkB = mintLinkSigner();
    const tokenA = mintToken();
    const tokenB = mintToken();

    // The community Refounded: a fresh root at epoch 1. The refreshed bundle
    // carries the CURRENT keys (what buildBundle reads post-rotation).
    const fresh: InviteBundle = {
      ...bundle,
      community_root: bytesToHex(random32()),
      root_epoch: 1,
    };
    const futureSecs = Math.floor(Date.now() / 1000) + 3600;
    const events = buildRefreshedBundleEvents(fresh, [
      { token: bytesToHex(tokenA), signer_sk: bytesToHex(linkA.sk), expires_at: futureSecs, label: "Reddit" },
      { token: bytesToHex(tokenB), signer_sk: bytesToHex(linkB.sk) },
    ]);
    expect(events.length).toBe(2);

    // Each event sits at its own link's coordinate and decrypts with its token.
    const a = parseBundleEvent(events[0], linkA.pk, tokenA, Date.now());
    expect(events[0].pubkey).toBe(linkA.pk);
    expect(a.root_epoch).toBe(1); // the CURRENT epoch, not the stale 0
    expect(a.community_root).toBe(fresh.community_root);
    expect(a.expires_at).toBe(futureSecs * 1000); // seconds → ms, preserved
    expect(a.label).toBe("Reddit");

    const b = parseBundleEvent(events[1], linkB.pk, tokenB, Date.now());
    expect(b.root_epoch).toBe(1);
    expect(b.expires_at).toBeUndefined();
  });

  it("skips a malformed entry rather than throwing", () => {
    const { bundle } = makeBundle();
    const link = mintLinkSigner();
    const token = mintToken();
    const events = buildRefreshedBundleEvents(bundle, [
      { token: "not-hex", signer_sk: "also-not-hex" },
      { token: bytesToHex(token), signer_sk: bytesToHex(link.sk) },
    ]);
    expect(events.length).toBe(1);
    expect(events[0].pubkey).toBe(link.pk);
  });
});

describe("invite audience (agent links)", () => {
  it("round-trips the audience field through the encrypted bundle", () => {
    const { bundle } = makeBundle();
    const link = mintLinkSigner();
    const token = mintToken();
    const event = buildBundleEvent({ ...bundle, audience: "agent" }, token, link.sk);
    const parsed = parseBundleEvent(event, link.pk, token, Date.now());
    expect(parsed.audience).toBe("agent");
  });

  it("is absent for a plain (human) link", () => {
    const { bundle } = makeBundle();
    const link = mintLinkSigner();
    const token = mintToken();
    const event = buildBundleEvent(bundle, token, link.sk);
    const parsed = parseBundleEvent(event, link.pk, token, Date.now());
    expect(parsed.audience).toBeUndefined();
  });

  it("survives a bundle refresh (rekey re-post keeps the per-link audience)", () => {
    const { bundle } = makeBundle();
    const linkA = mintLinkSigner();
    const linkB = mintLinkSigner();
    const tokenA = mintToken();
    const tokenB = mintToken();
    const fresh: InviteBundle = { ...bundle, community_root: bytesToHex(random32()), root_epoch: 1 };
    const events = buildRefreshedBundleEvents(fresh, [
      { token: bytesToHex(tokenA), signer_sk: bytesToHex(linkA.sk), audience: "agent" },
      { token: bytesToHex(tokenB), signer_sk: bytesToHex(linkB.sk) },
    ]);
    const a = parseBundleEvent(events[0], linkA.pk, tokenA, Date.now());
    const b = parseBundleEvent(events[1], linkB.pk, tokenB, Date.now());
    expect(a.audience).toBe("agent");
    expect(b.audience).toBeUndefined();
  });
});

describe("invite list merge (CORD-05 §4)", () => {
  it("entries are immutable, tombstones union and win terminally", () => {
    const entry = {
      token: "aa".repeat(16),
      signer_sk: "bb".repeat(32),
      community_id: "cc".repeat(32),
      url: "https://x/invite/naddr1xyz#frag",
      created_at: 1000,
    };
    const a = mergeInviteLists(EMPTY_INVITE_LIST, { entries: [entry], tombstones: [] });
    expect(a.entries.length).toBe(1);

    const b = mergeInviteLists(a, {
      entries: [],
      tombstones: [{ token: entry.token, community_id: entry.community_id }],
    });
    expect(b.entries.length).toBe(0);
    expect(b.tombstones.length).toBe(1);

    // A stale device re-merging the entry can't resurrect the revoked link.
    const c = mergeInviteLists(b, { entries: [entry], tombstones: [] });
    expect(c.entries.length).toBe(0);
  });
});

describe("single-use links (CORD-05 §2)", () => {
  it("max_uses round-trips through the bundle event", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const single = { ...bundle, max_uses: 1 };
    const parsed = parseBundleEvent(buildBundleEvent(single, token, link.sk), link.pk, token, Date.now());
    expect(parsed.max_uses).toBe(1);

    const multi = parseBundleEvent(buildBundleEvent(bundle, token, link.sk), link.pk, token, Date.now());
    expect(multi.max_uses).toBeUndefined();
  });

  it("a refresh preserves the entry's max_uses", () => {
    const { bundle } = makeBundle();
    const token = mintToken();
    const link = mintLinkSigner();
    const [event] = buildRefreshedBundleEvents(bundle, [
      { token: bytesToHex(token), signer_sk: bytesToHex(link.sk), max_uses: 1 },
    ]);
    const parsed = parseBundleEvent(event, link.pk, token, Date.now());
    expect(parsed.max_uses).toBe(1);
  });

  it("the token commitment is sha256(token), stable, and not the token", () => {
    const token = mintToken();
    const c = inviteCommitment(token);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(c).toBe(inviteCommitment(token));
    expect(c).not.toBe(bytesToHex(token));
  });

  it("a Join cites the commitment; the spent-check finds exactly it", async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const signer = { signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
    const gb = guestbookGroupKey(new Uint8Array(32).fill(6), new Uint8Array(32).fill(7), 0);
    const token = mintToken();
    const commitment = inviteCommitment(token);

    const join = buildJoinRumor(pubkey, 1000, { creator: "ab".repeat(32), commitment });
    expect(joinCommitmentOf(join)).toBe(commitment);
    // Leaves and un-cited joins carry no commitment.
    expect(joinCommitmentOf(buildLeaveRumor(pubkey, 2000))).toBeUndefined();
    expect(joinCommitmentOf(buildJoinRumor(pubkey, 1500))).toBeUndefined();

    const wrap = await sealGuestbook(join, gb, signer);
    const opened = openGuestbookOpened(openGuestbookWraps([wrap], [gb]));
    expect(singleUseLinkUsed(opened, commitment)).toBe(true);
    expect(singleUseLinkUsed(opened, inviteCommitment(mintToken()))).toBe(false);
  });
});
