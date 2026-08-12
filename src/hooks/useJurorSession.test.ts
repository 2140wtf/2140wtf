import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJurorSession, type UseJurorSessionOptions } from "./useJurorSession";

const publishEventMock = vi.fn(async () => "event-id");

beforeEach(() => {
  publishEventMock.mockClear();
});

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { pubkey: "02" + "a".repeat(64) },
  }),
}));

vi.mock("@/hooks/useNostrPublish", () => ({
  useNostrPublish: () => ({ mutateAsync: publishEventMock }),
}));

vi.mock("@/hooks/useUserSeckey", () => ({
  useUserSeckey: () => undefined,
}));

vi.mock("@nostrify/react", () => ({
  useNostr: () => ({ nostr: {} }),
}));

function makeJuror(idx: number, nostrPubkey: string) {
  const committedAt = 1_700_000_000;
  return {
    idx,
    nostrPubkey,
    stakeCapacitySats: 100_000,
    priority: idx,
    stakeCommitment: {
      amountSats: 100_000,
      bondAddress: "bc1q" + "a".repeat(39),
      bondTxid: "0".repeat(64),
      bondVout: 0,
      status: "confirmed" as const,
      committedAt,
    },
    wotScore: 80,
    categories: ["test"],
    registeredAt: committedAt,
  };
}

function makeOptions(demoMode = true): UseJurorSessionOptions {
  return {
    dispute: {
      disputeId: "d-1",
      marketId: "m-1",
      marketEventId: "me-1",
      challengerPubkey: "02" + "b".repeat(64),
      respondentPubkey: "02" + "c".repeat(64),
      evidenceHashes: [],
      proposedOutcome: "NO",
    },
    selectedJurors: [
      makeJuror(1, "02" + "a".repeat(64)),
      makeJuror(2, "02" + "d".repeat(64)),
      makeJuror(3, "02" + "e".repeat(64)),
    ],
    myJurorIdx: 1,
    demoMode,
    seed: "deterministic-seed-for-testing",
  };
}

describe("useJurorSession", () => {
  it("runs the full demo ceremony and produces an attestation", async () => {
    const { result } = renderHook(() => useJurorSession(makeOptions(true)));

    expect(result.current.state.phase).toBe("selection");

    await act(async () => {
      await result.current.actions.publishDkgCommitment();
    });
    expect(result.current.state.phase).toBe("dkg");
    expect(result.current.state.groupPubkey).toBeTruthy();

    await act(async () => {
      await result.current.actions.publishVoteCommit("NO");
    });
    expect(result.current.state.phase).toBe("vote-commit");
    expect(result.current.state.myVoteCommit).toBeTruthy();

    await act(async () => {
      await result.current.actions.publishVoteReveal();
    });
    expect(result.current.state.phase).toBe("vote-reveal");
    expect(result.current.state.tally?.outcome).toBe("NO");

    await act(async () => {
      await result.current.actions.publishFrostCommitment();
    });
    expect(result.current.state.phase).toBe("signing");

    await act(async () => {
      await result.current.actions.publishFrostReveal();
    });

    await act(async () => {
      await result.current.actions.aggregateAndPublishAttestation();
    });
    expect(result.current.state.phase).toBe("attestation_published");
    expect(result.current.state.attestation).toBeTruthy();
    expect(result.current.state.attestation!.outcome).toBe("NO");
    expect(result.current.state.attestation!.kind).toBe(39007);
  });

  it("throws a clear error for non-demo attestation aggregation after DKG", async () => {
    // First run DKG in demo mode so the DKG record exists.
    const { result, rerender } = renderHook(
      ({ options }) => useJurorSession(options),
      { initialProps: { options: makeOptions(true) } },
    );

    await act(async () => {
      await result.current.actions.publishDkgCommitment();
    });
    expect(result.current.state.phase).toBe("dkg");

    // Switch to non-demo mode while keeping the DKG record in memory.
    rerender({ options: makeOptions(false) });

    await expect(
      act(async () => {
        await result.current.actions.aggregateAndPublishAttestation();
      }),
    ).rejects.toThrow(/Attestation aggregation in non-demo mode is not implemented/);
  });

  it("does nothing in non-demo FROST reveal until peer commitments are available", async () => {
    const { result } = renderHook(() => useJurorSession(makeOptions(false)));

    // Without a local share / DKG record, the action is a no-op rather than a
    // confusing failure. This matches the current hook contract.
    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.actions.publishFrostReveal();
    });
    expect(returnValue).toBeUndefined();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it("throws a clear error when starting a real ceremony without an nsec login", async () => {
    const { result } = renderHook(() => useJurorSession({ ...makeOptions(false), realMode: true }));

    await expect(
      act(async () => {
        await result.current.actions.publishDkgCommitment();
      }),
    ).rejects.toThrow(/Real ceremony requires a local nsec login/);
  });
});
