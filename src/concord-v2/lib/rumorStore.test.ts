import { IDBFactory } from "fake-indexeddb";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import { bytesToHex, channelGroupKey, voiceGroupKey, voiceMediaKey } from "@/concord-v2/lib/derive";
import { openChatBatch, type OpenedChat } from "@/concord-v2/lib/chat";
import { KIND_DELETE, KIND_MESSAGE, KIND_REACTION, KIND_SEAL_ENCRYPTED, KIND_SEAL_PLAINTEXT } from "@/concord-v2/lib/kinds";
import { buildRumor, channelBindingTags, openWrap, rewrapSeal, sealRumor, wrapSeal, type Rumor } from "@/concord-v2/lib/stream";
import type { ChannelV2 } from "@/concord-v2/lib/types";
import {
  ackPendingWraps,
  openedToStored,
  parkPendingWraps,
  peekPendingWraps,
  queryByStreams,
  queryChannelRumors,
  queryMentionRumors,
  queryRumorsByChannel,
  storedToOpenedChat,
  writeOpened,
  writeRumors,
} from "@/concord-v2/lib/rumorStore";

// A clean IndexedDB for the suite (the store singleton opens against it lazily).
(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();

const root = new Uint8Array(32).fill(3);

/** Each test gets a distinct channel id so the shared store can't cross-talk. */
let nextChannelByte = 5;
function makeChannel(): { channel: ChannelV2; idHex: string } {
  const channelId = new Uint8Array(32).fill(nextChannelByte++);
  const idHex = bytesToHex(channelId);
  const group = channelGroupKey(root, channelId, 0);
  const stream = { epoch: 0n, group };
  const voice = { room: voiceGroupKey(root, channelId, 0), mediaKey: voiceMediaKey(root, channelId, 0) };
  return {
    channel: { id: channelId, idHex, name: "general", isPrivate: false, voice, streams: [stream], current: stream },
    idHex,
  };
}

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

async function wrapChat(rumor: Rumor, channel: ChannelV2, s: ReturnType<typeof signer>): Promise<NostrEvent> {
  return wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, channel.current.group, s), channel.current.group);
}

function chatRumor(
  idHex: string,
  s: ReturnType<typeof signer>,
  kind: number,
  content: string,
  ms: number,
  extra: string[][] = [],
): Rumor {
  return buildRumor({
    kind,
    content,
    tags: [...channelBindingTags(idHex, 0n), ...extra],
    pubkey: s.pubkey,
    ms,
  });
}

