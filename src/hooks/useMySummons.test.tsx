import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event as NostrEvent } from "nostr-tools";

import {
  useMySummons,
  parseSummonsEvent,
  SUMMONS_PROPOSAL_KIND,
  SUMMONS_SELECTION_KIND,
} from "./useMySummons";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mySeckey = generateSecretKey();
const myPubkey = getPublicKey(mySeckey);
const coordinatorSeckey = generateSecretKey();

/** Events the fake relay serves for the initial query (mutated per test). */
let relayEvents: NostrEvent[] = [];

function makeProposalEvent(opts: {
  caseId: string;
  marketId: string;
  rosterPubkeys: string[];
  createdAt?: number;
  outcome?: string;
}): NostrEvent {
  return finalizeEvent(
    {
      kind: SUMMONS_PROPOSAL_KIND,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000) - 30,
      tags: [
        ["d", opts.caseId],
        ["market", opts.marketId],
        ["m", opts.marketId],
        ["proposed", opts.outcome ?? "YES"],
        ...opts.rosterPubkeys.map((p): [string, string] => ["p", p]),
      ],
      content: JSON.stringify({
        caseId: opts.caseId,
        marketId: opts.marketId,
        outcome: opts.outcome ?? "YES",
      }),
    },
    coordinatorSeckey,
  );
}

function makeSelectionEvent(opts: {
  disputeId: string;
  marketId: string;
  rosterPubkeys: string[];
  createdAt?: number;
}): NostrEvent {
  return finalizeEvent(
    {
      kind: SUMMONS_SELECTION_KIND,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000) - 20,
      tags: [
        ["dispute", opts.disputeId],
        ["market", opts.marketId],
        ...opts.rosterPubkeys.map((p): [string, string] => ["p", p]),
      ],
      content: "",
    },
    coordinatorSeckey,
  );
}

// ─── Module mocks ────────────────────────────────────────────────────────────

const toastMock = vi.fn();

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: {
      pubkey: getPublicKey(mySeckey),
      signer: {
        signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) =>
          finalizeEvent(event, mySeckey),
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
    // Live stream: ends immediately (the hook treats it as best-effort).
    async *_req() {
      // no events
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

// ─── fetch mock (summons-board + ack) ────────────────────────────────────────

const fetchCalls: { url: string; init?: RequestInit }[] = [];

function mockFetchBoardAndAck(opts?: { acked?: boolean; noRow?: boolean; boardStatus?: number }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).includes("/v1/court/summons-board")) {
      if (opts?.boardStatus) {
        return new Response("nope", { status: opts.boardStatus });
      }
      return Response.json({
        data: {
          summons: opts?.noRow ? [] : [
            {
              id: 42,
              caseId: "case-1",
              jurorPubkey: myPubkey,
              kind: "proposal",
              status: "sent",
              summonsEventId: relayEvents[0]?.id ?? null,
            },
          ],
        },
      });
    }
    // ack endpoint
    return Response.json({ data: { summons_id: 42, acked: opts?.acked ?? true } });
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  toastMock.mockClear();
  fetchCalls.length = 0;
  relayEvents = [];
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSummonsEvent", () => {
  it("parses a #p-tagged 38026 proposal into a notice", () => {
    const event = makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] });
    const parsed = parseSummonsEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe(SUMMONS_PROPOSAL_KIND);
    expect(parsed!.caseId).toBe("case-1");
    expect(parsed!.marketId).toBe("market-1");
    expect(parsed!.proposedOutcome).toBe("YES");
    expect(parsed!.eventId).toBe(event.id);
  });

  it("parses a 39002 selection via its dispute tag", () => {
    const event = makeSelectionEvent({ disputeId: "disp-1", marketId: "market-2", rosterPubkeys: [myPubkey] });
    const parsed = parseSummonsEvent(event);
    expect(parsed!.kind).toBe(SUMMONS_SELECTION_KIND);
    expect(parsed!.caseId).toBe("disp-1");
  });

  it("rejects other kinds and malformed events", () => {
    const note = finalizeEvent(
      { kind: 1, created_at: 1, tags: [], content: "not a summons" },
      coordinatorSeckey,
    );
    expect(parseSummonsEvent(note)).toBeNull();
    const noCase = makeProposalEvent({ caseId: "", marketId: "m", rosterPubkeys: [myPubkey] });
    expect(parseSummonsEvent(noCase)).toBeNull();
  });
});

