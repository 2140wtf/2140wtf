/**
 * Security round 35 — hostile summons repro tests for useMySummons.
 *
 * ANYONE can publish a kind-39002 / kind-38026 `#p`-tagged to a juror's npub,
 * so the surface has to survive forged, unattributed, oversized and flooding
 * events:
 *
 *  R35-S1 a stranger's event becomes a notice but NOT a courtable summons:
 *         `attributed: false` (the UI renders "unverified publisher"),
 *         `attributed: true` only for the pinned court authority,
 *  R35-S2 a forged event (pubkey claims the juror / court, signature is not
 *         theirs) is dropped at parse,
 *  R35-S3 oversized tag values are rejected, not truncated (collision bait),
 *  R35-S4 a summons flood is capped in the list and in the toast queue,
 *  R35-S5 the ack flow stays a soft failure when the server has no row —
 *         never a blind POST (round-1 guarantee, still true).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  useMySummons,
  parseSummonsEvent,
  SUMMONS_PROPOSAL_KIND,
  SUMMONS_SELECTION_KIND,
} from "./useMySummons";

const mySeckey = generateSecretKey();
const myPubkey = getPublicKey(mySeckey);
const coordinatorSeckey = generateSecretKey();
const coordinatorPubkey = getPublicKey(coordinatorSeckey);
const attackerSeckey = generateSecretKey();

let relayEvents: NostrEvent[] = [];

const toastMock = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: getPublicKey(mySeckey),
      signer: {
        signEvent: async (event: {
          kind: number;
          created_at: number;
          tags: string[][];
          content: string;
        }) => finalizeEvent(event, mySeckey),
      },
    },
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@nostrify/nostrify", () => ({
  NRelay1: class {
    constructor(_url: string) {}
    async query() {
      return relayEvents;
    }
    async *_req() {
      // no live events
    }
    req() {
      return this._req();
    }
    async close() {}
  },
}));

vi.mock("@/lib/baoFundraising", () => ({
  baoApiBase: () => "https://api.bao.test",
}));

function proposalEvent(
  opts: {
    caseId?: string;
    outcome?: string;
    createdAt?: number;
    secret?: Uint8Array;
    marketId?: string;
  } = {},
): NostrEvent {
  return finalizeEvent(
    {
      kind: SUMMONS_PROPOSAL_KIND,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000) - 30,
      tags: [
        ["d", opts.caseId ?? "case-1"],
        ["market", opts.marketId ?? "market-1"],
        ["proposed", opts.outcome ?? "YES"],
        ["p", myPubkey],
      ],
      content: "",
    },
    opts.secret ?? coordinatorSeckey,
  ) as unknown as NostrEvent;
}

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
  relayEvents = [];
  vi.unstubAllGlobals();
  // The pin under test: the court's proposal/summons authority.
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", "");
  vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", coordinatorPubkey);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("R35-S1 — provenance of a #p-tagged notice", () => {
  it("marks a stranger's summons-unattributed and the pinned coordinator's attributed", () => {
    const advice = parseSummonsEvent(proposalEvent({ secret: attackerSeckey }))!;
    expect(advice.attributed).toBe(false);
    expect(advice.publisher).not.toBe(coordinatorPubkey);

    const genuine = parseSummonsEvent(proposalEvent())!;
    expect(genuine.attributed).toBe(true);
    expect(genuine.publisher).toBe(coordinatorPubkey);
  });

  it("still surfaces an unattributed notice (inbox semantics) — never silently dropped or trusted", async () => {
    relayEvents = [proposalEvent({ secret: attackerSeckey })];
    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));
    expect(result.current.summons[0]!.attributed).toBe(false);
    // The toast says so out loud rather than impersonating a real summons.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("unverified publisher") }),
    );
  });
});

describe("R35-S2 — forged events are dropped at parse", () => {
  it("drops an event whose pubkey claims the coordinator but whose signature is not theirs", () => {
    const genuine = proposalEvent();
    // Fresh object on purpose: spreading a signed event would carry
    // nostr-tools' internal verified-symbol cache (not reachable over JSON).
    const forged: NostrEvent = {
      kind: genuine.kind,
      created_at: genuine.created_at,
      tags: genuine.tags,
      content: genuine.content,
      pubkey: coordinatorPubkey,
      id: "a".repeat(64),
      sig: "f".repeat(128),
    };
    expect(parseSummonsEvent(forged)).toBeNull();
  });

  it("drops a malformed/unsigned event", () => {
    const forged: NostrEvent = {
      kind: SUMMONS_SELECTION_KIND,
      created_at: 1,
      tags: [["dispute", "d1"], ["market", "m1"], ["p", myPubkey]],
      content: "",
      pubkey: myPubkey,
      id: "b".repeat(64),
      sig: "e".repeat(128),
    };
    expect(parseSummonsEvent(forged)).toBeNull();
  });
});

describe("R35-S3 — oversized values are rejected, never truncated", () => {
  it("rejects a megabyte case id", () => {
    const huge = proposalEvent({ caseId: "c".repeat(1_000_000) });
    expect(parseSummonsEvent(huge)).toBeNull();
  });

  it("rejects an absurd proposed outcome", () => {
    const huge = proposalEvent({ outcome: "Y".repeat(5_000) });
    expect(parseSummonsEvent(huge)).toBeNull();
  });
});

describe("R35-S4 — a summons flood is bounded", () => {
  it("caps the notice list and the toast queue", async () => {
    const flood: NostrEvent[] = [];
    for (let i = 0; i < 210; i += 1) {
      flood.push(proposalEvent({ caseId: `case-${i}`, createdAt: 1_700_000_000 + i }));
    }
    relayEvents = flood;
    const { result } = renderHook(() => useMySummons());

    await waitFor(() => expect(result.current.summons.length).toBeGreaterThan(0));
    expect(result.current.summons.length).toBeLessThanOrEqual(200);
    // Newest first after the cap.
    expect(result.current.summons[0]!.caseId).toBe("case-209");
    // At most 5 individual toasts + 1 aggregate notice.
    await waitFor(() => expect(toastMock.mock.calls.length).toBeGreaterThan(0));
    expect(toastMock.mock.calls.length).toBeLessThanOrEqual(6);
    expect(
      toastMock.mock.calls.some(([arg]) => String(arg.title).includes("more court notices")),
    ).toBe(true);
  });
});

describe("R35-S5 — the ack flow fails soft without a server row", () => {
  it("returns summons_row_not_found and never POSTs a blind ack", async () => {
    relayEvents = [proposalEvent({ secret: attackerSeckey })];
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return Response.json({ data: { summons: [] } });
      }),
    );

    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    let ackResult: Awaited<ReturnType<typeof result.current.ackSummons>> | undefined;
    await act(async () => {
      ackResult = await result.current.ackSummons(result.current.summons[0]!);
    });
    expect(ackResult!.ok).toBe(false);
    expect(ackResult!.reason).toBe("summons_row_not_found");
    expect(calls.filter((url) => url.includes("/ack"))).toHaveLength(0);
    expect(result.current.ackedEventIds).toHaveLength(0);
  });

  it("caps the failure reason it surfaces from the server", async () => {
    relayEvents = [proposalEvent()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { data: { summons: [{ id: 1, jurorPubkey: myPubkey, status: "sent" }] } },
          { status: 200 },
        ),
      ),
    );
    // Second call (the ack) fails with a long server message.
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("summons-board")) {
        return Response.json({ data: { summons: [{ id: 1, jurorPubkey: myPubkey, status: "sent" }] } });
      }
      return Response.json(
        { error: { message: "x".repeat(5_000) } },
        { status: 400 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    let ackResult: Awaited<ReturnType<typeof result.current.ackSummons>> | undefined;
    await act(async () => {
      ackResult = await result.current.ackSummons(result.current.summons[0]!);
    });
    expect(ackResult!.ok).toBe(false);
    expect(ackResult!.reason!.length).toBeLessThanOrEqual(200);
  });
});
