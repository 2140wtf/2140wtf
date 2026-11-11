/**
 * Security round 35 — display bounding for dispute outcome strings.
 *
 * Kind-39000 dispute events are relay data: `proposedOutcome` / `originalOutcome`
 * are attacker-chosen strings rendered in the JurorDashboard row, the dispute
 * card and the juror session modal. Round 1 collapsed newlines and capped the
 * length; round 35 also strips bidi overrides and zero-width characters, so a
 * hostile outcome cannot be reordered or disguised inside a status row.
 *
 * NB: the values must stay UNMODIFIED for verdict hashing (the escrow release
 * gate signs over `proposedOutcome`), so this guard lives at the parse/display
 * boundary only.
 */
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import { parseBaoCourtDispute, sanitizeSingleLine } from "./useBaoCourtDisputes";
import { BAO_COURT_DISPUTE_KIND } from "@bao/court";

function disputeEvent(content: Record<string, unknown>): NostrEvent {
  return finalizeEvent(
    {
      kind: BAO_COURT_DISPUTE_KIND,
      created_at: 1_700_000_000,
      tags: [["market", "escrow-1"]],
      content: JSON.stringify(content),
    },
    generateSecretKey(),
  ) as unknown as NostrEvent;
}

describe("R35 — dispute outcome strings are display-bounded", () => {
  it("strips bidi overrides and control characters from an outcome", () => {
    const parsed = parseBaoCourtDispute(
      disputeEvent({ proposedOutcome: "buyer\u202E\nwin\u0007s", marketId: "escrow-1" }),
    )!;
    // Bidi overrides are REMOVED (they reorder glyphs); control characters
    // become separators so they cannot glue two words into one.
    expect(parsed.proposedOutcome).toBe("buyer win s");
    const hasBidiOrControl = Array.from(parsed.proposedOutcome).some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (code >= 0x202a && code <= 0x202e) || code <= 0x1f;
    });
    expect(hasBidiOrControl).toBe(false);
  });

  it("caps an oversized outcome", () => {
    const parsed = parseBaoCourtDispute(
      disputeEvent({ proposedOutcome: "y".repeat(5_000), marketId: "escrow-1" }),
    )!;
    expect(parsed.proposedOutcome.length).toBeLessThanOrEqual(101);
  });

  it("keeps plain outcomes intact", () => {
    expect(sanitizeSingleLine("seller wins")).toBe("seller wins");
  });
});
