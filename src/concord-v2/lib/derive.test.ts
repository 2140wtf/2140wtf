import { describe, expect, it } from "vitest";

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { schnorr } from "@noble/curves/secp256k1.js";

import {
  banlistLocator,
  baseRekeyGroupKey,
  bytesToHex,
  channelGroupKey,
  channelRekeyGroupKey,
  communityIdOf,
  controlGroupKey,
  dissolvedGroupKey,
  epochKeyCommitment,
  grantLocator,
  guestbookGroupKey,
  hex32,
  inviteBundleKey,
  inviteLinksLocator,
  recipientLocator,
  verifyCommunityId,
  voiceGroupKey,
  voiceMediaKey,
  voiceSenderKey,
} from "@/concord-v2/lib/derive";

const A = new Uint8Array(32).fill(1);
const B = new Uint8Array(32).fill(2);
const C = new Uint8Array(32).fill(3);

describe("group_key derivations (CORD-02 A)", () => {
  it("derives deterministic, distinct addresses per label", () => {
    const chan = channelGroupKey(A, B, 0);
    const ctrl = controlGroupKey(A, B, 0);
    const gb = guestbookGroupKey(A, B, 0);
    expect(channelGroupKey(A, B, 0).pk).toBe(chan.pk);
    const pks = new Set([chan.pk, ctrl.pk, gb.pk]);
    expect(pks.size).toBe(3);
  });

  it("rotates the address with the epoch (unlinkable planes)", () => {
    expect(channelGroupKey(A, B, 0).pk).not.toBe(channelGroupKey(A, B, 1).pk);
    expect(controlGroupKey(A, B, 0).pk).not.toBe(controlGroupKey(A, B, 1).pk);
  });

  it("separates by id: two channels under one secret never share an address", () => {
    expect(channelGroupKey(A, B, 0).pk).not.toBe(channelGroupKey(A, C, 0).pk);
  });

  it("the dissolved address is epoch-free and key-free (community_id alone)", () => {
    const d1 = dissolvedGroupKey(A);
    const d2 = dissolvedGroupKey(A);
    expect(d1.pk).toBe(d2.pk);
    expect(dissolvedGroupKey(B).pk).not.toBe(d1.pk);
  });

  it("rekey addresses derive from the PRIOR secret at the NEW epoch", () => {
    const r1 = channelRekeyGroupKey(A, B, 1);
    const r2 = baseRekeyGroupKey(A, B, 1);
    expect(r1.pk).not.toBe(r2.pk);
    expect(channelRekeyGroupKey(A, B, 2).pk).not.toBe(r1.pk);
  });
});

describe("coordinates", () => {
  it("grant/banlist/invite-links locators are 32 bytes, distinct, deterministic", () => {
    const g = grantLocator(A, B);
    expect(g.length).toBe(32);
    expect(bytesToHex(grantLocator(A, B))).toBe(bytesToHex(g));
    expect(bytesToHex(grantLocator(A, C))).not.toBe(bytesToHex(g));
    expect(bytesToHex(banlistLocator(A))).not.toBe(bytesToHex(g));
    expect(bytesToHex(inviteLinksLocator(A, B))).not.toBe(bytesToHex(g));
  });

  it("recipient locators bind rotator, recipient, scope, and epoch", () => {
    const base = bytesToHex(recipientLocator(A, B, C, 1));
    expect(bytesToHex(recipientLocator(A, B, C, 1))).toBe(base);
    expect(bytesToHex(recipientLocator(B, A, C, 1))).not.toBe(base); // direction matters
    expect(bytesToHex(recipientLocator(A, B, C, 2))).not.toBe(base);
    expect(bytesToHex(recipientLocator(A, B, A, 1))).not.toBe(base);
  });

  it("invite bundle key derives from the token alone", () => {
    const token = new Uint8Array(16).fill(7);
    expect(bytesToHex(inviteBundleKey(token))).toBe(bytesToHex(inviteBundleKey(token)));
    expect(bytesToHex(inviteBundleKey(new Uint8Array(16).fill(8)))).not.toBe(bytesToHex(inviteBundleKey(token)));
  });
});

