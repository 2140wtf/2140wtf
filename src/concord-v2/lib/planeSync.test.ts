/**
 * Tests for the plane-sweep discipline (planeSync.ts):
 * batching, single-flight, auth-gating, completeness modes (control =
 * whole-plane refetch, guestbook = epoch-keyed forward cursor), retry.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";

import { controlGroups } from "@/concord-v2/lib/control";
import { bytesToHex, controlGroupKey, guestbookGroupKey } from "@/concord-v2/lib/derive";
import { guestbookGroups } from "@/concord-v2/lib/guestbook";
import { KIND_SEAL_PLAINTEXT } from "@/concord-v2/lib/kinds";
import {
  _configureAuthWaitForTests,
  _configureSweepPagingForTests,
  _resetPlaneSweepMemoForTests,
  controlScope,
  controlSweepTruncated,
  guestbookScope,
  sweepControl,
  sweepGuestbook,
  sweepRelayScopes,
  whenAuthSettled,
} from "@/concord-v2/lib/planeSync";
import { updateStreamCursor } from "@/concord-v2/lib/rumorStore";
import {
  _resetStreamAuthRegistry,
  noteAuthResult,
  noteRelayChallenged,
  noteStreamAuthSent,
  registerStreamKeys,
} from "@/concord-v2/lib/streamAuth";
import { buildRumor, sealRumor, wrapSeal, type Rumor } from "@/concord-v2/lib/stream";
import type { CommunityV2 } from "@/concord-v2/lib/types";

// ── Fake relay ───────────────────────────────────────────────────────────────

interface Filter {
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

class FakeRelay {
  events: NostrEvent[] = [];
  /** Each `.query()` call's filter set, in arrival order. */
  calls: Filter[][] = [];
  /** Artificial answer latency, so concurrent sweeps genuinely overlap. */
  delayMs = 0;
  /** Fail this many queries before answering (socket-swap/timeout stand-in). */
  failNext = 0;

  async query(filters: Filter[]): Promise<NostrEvent[]> {
    this.calls.push(filters);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("relay round lost");
    }
    const out = new Map<string, NostrEvent>();
    for (const f of filters) {
      // Per-filter matching with a PER-FILTER limit (NIP-01), like a real relay.
      const matched = this.events
        .filter(
          (ev) =>
            (!f.kinds || f.kinds.includes(ev.kind)) &&
            (!f.authors || f.authors.includes(ev.pubkey)) &&
            (f.since === undefined || ev.created_at >= f.since) &&
            (f.until === undefined || ev.created_at <= f.until),
        )
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit);
      for (const ev of matched) out.set(ev.id, ev);
    }
    return [...out.values()];
  }
}