/** Poll until a condition holds (writes flush via requestIdleCallback/timeout). */
async function eventually<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (pred(v)) return v;
    if (Date.now() - start > ms) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("concord-v2 rumor store", () => {
  it("round-trips an OpenedChat through the stored rumor codec", () => {
    const { idHex } = makeChannel();
    const s = signer();
    const rumor = chatRumor(idHex, s, KIND_MESSAGE, "hello", 1234500 /* ms */);
    const opened: OpenedChat = {
      rumorId: rumor.id,
      author: s.pubkey,
      kind: KIND_MESSAGE,
      content: "hello",
      tags: rumor.tags,
      ms: 1234500,
      createdAt: rumor.created_at,
      wrapId: "w",
      streamPk: "sp",
      sealKind: KIND_SEAL_ENCRYPTED,
      seal: {} as NostrEvent,
      channelIdHex: idHex,
      epoch: 0n,
    };
    const stored = openedToStored(opened);
    expect(stored.id).toBe(rumor.id);
    expect(stored.sig).toBe("");
    expect(stored.kind).toBe(KIND_MESSAGE);
    expect(stored.pubkey).toBe(s.pubkey);

    const back = storedToOpenedChat(stored, idHex);
    expect(back.rumorId).toBe(rumor.id);
    expect(back.content).toBe("hello");
    expect(back.ms).toBe(1234500);
    expect(back.author).toBe(s.pubkey);
    expect(back.epoch).toBe(0n);
    expect(back.channelIdHex).toBe(idHex);
  });

  it("queries rumors by channel tag with { kinds, #channel }", async () => {
    const { channel, idHex } = makeChannel();
    const alice = signer();
    const bob = signer();

    const wraps = await Promise.all([
      wrapChat(chatRumor(idHex, alice, KIND_MESSAGE, "first", 1000), channel, alice),
      wrapChat(chatRumor(idHex, bob, KIND_MESSAGE, "second", 2000), channel, bob),
      wrapChat(chatRumor(idHex, alice, KIND_REACTION, "🔥", 2100, [["e", "x"]]), channel, alice),
    ]);
    const opened = await openChatBatch(wraps, channel);
    writeRumors(opened);

    const got = await eventually(
      () => queryChannelRumors(idHex, { limit: 100 }),
      (r) => r.length === 3,
    );
    expect(got.length).toBe(3);
    const msgs = got.filter((m) => m.kind === KIND_MESSAGE).map((m) => m.content).sort();
    expect(msgs).toEqual(["first", "second"]);

    // A different channel id matches nothing.
    const none = await queryChannelRumors("ff".repeat(32), { limit: 100 });
    expect(none.length).toBe(0);
  });

  it("delete=delete: a self kind-5 physically removes its target", async () => {
    const { channel, idHex } = makeChannel();
    const alice = signer();

    const msg = chatRumor(idHex, alice, KIND_MESSAGE, "gone soon", 1000);
    const del = chatRumor(idHex, alice, KIND_DELETE, "", 2000, [["e", msg.id], ["k", "9"]]);

    writeRumors(await openChatBatch([await wrapChat(msg, channel, alice)], channel));
    await eventually(() => queryChannelRumors(idHex, { limit: 100 }), (r) => r.length === 1);

    writeRumors(await openChatBatch([await wrapChat(del, channel, alice)], channel));
    // The delete rumor is stored; NIP-09 removes the targeted message.
    const after = await eventually(
      () => queryChannelRumors(idHex, { limit: 100 }),
      (r) => !r.some((m) => m.rumorId === msg.id),
    );
    expect(after.some((m) => m.rumorId === msg.id)).toBe(false);
  });

  it("preserves the full signed seal through the opened-event store (control compaction)", async () => {
    const alice = signer();
    const control = channelGroupKey(new Uint8Array(32).fill(9), new Uint8Array(32).fill(1), 0);
    // A plaintext-sealed control-style edition.
    const rumor = buildRumor({
      kind: 3308,
      content: "{}",
      tags: [["vsk", "0"], ["eid", "ab".repeat(32)], ["ev", "1"]],
      pubkey: alice.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, alice);
    const wrap = wrapSeal(seal, control);
    const opened = openWrap(wrap, control);

    writeOpened([opened]);
    const [back] = await eventually(() => queryByStreams([control.pk]), (r) => r.length === 1);
    expect(back.rumorId).toBe(opened.rumorId);
    expect(back.author).toBe(alice.pubkey);
    expect(back.sealKind).toBe(KIND_SEAL_PLAINTEXT);
    // The reconstructed seal is byte-identical and re-wrappable (compaction).
    expect(back.seal.id).toBe(seal.id);
    expect(back.seal.sig).toBe(seal.sig);
    const rewrapped = rewrapSeal(back.seal, control);
    expect(openWrap(rewrapped, control).rumorId).toBe(opened.rumorId);
  });

  it("parks, peeks (non-destructively), and acks raw wraps", async () => {
    const alice = signer();
    const control = channelGroupKey(new Uint8Array(32).fill(7), new Uint8Array(32).fill(2), 0);
    const rumor = buildRumor({ kind: 3308, content: "{}", tags: [["vsk", "0"], ["eid", "cd".repeat(32)], ["ev", "1"]], pubkey: alice.pubkey, ms: null });
    const wrap = wrapSeal(await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, alice), control);

    parkPendingWraps([wrap]);
    const peeked = await eventually(() => peekPendingWraps([control.pk]), (r) => r.length === 1);
    expect(peeked.map((w) => w.id)).toEqual([wrap.id]);
    // Peeking is non-destructive: an interrupted decode round must be able to
    // find the wrap again (issue #19 — a notified message must never be
    // locally destructible before its rumor is stored).
    const again = await peekPendingWraps([control.pk]);
    expect(again.map((w) => w.id)).toEqual([wrap.id]);
    // Only an explicit ack (after the decoded rumor is safely stored) removes it.
    ackPendingWraps([wrap.id]);
    const after = await eventually(() => peekPendingWraps([control.pk]), (r) => r.length === 0);
    expect(after.length).toBe(0);
  });

  it("peeks wraps parked in a PREVIOUS session (restart before the key arrived)", async () => {
    const alice = signer();
    const control = channelGroupKey(new Uint8Array(32).fill(8), new Uint8Array(32).fill(4), 0);
    const rumor = buildRumor({ kind: 3308, content: "{}", tags: [["vsk", "0"], ["eid", "ef".repeat(32)], ["ev", "1"]], pubkey: alice.pubkey, ms: null });
    const wrap = wrapSeal(await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, alice), control);

    // Session 1: the wrap arrives for a stream we hold no key for and is
    // parked. The app is then killed before the key ever resolves.
    parkPendingWraps([wrap]);
    await eventually(() => peekPendingWraps([control.pk]), (r) => r.length === 1);

    // Session 2: fresh module state (app restart), SAME durable IndexedDB.
    // The key arrives NOW, so the drain peeks — it must still see the wrap
    // parked last session. (Regression: a session-scoped "ever parked" flag
    // made this peek return [] until something new happened to park, leaving
    // last session's wraps invisible even once their key was available.)
    vi.resetModules();
    const fresh = await import("@/concord-v2/lib/rumorStore");
    const parked = await fresh.peekPendingWraps([control.pk]);
    expect(parked.map((w) => w.id)).toEqual([wrap.id]);
  });

  it("surfaces a mention buried DEEPER than the per-channel scan window", async () => {
    const { channel, idHex } = makeChannel();
    const alice = signer();
    const me = signer();

    // The mention is the OLDEST message, buried under 20 newer ones — deeper
    // than a shallow newest-window scan reaches.
    const rumors = [
      chatRumor(idHex, alice, KIND_MESSAGE, "hey @me", 1000, [["p", me.pubkey]]),
      ...Array.from({ length: 20 }, (_, i) =>
        chatRumor(idHex, alice, KIND_MESSAGE, `chatter ${i}`, 2000 + i * 1000),
      ),
    ];
    const wraps = await Promise.all(rumors.map((r) => wrapChat(r, channel, alice)));
    writeRumors(await openChatBatch(wraps, channel));
    await eventually(() => queryChannelRumors(idHex, { limit: 100 }), (r) => r.length === 21);

    // A newest-window community scan (as used by unread/threads) misses it…
    const windowed = await queryRumorsByChannel([idHex], { perChannel: 10 });
    expect(windowed.get(idHex)?.some((r) => r.content === "hey @me")).toBe(false);

    // …but the mentions view must still find it: its own index-backed `#p`
    // filter reaches the whole store. (Regression: deriving mentions from the
    // shared per-channel window silently dropped mentions older than a busy
    // channel's newest page.)
    const mentions = await queryMentionRumors([idHex], me.pubkey, { limit: 200 });
    expect(mentions.map((r) => r.content)).toEqual(["hey @me"]);
    expect(mentions[0].channelIdHex).toBe(idHex);
  });
});