describe("voice sub-keys (CORD-07 §1/§3)", () => {
  it("room and media keys are deterministic, distinct, and epoch-rolling", () => {
    const room = voiceGroupKey(A, B, 0);
    expect(voiceGroupKey(A, B, 0).pk).toBe(room.pk);
    // The room keypair is NOT the channel's stream key nor the media key.
    expect(room.pk).not.toBe(channelGroupKey(A, B, 0).pk);
    expect(bytesToHex(voiceMediaKey(A, B, 0))).not.toBe(bytesToHex(room.sk));
    // A rekey (epoch bump) rolls both — the same rotation that severs chat.
    expect(voiceGroupKey(A, B, 1).pk).not.toBe(room.pk);
    expect(bytesToHex(voiceMediaKey(A, B, 1))).not.toBe(bytesToHex(voiceMediaKey(A, B, 0)));
    // Channel-id separation: two channels never share a room.
    expect(voiceGroupKey(A, C, 0).pk).not.toBe(room.pk);
  });

  it("matches an independent construction of the frozen A.1 layout", () => {
    // Reimplement `hkdf(secret, label, id, epoch)` from scratch (CORD-02 A.1):
    // info = utf8(label) || 0x00 || id[32] || epoch_be[8]?
    const info = (label: string, id: Uint8Array, epoch?: bigint) => {
      const l = new TextEncoder().encode(label);
      const out = new Uint8Array(l.length + 1 + 32 + (epoch !== undefined ? 8 : 0));
      out.set(l, 0);
      out.set(id, l.length + 1);
      if (epoch !== undefined) new DataView(out.buffer).setBigUint64(l.length + 33, epoch, false);
      return out;
    };
    const media = hkdf(sha256, A, new Uint8Array(0), info("concord/voice-media", B, 0n), 32);
    expect(bytesToHex(voiceMediaKey(A, B, 0))).toBe(bytesToHex(media));

    const seed = hkdf(sha256, A, new Uint8Array(0), info("concord/voice-signer", B, 0n), 32);
    // The seed is a valid scalar with overwhelming probability, so sk == seed.
    expect(voiceGroupKey(A, B, 0).pk).toBe(bytesToHex(schnorr.getPublicKey(seed)));

    const identity = "00112233445566778899aabbccddeeff";
    const sender = hkdf(
      sha256,
      media,
      new Uint8Array(0),
      info("concord/voice-sender", sha256(new TextEncoder().encode(identity))),
      32,
    );
    expect(bytesToHex(voiceSenderKey(media, identity))).toBe(bytesToHex(sender));
  });

  it("sender keys partition per identity and never equal the media root", () => {
    const media = voiceMediaKey(A, B, 0);
    const k1 = voiceSenderKey(media, "alice-identity");
    expect(bytesToHex(voiceSenderKey(media, "alice-identity"))).toBe(bytesToHex(k1));
    expect(bytesToHex(voiceSenderKey(media, "bob-identity"))).not.toBe(bytesToHex(k1));
    expect(bytesToHex(k1)).not.toBe(bytesToHex(media));
  });
});

describe("community_id (A.4)", () => {
  it("commits to the owner and salt", () => {
    const id = communityIdOf(A, B);
    expect(id.length).toBe(32);
    expect(verifyCommunityId(bytesToHex(id), bytesToHex(A), bytesToHex(B))).toBe(true);
    expect(verifyCommunityId(bytesToHex(id), bytesToHex(C), bytesToHex(B))).toBe(false);
    expect(verifyCommunityId(bytesToHex(id), bytesToHex(A), bytesToHex(C))).toBe(false);
  });
});

describe("epoch-key commitment (A.5)", () => {
  it("is deterministic and binds epoch + key", () => {
    const c = epochKeyCommitment(2n, A);
    expect(bytesToHex(epochKeyCommitment(2n, A))).toBe(bytesToHex(c));
    expect(bytesToHex(epochKeyCommitment(3n, A))).not.toBe(bytesToHex(c));
    expect(bytesToHex(epochKeyCommitment(2n, B))).not.toBe(bytesToHex(c));
  });
});

describe("hex32", () => {
  it("round-trips and rejects malformed", () => {
    expect(bytesToHex(hex32(bytesToHex(A)))).toBe(bytesToHex(A));
    expect(() => hex32("abc")).toThrow();
    expect(() => hex32("zz".repeat(32))).toThrow();
  });
});
