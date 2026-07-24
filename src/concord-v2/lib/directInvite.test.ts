import { IDBFactory } from "fake-indexeddb";
import { getConversationKey, decrypt as nip44Decrypt, encrypt as nip44Encrypt } from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import { bytesToHex, communityIdOf, hex32, random32 } from "@/concord-v2/lib/derive";
import {
  buildDirectInviteRumor,
  directInviteExpired,
  parseDirectInviteRumor,
  sealDirectInvite,
  unwrapDirectInvite,
  wrapDirectInvite,
  type DirectInviteSigner,
} from "@/concord-v2/lib/directInvite";
import {
  advanceInviteInboxCursor,
  inviteInboxSince,
  queryStoredInvites,
  storedToInvite,
  unwrappedToStored,
  writeStoredInvites,
  WRAP_BACKDATE_SECS,
} from "@/concord-v2/lib/inviteInbox";
import { KIND_DIRECT_INVITE, KIND_WRAP } from "@/concord-v2/lib/kinds";
import type { InviteBundle } from "@/concord-v2/lib/invite";

// A clean IndexedDB for the suite (the store singleton opens against it lazily).
(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

/** A raw-key signer exposing the abstract surface a direct invite needs. */
function rawSigner(sk: Uint8Array): DirectInviteSigner {
  return {
    signEvent: async (template: EventTemplate) => finalizeEvent(template, sk),
    nip44: {
      encrypt: async (pubkey: string, plaintext: string) =>
        nip44Encrypt(plaintext, getConversationKey(sk, pubkey)),
      decrypt: async (pubkey: string, ciphertext: string) =>
        nip44Decrypt(ciphertext, getConversationKey(sk, pubkey)),
    },
  };
}

function makeBundle(overrides?: Partial<InviteBundle>): InviteBundle {
  const ownerHex = bytesToHex(random32());
  const salt = random32();
  return {
    community_id: bytesToHex(communityIdOf(hex32(ownerHex), salt)),
    owner: ownerHex,
    owner_salt: bytesToHex(salt),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://a.example"],
    name: "Test community",
    ...overrides,
  };
}

async function eventually<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > ms) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("direct invites (CORD-05 §6)", () => {
  it("round-trips build → seal → wrap → unwrap → parse", async () => {
    const inviterSk = generateSecretKey();
    const inviterPk = getPublicKey(inviterSk);
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const bundle = makeBundle();
    const rumor = buildDirectInviteRumor(bundle, inviterPk);
    const seal = await sealDirectInvite(rumor, recipientPk, rawSigner(inviterSk));
    expect(seal.kind).toBe(13);
    expect(seal.pubkey).toBe(inviterPk);

    const wrap = wrapDirectInvite(seal, recipientPk);
    expect(wrap.kind).toBe(KIND_WRAP);
    // Classic NIP-59: ephemeral author, fixed recipient — plus the k index hint.
    expect(wrap.pubkey).not.toBe(inviterPk);
    expect(wrap.tags).toContainEqual(["p", recipientPk]);
    expect(wrap.tags).toContainEqual(["k", String(KIND_DIRECT_INVITE)]);
    // NIP-59 backdating: never in the future.
    expect(wrap.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

    const unwrapped = await unwrapDirectInvite(wrap, rawSigner(recipientSk));
    expect(unwrapped).toBeDefined();
    expect(unwrapped!.sender).toBe(inviterPk);

    const parsed = parseDirectInviteRumor(unwrapped!.rumor.kind, unwrapped!.rumor.content);
    expect(parsed).toBeDefined();
    expect(parsed!.community_id).toBe(bundle.community_id);
    expect(parsed!.name).toBe("Test community");
  });

  it("stamps a NIP-40 expiration on the wrap when the bundle expires", async () => {
    const inviterSk = generateSecretKey();
    const recipientPk = getPublicKey(generateSecretKey());
    const expiresAtMs = Date.now() + 86_400_000;
    const rumor = buildDirectInviteRumor(makeBundle({ expires_at: expiresAtMs }), getPublicKey(inviterSk));
    const seal = await sealDirectInvite(rumor, recipientPk, rawSigner(inviterSk));
    const wrap = wrapDirectInvite(seal, recipientPk, { expiresAtMs });
    expect(wrap.tags).toContainEqual(["expiration", String(Math.floor(expiresAtMs / 1000))]);
  });

  it("rejects a rumor whose claimed author differs from the seal's signer", async () => {
    const inviterSk = generateSecretKey();
    const impostorPk = getPublicKey(generateSecretKey());
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    // The rumor claims someone else sent it; the seal is signed by the inviter.
    const rumor = buildDirectInviteRumor(makeBundle(), impostorPk);
    const seal = await sealDirectInvite(rumor, recipientPk, rawSigner(inviterSk));
    const wrap = wrapDirectInvite(seal, recipientPk);
    expect(await unwrapDirectInvite(wrap, rawSigner(recipientSk))).toBeUndefined();
  });

  it("refuses a bundle whose owner does not reproduce its community_id", () => {
    const forged = makeBundle({ owner: bytesToHex(random32()) });
    expect(parseDirectInviteRumor(KIND_DIRECT_INVITE, JSON.stringify(forged))).toBeUndefined();
  });

  it("gates on the rumor kind — the outer k tag was only ever a hint", () => {
    expect(parseDirectInviteRumor(9, JSON.stringify(makeBundle()))).toBeUndefined();
  });

  it("tracks expiry without refusing to parse (a parked invite still renders)", () => {
    const expired = makeBundle({ expires_at: Date.now() - 1000 });
    const parsed = parseDirectInviteRumor(KIND_DIRECT_INVITE, JSON.stringify(expired));
    expect(parsed).toBeDefined();
    expect(directInviteExpired(parsed!)).toBe(true);
    expect(directInviteExpired(makeBundle())).toBe(false);
  });
});

describe("direct-invite inbox store", () => {
  async function makeUnwrapped() {
    const inviterSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);
    const bundle = makeBundle();
    const rumor = buildDirectInviteRumor(bundle, getPublicKey(inviterSk));
    const seal = await sealDirectInvite(rumor, recipientPk, rawSigner(inviterSk));
    const wrap = wrapDirectInvite(seal, recipientPk);
    const unwrapped = (await unwrapDirectInvite(wrap, rawSigner(recipientSk)))!;
    return { wrap, unwrapped, bundle, inviterPk: getPublicKey(inviterSk) };
  }

  it("round-trips an unwrapped invite through the codec", async () => {
    const { wrap, unwrapped, inviterPk } = await makeUnwrapped();

    const stored = unwrappedToStored(wrap, unwrapped);
    expect(stored.id).toBe(wrap.id);
    expect(stored.sig).toBe("");
    expect(stored.kind).toBe(KIND_DIRECT_INVITE);
    expect(stored.pubkey).toBe(inviterPk);

    const back = storedToInvite(stored);
    expect(back.wrapId).toBe(wrap.id);
    expect(back.sender).toBe(inviterPk);
    expect(back.rumor.content).toBe(unwrapped.rumor.content);
    // Provenance tags are stripped from the reconstructed rumor.
    expect(back.rumor.tags.some((t) => t[0] === "wrap" || t[0] === "sender" || t[0] === "wrapts")).toBe(false);
  });

  it("persists and queries invites without re-decrypting", async () => {
    const { wrap, unwrapped, bundle } = await makeUnwrapped();
    writeStoredInvites([{ wrap: wrap as NostrEvent, unwrapped }]);
    const got = await eventually(() => queryStoredInvites(), (r) => r.some((i) => i.wrapId === wrap.id));
    const mine = got.find((i) => i.wrapId === wrap.id)!;
    expect(JSON.parse(mine.rumor.content).community_id).toBe(bundle.community_id);
  });

  it("cursor resumes a backdate window behind the newest wrap scanned", async () => {
    const pubkey = "cursor-test-" + getPublicKey(generateSecretKey());
    expect(await inviteInboxSince(pubkey)).toBe(0); // cold cache → full scan

    const newest = 10_000_000;
    await advanceInviteInboxCursor(pubkey, newest);
    // Direct-invite wraps DO backdate (NIP-59), so the resume floor rewinds.
    expect(await inviteInboxSince(pubkey)).toBe(newest - WRAP_BACKDATE_SECS);

    // Monotonic: an older value never regresses the cursor.
    await advanceInviteInboxCursor(pubkey, newest - 500);
    expect(await inviteInboxSince(pubkey)).toBe(newest - WRAP_BACKDATE_SECS);
  });
});
