/**
 * Regression tests for issue #19 — "Notifications arrive for messages that
 * never render in the timeline (desktop + mobile)".
 *
 * The messages exist on the relays and decrypt cleanly (a headless client
 * renders the full timeline), yet every UI client with a saved sync cursor is
 * missing the same messages. These tests pin the two client-side mechanisms:
 *
 * 1. THE BACKFILL MIDDLE-GAP. `backfillAndRefresh` fetches one newest page
 *    (pass 1) and then resumes OLDER paging from the saved `cursor.oldest`
 *    (pass 2) — the bottom of already-seen history. When more than one page of
 *    wraps arrived while the app was closed, the region between the old
 *    `cursor.newest` and pass 1's oldest is never fetched from any relay, and
 *    the cursor's `newest` then advances to now, sealing the hole permanently.
 *
 * 2. THE DESTRUCTIVE PENDING-WRAP DRAIN. The queryFn drains wraps parked by
 *    the native notification service (removing them from the pending store)
 *    BEFORE decrypting them. If the decrypt round is aborted (channel switch
 *    mid-read), the undecoded wraps are gone locally — recoverable only via
 *    relay backfill, which has the gap above.
 *
 * These tests assert the DESIRED behavior, so they fail until the bugs are
 * fixed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

import { openChatBatch } from "@/concord-v2/lib/chat";
import { bytesToHex, channelGroupKey, voiceGroupKey, voiceMediaKey } from "@/concord-v2/lib/derive";
import { KIND_MESSAGE, KIND_SEAL_ENCRYPTED } from "@/concord-v2/lib/kinds";
import {
  ackPendingWraps,
  parkPendingWraps,
  peekPendingWraps,
  queryChannelRumors,
  updateChannelCursor,
  writeRumors,
} from "@/concord-v2/lib/rumorStore";
import { buildRumor, channelBindingTags, sealRumor, wrapSeal } from "@/concord-v2/lib/stream";
import type { ChannelV2, CommunityV2 } from "@/concord-v2/lib/types";

import { useChannelTimeline2 } from "./useChannel2";

// ── Module mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ pool: undefined as unknown }));

vi.mock("@nostrify/react", () => ({
  useNostr: () => ({ nostr: h.pool }),
}));
vi.mock("@/concord-v2/hooks/useControlPlane2", () => ({
  useControlFold2: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: undefined }),
}));
vi.mock("@/hooks/useSendStatusMap", () => ({
  useSendStatusMap: () => ({ setStatus: () => {} }),
  useSendStatusMapValue: () => ({}),
}));

// ── Fake relay ───────────────────────────────────────────────────────────────

interface Filter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

/** An in-memory relay honoring kinds/authors/since/until/limit, newest-first. */
class FakeRelay {
  events: NostrEvent[] = [];
  queries: Filter[] = [];
  /** Simulated response latency (cold TLS+WS+NIP-42 AUTH round-trips). */
  delayMs = 0;

  match(f: Filter): NostrEvent[] {
    let evs = this.events.filter(
      (ev) =>
        (!f.kinds || f.kinds.includes(ev.kind)) &&
        (!f.authors || f.authors.includes(ev.pubkey)) &&
        (f.since === undefined || ev.created_at >= f.since) &&
        (f.until === undefined || ev.created_at <= f.until),
    );
    evs = [...evs].sort((a, b) => b.created_at - a.created_at);
    if (f.limit !== undefined) evs = evs.slice(0, f.limit);
    return evs;
  }

