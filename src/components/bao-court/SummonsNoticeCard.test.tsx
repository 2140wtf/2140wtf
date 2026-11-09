import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SummonsNoticeCard } from "./SummonsNoticeCard";
import { SUMMONS_PROPOSAL_KIND, SUMMONS_SELECTION_KIND, type CourtSummonsNotice } from "@/hooks/useMySummons";

const EVENT_A = "a".repeat(64);
const EVENT_B = "b".repeat(64);

function notice(overrides: Partial<CourtSummonsNotice> = {}): CourtSummonsNotice {
  return {
    eventId: EVENT_A,
    kind: SUMMONS_PROPOSAL_KIND,
    caseId: "case-1234",
    marketId: "market-1",
    proposedOutcome: "YES",
    createdAt: Math.floor(Date.now() / 1000) - 60,
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof SummonsNoticeCard>[0]> = {}) {
  return render(
    <SummonsNoticeCard
      notices={[notice()]}
      ackedEventIds={[]}
      pendingAckEventId={null}
      ackError={null}
      onAck={vi.fn()}
      onDismiss={vi.fn()}
      {...props}
    />,
  );
}

describe("SummonsNoticeCard", () => {
  it("renders nothing when every summons is already acked/absent", () => {
    const { container } = renderCard({ notices: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the summons with kind label, case id and a pending badge count", () => {
    renderCard({
      notices: [notice(), notice({ eventId: EVENT_B, kind: SUMMONS_SELECTION_KIND, caseId: "disp-9" })],
    });
    expect(screen.getByText("You've been summoned")).toBeInTheDocument();
    expect(screen.getByText("Court summons")).toBeInTheDocument();
    expect(screen.getByText("Jury selection")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText(/Case case-1234/)).toBeInTheDocument();
  });

  it("one click on Acknowledge calls onAck with that notice", () => {
    const onAck = vi.fn();
    const target = notice();
    renderCard({ notices: [target], onAck });
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(onAck).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("shows the in-flight state and disables the button while acking", () => {
    renderCard({ pendingAckEventId: EVENT_A });
    const button = screen.getByRole("button", { name: "Acknowledging…" });
    expect(button).toBeDisabled();
  });

  it("hides already-acked summons from the actionable list", () => {
    renderCard({
      notices: [notice(), notice({ eventId: EVENT_B, kind: SUMMONS_SELECTION_KIND, caseId: "disp-9" })],
      ackedEventIds: [EVENT_A],
    });
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.queryByText("Court summons")).not.toBeInTheDocument();
  });

  it("Dismiss calls onDismiss (marks seen — never acks)", () => {
    const onDismiss = vi.fn();
    renderCard({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("surfaces an ack failure message", () => {
    renderCard({ ackError: "ack HTTP 503" });
    expect(screen.getByText("Ack failed: ack HTTP 503")).toBeInTheDocument();
  });
});