function poolOf(relays: Record<string, FakeRelay>) {
  return { relay: (url: string) => relays[url] };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RELAY_A = "wss://relay-a.test";

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

function communityOf(fill: number, owner: string): CommunityV2 {
  const root = new Uint8Array(32).fill(fill);
  const id = new Uint8Array(32).fill(fill + 1);
  return {
    id,
    idHex: bytesToHex(id),
    owner,
    ownerSalt: new Uint8Array(32),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: [RELAY_A],
    name: "test",
  } as CommunityV2;
}

/** A plane wrap (edition-shaped rumor) with a controlled outer created_at. */
async function wrapAt(
  group: ReturnType<typeof controlGroupKey>,
  s: ReturnType<typeof signer>,
  eid: string,
  createdAt: number,
): Promise<{ wrap: NostrEvent; rumor: Rumor }> {
  const rumor = buildRumor({
    kind: 3308,
    content: "{}",
    tags: [["vsk", "0"], ["eid", eid], ["ev", "1"]],
    pubkey: s.pubkey,
    ms: null,
    createdAtSecs: createdAt,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, group, s);
  const w = wrapSeal(seal, group);
  const wrap = finalizeEvent({ kind: w.kind, content: w.content, tags: w.tags, created_at: createdAt }, group.sk);
  return { wrap, rumor };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetStreamAuthRegistry();
  _resetPlaneSweepMemoForTests();
  _configureSweepPagingForTests({ pageLimit: 500, maxPages: 8 });
  // Most tests exercise the fetch discipline, not the auth gate — let sweeps
  // proceed immediately (maxWaitMs 0 = the cap expires at once).
  _configureAuthWaitForTests({ maxWaitMs: 0 });
});

describe("sweepRelayScopes — stream-auth gate", () => {
  it("holds every caller's REQ until the stream keys register, then fires", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 5_000 });
    const owner = signer();
    const community = communityOf(20, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    // The hook fires before useRegisterAllStreamKeys2 has registered the keys.
    const sweep = sweepControl(nostr, community);
    await new Promise((r) => setTimeout(r, 250));
    expect(relay.calls.length, "an unauthenticatable REQ must never leave the client").toBe(0);

    // Keys register (an unchallenged relay needs no AUTH acks)…
    registerStreamKeys(controlGroups(community), community.relays);
    const fresh = await sweep;

    // …and only then does the REQ go out.
    expect(relay.calls.length).toBe(1);
    expect(fresh.map((e) => e.rumorId)).toContain(e1.rumor.id);
  });

  it("on a CHALLENGED relay, holds the REQ until the relay ACKS the stream AUTHs", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 5_000 });
    const owner = signer();
    const community = communityOf(22, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    // The relay issued a NIP-42 challenge on the live socket; AUTH frames for
    // the community's groups are in flight but not yet acked.
    noteRelayChallenged(RELAY_A);
    const groups = controlGroups(community);
    registerStreamKeys(groups, community.relays);
    groups.forEach((g, i) => noteStreamAuthSent(RELAY_A, `auth-ev-${i}`, g.pk));

    const sweep = sweepControl(nostr, community);
    await new Promise((r) => setTimeout(r, 250));
    expect(relay.calls.length, "a REQ must wait for the relay's AUTH acks").toBe(0);

    // The relay acks each AUTH (["OK", id, true]) — the gate opens.
    groups.forEach((_, i) => noteAuthResult(RELAY_A, `auth-ev-${i}`, true));
    const fresh = await sweep;

    expect(relay.calls.length).toBe(1);
    expect(fresh.map((e) => e.rumorId)).toContain(e1.rumor.id);
  });

  it("whenAuthSettled: an UNCHALLENGED relay never waits (backfills/warm-up proceed at once)", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 5_000 });
    const owner = signer();
    const community = communityOf(26, owner.pubkey);
    const groups = controlGroups(community);

    const started = Date.now();
    await whenAuthSettled(RELAY_A, () => groups);
    expect(Date.now() - started, "no challenge ⇒ nothing to wait for").toBeLessThan(200);
  });

  it("whenAuthSettled: a CHALLENGED relay holds until its AUTH acks land", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 5_000 });
    const owner = signer();
    const community = communityOf(30, owner.pubkey);
    const groups = controlGroups(community);

    noteRelayChallenged(RELAY_A);
    registerStreamKeys(groups, community.relays);
    groups.forEach((g, i) => noteStreamAuthSent(RELAY_A, `settle-ev-${i}`, g.pk));

    let settled = false;
    const wait = whenAuthSettled(RELAY_A, () => groups).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(settled, "must hold while AUTHs are unacked").toBe(false);

    groups.forEach((_, i) => noteAuthResult(RELAY_A, `settle-ev-${i}`, true));
    await wait;
    expect(settled).toBe(true);
  });

  it("proceeds after the wait cap even if keys never register (cursor discipline still heals)", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 300 });
    const owner = signer();
    const community = communityOf(24, owner.pubkey);
    const relay = new FakeRelay();
    const nostr = poolOf({ [RELAY_A]: relay });

    const fresh = await sweepControl(nostr, community);

    expect(relay.calls.length, "the cap must not let a sweep hang forever").toBe(1);
    expect(fresh).toEqual([]);
  });

  it("sweeps arriving while the gate is closed coalesce into ONE REQ when it opens", async () => {
    _configureAuthWaitForTests({ maxWaitMs: 5_000 });
    const owner = signer();
    const a = communityOf(28, owner.pubkey);
    const b = communityOf(32, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    const aCtl = await wrapAt(controlGroupKey(a.root, a.id, 0), owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [aCtl.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    // Two communities' hooks fire independently pre-registration.
    const sweeps = Promise.all([
      sweepControl(nostr, a),
      sweepGuestbook(nostr, a),
      sweepControl(nostr, b),
      sweepGuestbook(nostr, b),
    ]);
    registerStreamKeys(
      [...controlGroups(a), ...guestbookGroups(a), ...controlGroups(b), ...guestbookGroups(b)],
      [RELAY_A],
    );
    const [aFresh] = await sweeps;

    expect(relay.calls.length, "held sweeps must merge into one REQ per relay").toBe(1);
    expect(relay.calls[0].length, "one filter per scope").toBe(4);
    expect(aFresh.map((e) => e.rumorId)).toContain(aCtl.rumor.id);
  });
  it("registrations irrelevant to the batch's scopes never hold its gate", { timeout: 15_000 }, async () => {
    _configureAuthWaitForTests({ maxWaitMs: 3_000 });
    const owner = signer();
    const community = communityOf(36, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    // Keep the registry PERMANENTLY noisy with keys foreign to this batch.
    const churn = setInterval(() => {
      registerStreamKeys([
        {
          pk: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
          sk: new Uint8Array(32),
          convKey: new Uint8Array(32),
        },
      ]);
    }, 100);
    try {
      registerStreamKeys(controlGroups(community), community.relays);
      const started = Date.now();
      const fresh = await sweepControl(nostr, community);
      const took = Date.now() - started;

      expect(relay.calls.length).toBe(1);
      expect(fresh.map((e) => e.rumorId)).toContain(e1.rumor.id);
      // The gate tracks the batch's own keys, so foreign churn (other
      // communities registering) must not delay the sweep toward the cap.
      expect(took, "the gate must track the batch's own keys, not global churn").toBeLessThan(2_000);
    } finally {
      clearInterval(churn);
    }
  });
});

describe("sweepRelayScopes — resilience", () => {
  it("retries a lost relay round once, in place", async () => {
    const owner = signer();
    const community = communityOf(72, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    relay.failNext = 1; // the swap eats the first round
    const nostr = poolOf({ [RELAY_A]: relay });

    const fresh = await sweepControl(nostr, community);

    expect(relay.calls.length, "one retry after the lost round").toBe(2);
    expect(fresh.map((e) => e.rumorId)).toContain(e1.rumor.id);
  });

  it("gives up after the retry — cursors stay put so the next sweep re-asks in full", async () => {
    const owner = signer();
    const community = communityOf(76, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    relay.failNext = 2; // both rounds lost
    const nostr = poolOf({ [RELAY_A]: relay });

    const fresh = await sweepControl(nostr, community);
    expect(relay.calls.length).toBe(2);
    expect(fresh).toEqual([]);

    // The next sweep must re-ask from scratch — no cursor advanced.
    const healed = await sweepControl(nostr, community);
    expect(relay.calls[2][0].since).toBeUndefined();
    expect(healed.map((e) => e.rumorId)).toContain(e1.rumor.id);
  });
});

describe("sweepRelayScopes — one REQ per relay, per-scope filters", () => {
  it("sweeps many communities' planes through ONE relay REQ, demuxed per scope", async () => {
    const owner = signer();
    const a = communityOf(40, owner.pubkey);
    const b = communityOf(44, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    const aCtl = await wrapAt(controlGroupKey(a.root, a.id, 0), owner, "ab".repeat(32), now - 100);
    const bGb = await wrapAt(guestbookGroupKey(b.root, b.id, 0), owner, "cd".repeat(32), now - 90);

    const relay = new FakeRelay();
    relay.events = [aCtl.wrap, bGb.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    const scopes = [
      controlScope(a, RELAY_A),
      guestbookScope(a, RELAY_A),
      controlScope(b, RELAY_A),
      guestbookScope(b, RELAY_A),
    ];
    const result = await sweepRelayScopes(nostr, RELAY_A, scopes);

    expect(relay.calls.length, "the whole catch-up must be one REQ").toBe(1);
    expect(relay.calls[0].length, "one filter per community-plane").toBe(4);
    expect(result.get(scopes[0].scope)?.map((e) => e.rumorId)).toContain(aCtl.rumor.id);
    expect(result.get(scopes[3].scope)?.map((e) => e.rumorId)).toContain(bGb.rumor.id);
    expect(result.get(scopes[1].scope)).toEqual([]);
    expect(result.get(scopes[2].scope)).toEqual([]);
  });

  it("advances each guestbook scope's cursor independently inside one batch (issue #19 isolation)", async () => {
    const owner = signer();
    const a = communityOf(48, owner.pubkey);
    const b = communityOf(52, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    // Only community A has a motion; B's plane is still empty on this relay.
    const aGb = await wrapAt(guestbookGroupKey(a.root, a.id, 0), owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [aGb.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    const scopesOf = () => [guestbookScope(a, RELAY_A), guestbookScope(b, RELAY_A)];
    await sweepRelayScopes(nostr, RELAY_A, scopesOf());
    await sweepRelayScopes(nostr, RELAY_A, scopesOf());

    expect(relay.calls.length).toBe(2);
    const [aFilter, bFilter] = relay.calls[1];
    expect(aFilter.since, "A saw a motion — its cursor advances").toBe(aGb.wrap.created_at);
    // B must be re-asked from the start: A's newer motion must NEVER move
    // B's cursor past motions B hasn't seen (the issue-#19 skip).
    expect(bFilter.since, "B saw nothing — its cursor must not move").toBeUndefined();
  });

  it("a community hook's sweep joins a batched sweep already in flight (no duplicate fetch)", async () => {
    const owner = signer();
    const a = communityOf(56, owner.pubkey);
    const b = communityOf(60, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    const aCtl = await wrapAt(controlGroupKey(a.root, a.id, 0), owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [aCtl.wrap];
    relay.delayMs = 150; // the hook's sweep starts while the batch is mid-flight
    const nostr = poolOf({ [RELAY_A]: relay });

    // The global background sweep and useControlEvents2's queryFn fire together.
    const [batch, hook] = await Promise.all([
      sweepRelayScopes(nostr, RELAY_A, [controlScope(a, RELAY_A), controlScope(b, RELAY_A)]),
      sweepControl(nostr, a),
    ]);

    expect(relay.calls.length, "the hook must join the in-flight batch, not re-fetch").toBe(1);
    expect(batch.get(controlScope(a, RELAY_A).scope)?.map((e) => e.rumorId)).toContain(aCtl.rumor.id);
    expect(hook.map((e) => e.rumorId), "the joining sweep must receive the shared result").toContain(
      aCtl.rumor.id,
    );
  });

  it("different planes of the same community are NOT deduped against each other", async () => {
    const owner = signer();
    const community = communityOf(64, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    const ctl = await wrapAt(controlGroupKey(community.root, community.id, 0), owner, "ab".repeat(32), now - 100);
    const gb = await wrapAt(guestbookGroupKey(community.root, community.id, 0), owner, "cd".repeat(32), now - 90);

    const relay = new FakeRelay();
    relay.events = [ctl.wrap, gb.wrap];
    relay.delayMs = 100;
    const nostr = poolOf({ [RELAY_A]: relay });

    const [c, g] = await Promise.all([
      sweepControl(nostr, community),
      sweepGuestbook(nostr, community),
    ]);

    expect(c.map((e) => e.rumorId)).toContain(ctl.rumor.id);
    expect(g.map((e) => e.rumorId)).toContain(gb.rumor.id);
  });

  it("sequential guestbook sweeps advance the per-relay cursor (the second asks `since`)", async () => {
    const owner = signer();
    const community = communityOf(68, owner.pubkey);
    const guestbook = guestbookGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(guestbook, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    await sweepGuestbook(nostr, community);
    await sweepGuestbook(nostr, community);

    expect(relay.calls.length).toBe(2);
    expect(relay.calls[0][0].since, "first sweep is a full read").toBeUndefined();
    expect(relay.calls[1][0].since, "second sweep must be cursor-gated").toBe(e1.wrap.created_at);
  });
});

describe("control completeness — the whole plane, every sweep", () => {
  it("never cursor-gates: repeat sweeps re-ask in full, announcing only session-new wraps", async () => {
    const owner = signer();
    const community = communityOf(80, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const e1 = await wrapAt(control, owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [e1.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    const first = await sweepControl(nostr, community);
    const second = await sweepControl(nostr, community);

    expect(relay.calls.length).toBe(2);
    expect(relay.calls[0][0].since, "control must not trust a forward cursor").toBeUndefined();
    expect(relay.calls[1][0].since, "…on ANY sweep, not just the first").toBeUndefined();
    expect(first.map((e) => e.rumorId)).toContain(e1.rumor.id);
    expect(second, "a re-received wrap is not fresh — the session memo keeps repeats quiet").toEqual([]);

    // A genuinely new edition landing between sweeps still surfaces alone.
    const e2 = await wrapAt(control, owner, "cd".repeat(32), now - 50);
    relay.events.push(e2.wrap);
    const third = await sweepControl(nostr, community);
    expect(third.map((e) => e.rumorId)).toEqual([e2.rumor.id]);
  });

  it("a stale persisted cursor (pre-fix state) cannot starve the control fold", async () => {
    const owner = signer();
    const community = communityOf(84, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    // The regression this guards: an unban edition sits BELOW a high-water
    // cursor persisted across a leave/ban/rejoin — the old `since` discipline
    // could never fetch it again, so the rejoiner folded a stale banlist.
    const unban = await wrapAt(control, owner, "ab".repeat(32), now - 500);
    await updateStreamCursor(`control:${community.idHex}|${RELAY_A}`, { newest: now - 10 });

    const relay = new FakeRelay();
    relay.events = [unban.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    const fresh = await sweepControl(nostr, community);

    expect(relay.calls[0][0].since, "the poisoned cursor must be ignored").toBeUndefined();
    expect(fresh.map((e) => e.rumorId), "the below-cursor edition must be recovered").toContain(unban.rumor.id);
  });

  it("pages past the relay's per-filter limit instead of silently truncating the plane", async () => {
    _configureSweepPagingForTests({ pageLimit: 2 });
    const owner = signer();
    const community = communityOf(88, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const wraps = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => wrapAt(control, owner, i.toString(16).padStart(2, "0").repeat(32), now - 100 - i * 10)),
    );

    const relay = new FakeRelay();
    relay.events = wraps.map((w) => w.wrap);
    const nostr = poolOf({ [RELAY_A]: relay });

    const fresh = await sweepControl(nostr, community);

    expect(relay.calls.length, "a full first page must trigger `until` paging").toBeGreaterThan(1);
    for (const w of wraps) {
      expect(fresh.map((e) => e.rumorId), "every page's editions must be recovered").toContain(w.rumor.id);
    }
  });

  it("flags truncation when the plane exceeds the pager budget (the refound safety gate)", async () => {
    // A plane deeper than pageLimit*maxPages: the sweep leaves editions behind
    // this round, and MUST advertise it so a Refounding aborts rather than
    // compact a truncated plane (dropping unfetched entities from the new epoch
    // for every member, forever).
    _configureSweepPagingForTests({ pageLimit: 2, maxPages: 1 });
    const owner = signer();
    const community = communityOf(90, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const wraps = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => wrapAt(control, owner, i.toString(16).padStart(2, "0").repeat(32), now - 100 - i * 10)),
    );

    const relay = new FakeRelay();
    relay.events = wraps.map((w) => w.wrap);
    const nostr = poolOf({ [RELAY_A]: relay });

    expect(controlSweepTruncated(community), "clean before any sweep").toBe(false);
    await sweepControl(nostr, community);
    expect(controlSweepTruncated(community), "the pager hit its budget — refound must abort").toBe(true);
  });

  it("clears a prior truncation verdict once the plane fits the budget again", async () => {
    const owner = signer();
    const community = communityOf(91, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);
    const now = Math.floor(Date.now() / 1000);
    const wraps = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => wrapAt(control, owner, i.toString(16).padStart(2, "0").repeat(32), now - 100 - i * 10)),
    );
    const relay = new FakeRelay();
    relay.events = wraps.map((w) => w.wrap);
    const nostr = poolOf({ [RELAY_A]: relay });

    _configureSweepPagingForTests({ pageLimit: 2, maxPages: 1 });
    await sweepControl(nostr, community);
    expect(controlSweepTruncated(community)).toBe(true);

    // A generous budget on the next round reaches the whole plane: the verdict
    // must lift (a transient deep-plane must not wedge future refounds).
    _resetPlaneSweepMemoForTests();
    _configureSweepPagingForTests({ pageLimit: 500, maxPages: 8 });
    await sweepControl(nostr, community);
    expect(controlSweepTruncated(community)).toBe(false);
  });
});

describe("guestbook forward cursor — epoch-keyed scope", () => {
  it("an epoch advance re-baselines: the first sweep at the new epoch is a full backfill", async () => {
    const owner = signer();
    const base = communityOf(92, owner.pubkey);
    const now = Math.floor(Date.now() / 1000);
    const gb0 = await wrapAt(guestbookGroupKey(base.root, base.id, 0), owner, "ab".repeat(32), now - 100);

    const relay = new FakeRelay();
    relay.events = [gb0.wrap];
    const nostr = poolOf({ [RELAY_A]: relay });

    await sweepGuestbook(nostr, base);
    await sweepGuestbook(nostr, base);
    expect(relay.calls[1][0].since, "steady state stays cursor-gated").toBe(gb0.wrap.created_at);

    // A rekey adoption / rejoin: the member now reads MORE (epoch 1 + retained
    // epoch 0). The old cursor was minted under a narrower read scope — the
    // first sweep at the new epoch must be a full backfill, not since-gated.
    const root1 = new Uint8Array(32).fill(93);
    const adopted = {
      ...base,
      root: root1,
      rootEpoch: 1n,
      heldRoots: [{ epoch: 1n, key: root1 }, ...base.heldRoots],
    };
    await sweepGuestbook(nostr, adopted);

    const filter = relay.calls[2][0];
    expect(filter.since, "a cursor from another epoch's read scope must not gate this sweep").toBeUndefined();
    expect(filter.authors?.length, "the sweep must span every held epoch's group").toBe(2);
  });
});