  async query(filters: Filter[], opts?: { signal?: AbortSignal }): Promise<NostrEvent[]> {
    this.queries.push(...filters);
    if (this.delayMs > 0) {
      // Honor the abort signal during the latency window, as NRelay1 does.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        opts?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
    const out = new Map<string, NostrEvent>();
    for (const f of filters) for (const ev of this.match(f)) out.set(ev.id, ev);
    return [...out.values()];
  }

  /** Live subscription: emits nothing, parks until aborted. */
  // eslint-disable-next-line require-yield
  async *req(_filters: Filter[], opts?: { signal?: AbortSignal }): AsyncGenerator<unknown> {
    await new Promise<void>((resolve) => {
      if (opts?.signal?.aborted) return resolve();
      opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async event(): Promise<void> {}
}

function makePool(relays: Record<string, FakeRelay>) {
  return { relay: (url: string) => relays[url] };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RELAY = "wss://test.relay";
const root = new Uint8Array(32).fill(3);

/** Each test gets a distinct channel id so the shared stores can't cross-talk. */
let nextChannelByte = 40;
function makeChannel(): { channel: ChannelV2; idHex: string } {
  const channelId = new Uint8Array(32).fill(nextChannelByte++);
  const idHex = bytesToHex(channelId);
  const group = channelGroupKey(root, channelId, 0);
  const stream = { epoch: 0n, group };
  const voice = { room: voiceGroupKey(root, channelId, 0), mediaKey: voiceMediaKey(root, channelId, 0) };
  return {
    channel: {
      id: channelId,
      idHex,
      name: "general",
      isPrivate: false,
      voice,
      streams: [stream],
      current: stream,
    },
    idHex,
  };
}

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

/**
 * A chat wrap with a CONTROLLED outer `created_at` (what the relay pagination
 * and sync cursors operate on). `wrapSeal` stamps "now", so re-finalize the
 * identical wrap payload with the chosen timestamp under the stream key —
 * byte-equivalent to a wrap genuinely published at that time (CORD-01: wrap
 * timestamps are not tweaked).
 */
async function wrapChatAt(
  channel: ChannelV2,
  s: ReturnType<typeof signer>,
  content: string,
  createdAt: number,
): Promise<NostrEvent> {
  const rumor = buildRumor({
    kind: KIND_MESSAGE,
    content,
    tags: [...channelBindingTags(channel.idHex, 0n)],
    pubkey: s.pubkey,
    ms: createdAt * 1000,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, channel.current.group, s);
  const w = wrapSeal(seal, channel.current.group);
  return finalizeEvent(
    { kind: w.kind, content: w.content, tags: w.tags, created_at: createdAt },
    channel.current.group.sk,
  );
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useChannelTimeline2 — issue #19 (notified but never rendered)", () => {
  it(
    "renders EVERY message that arrived while the app was closed, even when the offline burst exceeds one backfill page",
    { timeout: 40_000 },
    async () => {
      const { channel, idHex } = makeChannel();
      const alice = signer();
      const now = Math.floor(Date.now() / 1000);
      const base = now - 60_000; // far enough back that the live sub (since now-5) never matches

      // ── Prior session: 10 messages seen and decrypted, sync cursor saved.
      const oldWraps: NostrEvent[] = [];
      for (let i = 0; i < 10; i++) oldWraps.push(await wrapChatAt(channel, alice, `old-${i}`, base + i));
      writeRumors(await openChatBatch(oldWraps, channel));
      await updateChannelCursor(idHex, { newest: base + 9, oldest: base });
      await waitFor(async () => {
        expect((await queryChannelRumors(idHex, { limit: 200 })).length).toBe(10);
      });

      // ── While the app was closed: 80 new messages (> BACKFILL_PAGE = 50).
      // The user was notified about all of them; they all live on the relay.
      const newWraps: NostrEvent[] = [];
      for (let i = 0; i < 80; i++) {
        newWraps.push(await wrapChatAt(channel, alice, `new-${i}`, base + 1000 + i));
      }

      const relay = new FakeRelay();
      relay.events = [...oldWraps, ...newWraps];
      h.pool = makePool({ [RELAY]: relay });

      const community = { idHex: "cc".repeat(32), relays: [RELAY] } as unknown as CommunityV2;
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useChannelTimeline2(community, channel), { wrapper });

      // The newest page lands (pass 1 of the backfill completed and painted).
      await waitFor(
        () => {
          expect(result.current.folded.messages.map((m) => m.content)).toContain("new-79");
        },
        { timeout: 15_000 },
      );

      // …and every notified message must land too: the backfill must bridge
      // the region between the saved cursor's `newest` and pass 1's oldest.
      // (Bug: pass 2 resumes from cursor.oldest — BELOW already-seen history —
      // so new-0..new-29 are never fetched from any relay, and the advanced
      // cursor seals the gap permanently.)
      await waitFor(
        () => {
          const contents = new Set(result.current.folded.messages.map((m) => m.content));
          const missing: string[] = [];
          for (let i = 0; i < 80; i++) if (!contents.has(`new-${i}`)) missing.push(`new-${i}`);
          expect(missing, `messages on the relay but never rendered: ${missing.join(", ")}`).toEqual([]);
        },
        { timeout: 8_000 },
      );
    },
  );

  it(
    "a fast EMPTY relay must not starve a slower relay that carries the messages (EOSE-grace race)",
    { timeout: 30_000 },
    async () => {
      // Live-data topology (issue #19): the platform relay is unioned into
      // every Concord community's relay set but stores NO wraps — it answers
      // every REQ instantly with an empty EOSE. The real community relays gate
      // kind 1059 behind NIP-42, so a cold query costs extra round-trips
      // (REQ → CLOSED auth-required → AUTH → REQ → EOSE), easily >500ms.
      //
      // backfillStore arms a 500ms abort-grace as soon as the FIRST relay
      // returns a page. The empty platform relay always wins that race, the
      // real relays are aborted mid-AUTH, and the backfill completes with
      // ZERO events (and marks the channel exhausted) — precisely on a cold
      // open, the moment the user taps a notification.
      const { channel, idHex } = makeChannel();
      const alice = signer();
      const now = Math.floor(Date.now() / 1000);
      const base = now - 60_000;

      // Prior session: 5 messages seen, cursor saved.
      const oldWraps: NostrEvent[] = [];
      for (let i = 0; i < 5; i++) oldWraps.push(await wrapChatAt(channel, alice, `old-${i}`, base + i));
      writeRumors(await openChatBatch(oldWraps, channel));
      await updateChannelCursor(idHex, { newest: base + 4, oldest: base });
      await waitFor(async () => {
        expect((await queryChannelRumors(idHex, { limit: 200 })).length).toBe(5);
      });

      // While the app was closed: 10 new messages — well under one page, so
      // the ONLY failure mode in play is the grace race.
      const newWraps: NostrEvent[] = [];
      for (let i = 0; i < 10; i++) newWraps.push(await wrapChatAt(channel, alice, `new-${i}`, base + 1000 + i));

      const platform = new FakeRelay(); // instant, empty — never stores wraps
      const real = new FakeRelay();
      real.events = [...oldWraps, ...newWraps];
      real.delayMs = 900; // cold AUTH round-trips
      h.pool = makePool({ "wss://platform.test": platform, "wss://real.test": real });

      const community = {
        idHex: "cc".repeat(32),
        relays: ["wss://platform.test", "wss://real.test"],
      } as unknown as CommunityV2;
      const { wrapper } = makeWrapper();
      const { result } = renderHook(() => useChannelTimeline2(community, channel), { wrapper });

      // Desired: every notified message lands — a relay that answered EMPTY
      // must not abort the relay that actually has the data.
      await waitFor(
        () => {
          const contents = new Set(result.current.folded.messages.map((m) => m.content));
          const missing: string[] = [];
          for (let i = 0; i < 10; i++) if (!contents.has(`new-${i}`)) missing.push(`new-${i}`);
          expect(missing, `messages on the slow relay but never rendered: ${missing.join(", ")}`).toEqual([]);
        },
        { timeout: 8_000 },
      );
    },
  );

  it("keeps parked wraps recoverable when the decrypt round is interrupted (no destructive drain)", async () => {
    const { channel, idHex } = makeChannel();
    const alice = signer();
    const now = Math.floor(Date.now() / 1000);

    // The native notification service parked three wraps it notified about.
    const wraps = await Promise.all(
      [0, 1, 2].map((i) => wrapChatAt(channel, alice, `lost-${i}`, now - 100 + i)),
    );
    parkPendingWraps(wraps);

    // The queryFn's ingest sequence (useChannel2), with an adversarial
    // interruption: the decode round produces nothing (aborted signal), so
    // NOTHING may be acknowledged — the wraps must stay parked.
    const pks = channel.streams.map((s) => s.group.pk);
    const parked: NostrEvent[] = [];
    await waitFor(async () => {
      parked.length = 0;
      parked.push(...(await peekPendingWraps(pks)));
      expect(parked.length).toBe(3);
    });
    const controller = new AbortController();
    controller.abort();
    const interrupted = await openChatBatch(parked, channel, { signal: controller.signal });
    writeRumors(interrupted);
    ackPendingWraps(parked.filter((w) => interrupted.some((o) => o.wrapId === w.id)).map((w) => w.id));

    // The notified messages are still recoverable locally — decoded into the
    // rumor store, or still parked for the next read.
    const decoded = await queryChannelRumors(idHex, { limit: 10 });
    const stillParked = await peekPendingWraps(pks);
    expect(decoded.length + stillParked.length).toBeGreaterThanOrEqual(3);

    // …and the next (uninterrupted) round consumes them fully: decoded to the
    // store, acked out of the pending store.
    const opened = await openChatBatch(stillParked, channel);
    writeRumors(opened);
    ackPendingWraps(stillParked.filter((w) => opened.some((o) => o.wrapId === w.id)).map((w) => w.id));
    await waitFor(async () => {
      expect((await queryChannelRumors(idHex, { limit: 10 })).length).toBe(3);
      expect((await peekPendingWraps(pks)).length).toBe(0);
    });
  });

  it("does not paint the previous channel's messages when switching channels", async () => {
    const chanA = makeChannel();
    const chanB = makeChannel();
    const alice = signer();
    const now = Math.floor(Date.now() / 1000);

    // Channel A has decrypted history in the rumor store.
    const wraps = [await wrapChatAt(chanA.channel, alice, "a-msg", now - 100)];
    writeRumors(await openChatBatch(wraps, chanA.channel));
    await waitFor(async () => {
      expect((await queryChannelRumors(chanA.idHex, { limit: 10 })).length).toBe(1);
    });

    // Channel B is empty and its relay is cold (auth round-trips), so B's first
    // read stays pending for a while after the switch.
    const relay = new FakeRelay();
    relay.delayMs = 800;
    h.pool = makePool({ [RELAY]: relay });
    const community = { idHex: "cc".repeat(32), relays: [RELAY] } as unknown as CommunityV2;

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      ({ channel }: { channel: ChannelV2 }) => useChannelTimeline2(community, channel),
      { wrapper, initialProps: { channel: chanA.channel } },
    );
    await waitFor(() => {
      expect(result.current.folded.messages.map((m) => m.content)).toContain("a-msg");
    });

    // Switch to channel B: A's timeline must never paint into B — not on the
    // switch render, and not on any LATER re-render while B's first read is
    // still pending. (Regression: an effect-updated ref re-admitted the old
    // channel's data through `placeholderData` one render after the switch —
    // the inline placeholder closure defeats TanStack's memoization, so any
    // re-render re-invokes it with the previous query's data, and by then the
    // ref already pointed at the new channel.)
    rerender({ channel: chanB.channel });
    expect(result.current.folded.messages.map((m) => m.content)).not.toContain("a-msg");
    rerender({ channel: chanB.channel });
    expect(result.current.folded.messages.map((m) => m.content)).not.toContain("a-msg");

    // …and B settles empty.
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.folded.messages).toEqual([]);
      },
      { timeout: 8_000 },
    );
  });

  it("keeps the skeleton up (never flashes 'no messages') while a cold channel backfills", async () => {
    const chanA = makeChannel();
    const chanB = makeChannel();
    const alice = signer();
    const now = Math.floor(Date.now() / 1000);

    // Channel A has history in the store; channel B has history ONLY on the
    // relay (cold — never opened this session), so B's store read returns [].
    writeRumors(await openChatBatch([await wrapChatAt(chanA.channel, alice, "a-msg", now - 100)], chanA.channel));
    const bWrap = await wrapChatAt(chanB.channel, alice, "b-msg", now - 50);
    await waitFor(async () => {
      expect((await queryChannelRumors(chanA.idHex, { limit: 10 })).length).toBe(1);
    });

    // B's relay is slow, so the window between the empty store read and the
    // backfill paint is wide — exactly where the flash happened.
    const relay = new FakeRelay();
    relay.events = [bWrap];
    relay.delayMs = 600;
    h.pool = makePool({ [RELAY]: relay });
    const community = { idHex: "cc".repeat(32), relays: [RELAY] } as unknown as CommunityV2;

    // Record EVERY render's (isLoading, message-count) so a single transient
    // "loaded + empty" frame — the flash — can't slip between polls.
    const frames: Array<{ loading: boolean; count: number; channel: string }> = [];
    let watched = chanA.idHex;

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      ({ channel }: { channel: ChannelV2 }) => {
        const t = useChannelTimeline2(community, channel);
        frames.push({ loading: t.isLoading, count: t.folded.messages.length, channel: watched });
        return t;
      },
      { wrapper, initialProps: { channel: chanA.channel } },
    );
    await waitFor(() => {
      expect(result.current.folded.messages.map((m) => m.content)).toContain("a-msg");
    });

    // Switch to the cold channel B; wait until b-msg paints from the backfill.
    watched = chanB.idHex;
    frames.length = 0;
    rerender({ channel: chanB.channel });
    await waitFor(
      () => {
        expect(result.current.folded.messages.map((m) => m.content)).toContain("b-msg");
      },
      { timeout: 8_000 },
    );

    // The invariant: while B was cold-loading, NO render may be simultaneously
    // not-loading AND empty — that pairing is the "No messages yet" flash.
    // (Regression: on the switch render `firstLoadDone` still carried channel
    // A's `true`, and the reset lived in a post-commit effect that raced B's
    // synchronous queryFn, so B's empty store read opened the isLoading gate
    // for a frame before the effect reset it.)
    const flashFrame = frames.find((f) => !f.loading && f.count === 0);
    expect(flashFrame).toBeUndefined();
    expect(result.current.folded.messages.map((m) => m.content)).toContain("b-msg");
  });
});