describe("useMySummons", () => {
  it("surfaces #p-tagged summons and counts the unread badge", async () => {
    relayEvents = [
      makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] }),
      makeSelectionEvent({ disputeId: "disp-1", marketId: "market-2", rosterPubkeys: [myPubkey] }),
    ];
    const { result } = renderHook(() => useMySummons());

    await waitFor(() => expect(result.current.summons).toHaveLength(2));
    expect(result.current.unreadCount).toBe(2);
    // One toast per newly-arrived summons.
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(2));
  });

  it("ignores summons not #p-tagged to the logged-in npub", async () => {
    const other = getPublicKey(generateSecretKey());
    relayEvents = [
      makeProposalEvent({ caseId: "case-other", marketId: "market-1", rosterPubkeys: [other] }),
    ];
    const { result } = renderHook(() => useMySummons());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.summons).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("dedupes a redelivered event id", async () => {
    const event = makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] });
    relayEvents = [event];
    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    // The live stream re-serves the same event: still exactly one notice.
    relayEvents = [event, event];
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.summons).toHaveLength(1);
  });

  it("acks a summons: board lookup → POST /v1/court/summons/:id/ack, both NIP-98-signed", async () => {
    const event = makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] });
    relayEvents = [event];
    mockFetchBoardAndAck();
    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    let ackResult: Awaited<ReturnType<typeof result.current.ackSummons>> | undefined;
    await act(async () => {
      ackResult = await result.current.ackSummons(result.current.summons[0]!);
    });

    expect(ackResult!.ok).toBe(true);
    expect(ackResult!.acked).toBe(true);
    expect(fetchCalls).toHaveLength(2);
    const [board, ack] = fetchCalls;
    expect(board.url).toBe("https://api.bao.test/v1/court/summons-board?case_id=case-1");
    expect((board.init?.headers as Record<string, string>).Authorization).toMatch(/^Nostr /);
    expect(ack.url).toBe("https://api.bao.test/v1/court/summons/42/ack");
    expect(ack.init?.method).toBe("POST");
    expect((ack.init?.headers as Record<string, string>).Authorization).toMatch(/^Nostr /);
    // The acked event is recorded durably and clears the unread badge.
    expect(result.current.ackedEventIds).toContain(event.id);
    expect(result.current.unreadCount).toBe(0);
    expect(localStorage.getItem("bao-court-summons-acked")).toContain(event.id);
  });

  it("falls back to my 'sent' row when the summonsEventId does not match", async () => {
    const event = makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] });
    relayEvents = [event];
    // Break the exact summonsEventId match: serve a row with a different id.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url).includes("/v1/court/summons-board")) {
        return Response.json({
          data: {
            summons: [
              {
                id: 7,
                caseId: "case-1",
                jurorPubkey: myPubkey,
                kind: "proposal",
                status: "sent",
                summonsEventId: "f".repeat(64), // redelivered/re-registered binding
              },
            ],
          },
        });
      }
      return Response.json({ data: { acked: true } });
    }));
    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    await act(async () => {
      await result.current.ackSummons(result.current.summons[0]!);
    });
    expect(fetchCalls.some((c) => c.url.endsWith("/v1/court/summons/7/ack"))).toBe(true);
  });

  it("returns a soft failure when no summons row exists host-side yet", async () => {
    const event = makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] });
    relayEvents = [event];
    mockFetchBoardAndAck({ noRow: true });
    const { result } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.summons).toHaveLength(1));

    let ackResult: Awaited<ReturnType<typeof result.current.ackSummons>> | undefined;
    await act(async () => {
      ackResult = await result.current.ackSummons(result.current.summons[0]!);
    });
    expect(ackResult!.ok).toBe(false);
    expect(ackResult!.reason).toBe("summons_row_not_found");
    expect(fetchCalls).toHaveLength(1); // board only — never POSTs a blind ack
    expect(result.current.ackedEventIds).toHaveLength(0);
  });

  it("markSeen clears the unread badge and persists the seen set", async () => {
    relayEvents = [
      makeProposalEvent({ caseId: "case-1", marketId: "market-1", rosterPubkeys: [myPubkey] }),
    ];
    const { result, rerender } = renderHook(() => useMySummons());
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      result.current.markSeen();
    });
    rerender();
    expect(result.current.unreadCount).toBe(0);
    expect(localStorage.getItem("bao-court-summons-seen")).toContain(
      result.current.summons[0]!.eventId,
    );
  });
});
