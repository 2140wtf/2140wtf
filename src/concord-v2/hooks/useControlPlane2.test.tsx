/**
 * `useControlEvents2` network ownership (companion to useChannel2.test.tsx).
 *
 * The hook holds NO standing socket and runs NO poll. Live control editions
 * arrive through the wire's `c2ctl` subscription; the slow catch-up is the
 * global {@link syncControlPlane} sweep. The only network the hook itself
 * issues is a SINGLE on-open catch-up sweep (shared, single-flight,
 * cursor-gated via sweepControl) so navigating into a community surfaces
 * anything the live sub missed while offline.
 *
 * This test pins that on-open sweep: mounting the hook for an active community
 * fetches the control plane once and folds it into the query cache — without
 * opening any `req()` subscription. The issue-#19 late-arriving-older-edition
 * HEAL now lives at the sweep layer (per-relay cursors) and is covered by
 * planeSync.test.ts + controlPlaneSync.test.ts.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";

import { bytesToHex, controlGroupKey } from "@/concord-v2/lib/derive";
import { KIND_SEAL_PLAINTEXT } from "@/concord-v2/lib/kinds";
import { buildRumor, sealRumor, wrapSeal, type Rumor } from "@/concord-v2/lib/stream";
import type { CommunityV2 } from "@/concord-v2/lib/types";

import { useControlEvents2 } from "./useControlPlane2";

import { _configureAuthWaitForTests } from "@/concord-v2/lib/planeSync";

// These tests exercise the on-open sweep, not planeSync's NIP-42 auth gate
// (planeSync.test.ts owns that) — let the sweep's REQs fly immediately.
beforeAll(() => {
  _configureAuthWaitForTests({ maxWaitMs: 0 });
});

// ── Module mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ pool: undefined as unknown }));

vi.mock("@nostrify/react", () => ({
  useNostr: () => ({ nostr: h.pool }),
}));
vi.mock("@/concord-v2/hooks/useDeferredFold2", () => ({
  useDeferredFold: () => undefined,
}));

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
  queries: Filter[] = [];
  reqCount = 0;

  async query(filters: Filter[]): Promise<NostrEvent[]> {
    this.queries.push(...filters);
    const out = new Map<string, NostrEvent>();
    for (const f of filters) {
      for (const ev of this.events) {
        const ok =
          (!f.kinds || f.kinds.includes(ev.kind)) &&
          (!f.authors || f.authors.includes(ev.pubkey)) &&
          (f.since === undefined || ev.created_at >= f.since) &&
          (f.until === undefined || ev.created_at <= f.until);
        if (ok) out.set(ev.id, ev);
      }
    }
    return [...out.values()].sort((a, b) => b.created_at - a.created_at).slice(0, filters[0]?.limit);
  }

  /** The hook must NOT open a standing subscription — assert this stays 0. */
  // eslint-disable-next-line require-yield
  async *req(_filters: Filter[], opts?: { signal?: AbortSignal }): AsyncGenerator<unknown> {
    this.reqCount++;
    await new Promise<void>((resolve) => {
      if (opts?.signal?.aborted) return resolve();
      opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async event(): Promise<void> {}
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RELAY_A = "wss://relay-a.test";
const RELAY_B = "wss://relay-b.test";

function signer(sk = generateSecretKey()) {
  return { sk, pubkey: getPublicKey(sk), signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) };
}

/** A control-plane edition wrap with a controlled outer `created_at`. */
async function editionWrapAt(
  control: ReturnType<typeof controlGroupKey>,
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
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, s);
  const w = wrapSeal(seal, control);
  const wrap = finalizeEvent(
    { kind: w.kind, content: w.content, tags: w.tags, created_at: createdAt },
    control.sk,
  );
  return { wrap, rumor };
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
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
    relays: [RELAY_A, RELAY_B],
    name: "test",
  } as CommunityV2;
}

// ── Test ─────────────────────────────────────────────────────────────────────

describe("useControlEvents2 — on-open sweep (no standing socket)", () => {
  it("fetches the control plane once on open and folds it, opening no req()", { timeout: 30_000 }, async () => {
    const owner = signer();
    const community = communityOf(21, owner.pubkey);
    const control = controlGroupKey(community.root, community.id, 0);

    const now = Math.floor(Date.now() / 1000);
    const edition = await editionWrapAt(control, owner, "ab".repeat(32), now - 1000);

    const relayA = new FakeRelay();
    relayA.events = [edition.wrap];
    const relayB = new FakeRelay();
    h.pool = { relay: (url: string) => (url === RELAY_A ? relayA : relayB) };

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useControlEvents2(community), { wrapper });

    // The on-open sweep pulls the edition into the query cache.
    await waitFor(
      () => {
        expect((result.current.data ?? []).map((e) => e.rumorId)).toContain(edition.rumor.id);
      },
      { timeout: 10_000 },
    );

    // Crucially, the hook opened NO standing subscription — liveness is the
    // wire's job now.
    expect(relayA.reqCount, "hook must not open a standing req()").toBe(0);
    expect(relayB.reqCount, "hook must not open a standing req()").toBe(0);
  });

  it("an inactive community (rail button) issues no on-open sweep", { timeout: 30_000 }, async () => {
    const owner = signer();
    const community = communityOf(41, owner.pubkey);

    const relayA = new FakeRelay();
    const relayB = new FakeRelay();
    h.pool = { relay: (url: string) => (url === RELAY_A ? relayA : relayB) };

    const { wrapper } = makeWrapper();
    renderHook(() => useControlEvents2(community, false), { wrapper });

    // Give any (unwanted) async sweep a chance to fire.
    await new Promise((r) => setTimeout(r, 200));

    expect(relayA.queries.length + relayB.queries.length, "inactive hook must not sweep").toBe(0);
    expect(relayA.reqCount + relayB.reqCount).toBe(0);
  });
});
