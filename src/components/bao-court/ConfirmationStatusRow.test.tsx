import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfirmationStatusRow } from "./ConfirmationStatusRow";
import type { CourtConfirmationStatus } from "@/hooks/useCourtConfirmations";

function status(overrides: Partial<CourtConfirmationStatus> = {}): CourtConfirmationStatus {
  return {
    caseId: "c".repeat(64),
    stage: "pending",
    confirmations: 1,
    threshold: 3,
    challenged: false,
    challengeCount: 0,
    proposalEventId: "p".repeat(64),
    batchEventId: null,
    verified: false,
    verifyReason: null,
    finalReason: null,
    ...overrides,
  };
}

describe("ConfirmationStatusRow", () => {
  it("renders the pending stage with the confirmation count", () => {
    render(<ConfirmationStatusRow status={status()} />);
    const row = screen.getByTestId("court-confirmation-status");
    expect(row.getAttribute("data-stage")).toBe("pending");
    expect(row.textContent).toContain("pending");
    expect(row.textContent).toContain("1/3");
    expect(row.textContent).not.toContain("batch verified");
  });

  it("renders confirmed without a batch checkmark", () => {
    render(
      <ConfirmationStatusRow
        status={status({ stage: "confirmed", confirmations: 3 })}
      />,
    );
    expect(screen.getByTestId("court-confirmation-status").getAttribute("data-stage")).toBe(
      "confirmed",
    );
    expect(screen.queryByText(/batch verified/)).toBeNull();
  });

  it("shows the batch-verified checkmark only when verified", () => {
    render(
      <ConfirmationStatusRow
        status={status({
          stage: "final",
          confirmations: 3,
          verified: true,
          finalReason: "batch-attestation",
          batchEventId: "b".repeat(64),
        })}
      />,
    );
    const row = screen.getByTestId("court-confirmation-status");
    expect(row.getAttribute("data-stage")).toBe("final");
    expect(screen.getByText(/batch verified/)).toBeTruthy();
  });

  it("flags challenged cases", () => {
    render(<ConfirmationStatusRow status={status({ challenged: true, challengeCount: 1 })} />);
    expect(screen.getByText("challenged")).toBeTruthy();
  });

  it("documents the sybil trust note on the confirmation count", () => {
    // 10k sybil pubkeys can trivially meet the threshold; the count must be
    // scoped as relay-observed, not claimed to be verified jurors.
    render(
      <ConfirmationStatusRow
        status={status({ stage: "confirmed", confirmations: 10000, threshold: 3 })}
      />,
    );
    const count = screen.getByLabelText("10000 of 3 juror confirmations");
    expect(count.getAttribute("title")).toMatch(/not verified to be empaneled jurors/);
  });

  it("renders nothing without a status", () => {
    const { container } = render(<ConfirmationStatusRow status={null} />);
    expect(container.firstChild).toBeNull();
  });
});
