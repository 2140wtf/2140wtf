/**
 * Security round 36 — ingest bounds for the dispute list and the badge list.
 *
 * Round 35 bounded the court-confirmation hook's ingest but left two sibling
 * read paths unbounded, and both parse attacker-influenced relay payloads:
 *
 *  R36-B1 a kind-39000 dispute whose content / tag values are oversized is
 *         rejected before signature verification and before any JSON parse or
 *         {@link sanitizeDisplayText} pass (a relay could answer the 500-event
 *         query with 100k multi-megabyte events),
 *  R36-B2 the dispute list is capped (newest first) whatever the relay returns,
 *  R36-B3 a kind-8 badge acceptance carrying an oversized `a` / `name` tag is
 *         not split/sliced before validation, and the badge list stays capped.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

import type { ReactNode } from "react";
import type { NostrEvent } from "@nostrify/nostrify";

import { MAX_DISPUTES, parseBaoCourtDispute, useBaoCourtDisputes } from "./useBaoCourtDisputes";
import { badgeNameFromEvent, MAX_BADGES } from "./useJurorBadges";
import { BAO_COURT_DISPUTE_KIND } from "@bao/court";

let relayEvents: NostrEvent[] = [];

vi.mock("@nostrify/nostrify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nostrify/nostrify")>();
  class MockNRelay1 {
    constructor(_url: string) {}
    async query() {
      return relayEvents;
    }
    async *req() {
      // no live events
    }
    async close() {}
  }
  return { ...actual, NRelay1: MockNRelay1 };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const seckey = generateSecretKey();
const pubkey = getPublicKey(seckey);

function dispute(content: string, tags: string[][] = [["market", "escrow-1"]]): NostrEvent {
  return finalizeEvent(
    { kind: BAO_COURT_DISPUTE_KIND, created_at: 1_700_000_000, tags, content },
    seckey,
  ) as unknown as NostrEvent;
}

function badgeAcceptance(tags: string[][]): NostrEvent {
  return finalizeEvent(
    { kind: 8, created_at: 1_700_000_000, tags, content: "" },
    seckey,
  ) as unknown as NostrEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  relayEvents = [];
});

describe("R36-B1 — oversized dispute events are rejected, not parsed", () => {
  it("rejects multi-megabyte content", () => {
    const huge = dispute(JSON.stringify({ proposedOutcome: "x", pad: "y".repeat(5_000_000) }));
    expect(parseBaoCourtDispute(huge)).toBeNull();
  });

  it("rejects an oversized tag value", () => {
    const huge = dispute(
      JSON.stringify({ proposedOutcome: "win" }),
      [["market", "escrow-1"], ["proposed", "x".repeat(1_000_000)]],
    );
    expect(parseBaoCourtDispute(huge)).toBeNull();
  });

  it("rejects a tag with a non-array element (malformed shape)", () => {
    const malformed = {
      kind: BAO_COURT_DISPUTE_KIND,
      created_at: 1_700_000_000,
      tags: [["market", "escrow-1"], "not-a-tag"],
      content: "{}",
      pubkey,
      id: "a".repeat(64),
      sig: "f".repeat(128),
    } as unknown as NostrEvent;
    expect(parseBaoCourtDispute(malformed)).toBeNull();
  });

  it("still parses a normal dispute", () => {
    const parsed = parseBaoCourtDispute(
      dispute(JSON.stringify({ proposedOutcome: "seller wins", marketId: "escrow-1" })),
    );
    expect(parsed?.proposedOutcome).toBe("seller wins");
  });
});

describe("R36-B2 — the dispute list is capped however much the relay returns", () => {
  it("keeps the newest MAX_DISPUTES disputes", async () => {
    const caseId = (index: number) => `c${index.toString(16).padStart(63, "0")}`;
    const makeDispute = (index: number): NostrEvent => {
      const event = finalizeEvent(
        {
          kind: BAO_COURT_DISPUTE_KIND,
          created_at: 1_700_000_000 + index,
          tags: [["market", `escrow-${index}`]],
          content: JSON.stringify({
            disputeId: caseId(index),
            proposedOutcome: `outcome-${index}`,
            marketId: `escrow-${index}`,
          }),
        },
        seckey,
      ) as unknown as NostrEvent;
      return event;
    };
    // The relay ignores `limit` and returns more than the client will keep.
    relayEvents = Array.from({ length: MAX_DISPUTES + 25 }, (_, i) => makeDispute(i));

    const { result } = renderHook(() => useBaoCourtDisputes(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));

    expect(result.current.data!.length).toBe(MAX_DISPUTES);
    // Newest first: the highest index survives the cap.
    expect(result.current.data![0]!.disputeId).toBe(caseId(MAX_DISPUTES + 24));
  });
});

describe("R36-B3 — badge names are bounded before parsing", () => {
  it("ignores an oversized `a` tag and falls back to the `name` tag", () => {
    const event = badgeAcceptance([
      ["d", pubkey],
      ["a", "30009:" + "f".repeat(500_000) + ":juror"],
      ["name", "Steady Juror"],
    ]);
    expect(badgeNameFromEvent(event)).toBe("Steady Juror");
  });

  it("returns null when every name source is oversized", () => {
    const event = badgeAcceptance([
      ["d", pubkey],
      ["a", "30009:" + "f".repeat(500_000)],
      ["name", "N".repeat(500_000)],
    ]);
    expect(badgeNameFromEvent(event)).toBeNull();
  });

  it("strips bidi from a badge identifier", () => {
    const event = badgeAcceptance([
      ["d", pubkey],
      ["a", "30009:" + pubkey + ":\u202Ejuror\u202C"],
    ]);
    expect(badgeNameFromEvent(event)).toBe("juror");
  });

  it("keeps the hard badge cap exported for the list bound", () => {
    expect(MAX_BADGES).toBeLessThanOrEqual(64);
  });
});
