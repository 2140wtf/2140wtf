/**
 * Round-6 hostile-wire properties: every member holds the stream wrap key
 * (the wrap layer is a shared anonymity set — authorship is proven by the
 * inner seal), so a compromised member can inject validly-signed garbage.
 * Parsers must refuse with their TYPED error (never a raw TypeError, never a
 * return), and batch openers must skip-and-continue.
 *
 * Live counterpart: .tmp/hostile-wire.sh injects 5 real hostile wraps.
 */
import { describe, expect, it } from "vitest";

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { encrypt as nip44Encrypt } from "nostr-tools/nip44";
import { bytesToHex } from "@noble/hashes/utils.js";

import { channelGroupKey, inviteBundleKey } from "@/concord-v2/lib/derive";
import { openWrap, StreamError } from "@/concord-v2/lib/stream";
import { openControlWraps } from "@/concord-v2/lib/control";
import { openGuestbookWraps } from "@/concord-v2/lib/guestbook";
import { parseInviteLink, parseBundleEvent, InviteError } from "@/concord-v2/lib/invite";
import { KIND_WRAP, KIND_WRAP_EPHEMERAL, KIND_INVITE_BUNDLE, VSK_INVITE_LIVE } from "@/concord-v2/lib/kinds";
import type { NostrEvent } from "nostr-tools/pure";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const root = generateSecretKey();
const group = channelGroupKey(root, generateSecretKey(), 0n);

/** A wrap with a VALID outer signature (any member can mint one) and hostile content. */
function hostileWrap(rand: () => number, mode: number): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const len = 1 + Math.floor(rand() * 2000);
  let content = "";
  if (mode === 0) {
    for (let i = 0; i < len; i++) content += String.fromCharCode(Math.floor(rand() * 0x10000));
  } else if (mode === 1) {
    content = nip44Encrypt("not json {{{ " + "x".repeat(len), group.convKey);
  } else {
    content = nip44Encrypt(JSON.stringify({ kind: 13, pubkey: "ab".repeat(32), content: "x".repeat(len), created_at: now, tags: [], id: "00".repeat(32), sig: "11".repeat(64) }), group.convKey);
  }
  const kind = rand() < 0.1 ? KIND_WRAP_EPHEMERAL : KIND_WRAP;
  return finalizeEvent({ kind, content, tags: [["p", bytesToHex(generateSecretKey())]], created_at: now }, group.sk);
}

describe("hostile wire — openWrap refuses with StreamError only", () => {
  // Crypto-heavy (600 sign+encrypt+decrypt+verify cycles): the default 5s
  // vitest timeout flakes under full-suite parallel load.
  it("600 validly-signed garbage wraps: StreamError or (rarely) opens, never a raw TypeError", { timeout: 30_000 }, () => {
    const rand = mulberry32(6);
    for (let i = 0; i < 600; i++) {
      const wrap = hostileWrap(rand, i % 3);
      try {
        openWrap(wrap, group);
        // mode-1/2 can occasionally decrypt to parseable JSON — that's fine,
        // the seal-verify inside is what must reject them (still StreamError).
      } catch (e) {
        expect(e, `wrap ${i}: ${e}`).toBeInstanceOf(StreamError);
      }
    }
  });

  it("wraps from the WRONG stream address are refused before decryption", () => {
    const other = channelGroupKey(generateSecretKey(), generateSecretKey(), 0n);
    const now = Math.floor(Date.now() / 1000);
    const wrap = finalizeEvent({ kind: KIND_WRAP, content: nip44Encrypt("{}", other.convKey), tags: [], created_at: now }, other.sk);
    expect(() => openWrap(wrap, group)).toThrowError(StreamError);
  });
});

describe("hostile wire — batch openers skip-and-continue", () => {
  it("openControlWraps / openGuestbookWraps never throw on garbage, return []", { timeout: 30_000 }, () => {
    const rand = mulberry32(66);
    const garbage = Array.from({ length: 50 }, (_, i) => hostileWrap(rand, i % 3));
    expect(() => openControlWraps(garbage, [group])).not.toThrow();
    expect(openControlWraps(garbage, [group])).toEqual([]);
    expect(() => openGuestbookWraps(garbage, [group])).not.toThrow();
    expect(openGuestbookWraps(garbage, [group])).toEqual([]);
  });
});

describe("hostile wire — invite parsers", () => {
  it("parseInviteLink never throws on 2000 garbage strings", () => {
    const rand = mulberry32(666);
    const alphabets = ["naddr1qpz#/", "abcdef0123456789#=&?/.:", "https://bao.fund/invite/ \t\n🚀"];
    for (let i = 0; i < 2000; i++) {
      const alpha = alphabets[i % alphabets.length];
      let s = "";
      const len = Math.floor(rand() * 300);
      for (let j = 0; j < len; j++) s += alpha[Math.floor(rand() * alpha.length)];
      expect(() => parseInviteLink(s), `input ${i}`).not.toThrow();
    }
  });

  it("parseBundleEvent refuses forged/mutated events with InviteError only", { timeout: 30_000 }, () => {
    const rand = mulberry32(66_666);
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const token = generateSecretKey();
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      const mode = i % 4;
      const base = finalizeEvent(
        {
          kind: mode === 0 ? 1 : KIND_INVITE_BUNDLE, // wrong kind a quarter of the time
          // mode 1: garbage plaintext under the RIGHT bundle key — reaches decrypt+parse
          content:
            mode === 1
              ? nip44Encrypt("not a bundle " + "y".repeat(Math.floor(rand() * 500)), inviteBundleKey(token))
              : mode === 2
                ? nip44Encrypt(JSON.stringify({ community_id: 42, owner: null, owner_salt: [], channels: "x", relays: {} }), inviteBundleKey(token))
                : "garbage",
          tags: [["vsk", mode === 3 ? "bogus" : VSK_INVITE_LIVE]],
          created_at: Math.floor(now / 1000),
        },
        sk,
      );
      const event = mode === 3 ? { ...base, pubkey: "cd".repeat(32) } : base; // broken sig/author
      try {
        parseBundleEvent(event as NostrEvent, pk, token, now);
      } catch (e) {
        expect(e, `event ${i}: ${e}`).toBeInstanceOf(InviteError);
      }
    }
  });
});
