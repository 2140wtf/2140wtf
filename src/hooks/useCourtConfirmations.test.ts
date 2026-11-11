import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { finalizeEvent } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  COURT_OUTCOME_PROPOSAL_KIND,
  COURT_JUROR_CONFIRMATION_KIND,
  COURT_CHALLENGE_KIND,
  CONFIRMATION_THRESHOLD,
  deriveConfirmationStatus,
  verifyBatchesForCase,
  useCourtConfirmations,
} from "./useCourtConfirmations";
import {
  buildBatchAttestationEvent,
  buildBatchMerkleTree,
  hashBatchManifest,
} from "@/baofund/court-core/batchAttestation";
import { hashCourtVerdict } from "@/baofund/court-core/courtVoteMachine";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ---------------------------------------------------------------------------
// In-memory relay mock (no network) - follows useJurorSession.test.ts
// conventions of module-level vi.mock with per-test fixtures.
// ---------------------------------------------------------------------------

let backfillEvents: NostrEvent[] = [];
let liveEvents: NostrEvent[] = [];

vi.mock("@nostrify/nostrify", () => {
  class MockNRelay1 {
    constructor(_url: string) {}
    async query() {
      return backfillEvents;
    }
    async *req() {
      for (const event of liveEvents) {
        yield ["EVENT", "sub", event] as unknown;
      }
    }
    async close() {}
  }
  return { NRelay1: MockNRelay1 };
});

const CASE_ID = "c".repeat(64);
const SESSION = "11".repeat(32);
const SUPPORTING = ["aa".repeat(32)];

const PRIVATE_KEY = hexToBytes("aa".repeat(32));
const COHORT = bytesToHex(schnorr.getPublicKey(PRIVATE_KEY));

let nowSec = 1_700_000_400;

function makeEvent(kind: number, tags: string[][], extra: Partial<NostrEvent> = {}): NostrEvent {
  nowSec += 1;
  return {
    kind,
    created_at: nowSec,
    tags,
    content: "",
    pubkey: "d".repeat(64),
    id: `id-${kind}-${nowSec}-${Math.random().toString(36).slice(2, 8)}`,
    sig: "f".repeat(128),
    ...extra,
  };
}

function proposalEvent(overrides: Record<string, string> = {}): NostrEvent {
  // Security round 35: finality arms are proposal ASSERTIONS, so a proposal
  // only advances a case to `final` when its publisher is the pinned court
  // authority (the group key here). Fixtures therefore carry the cohort
  // pubkey; the unattributed case has its own tests.
  return makeEvent(
    COURT_OUTCOME_PROPOSAL_KIND,
    [
      ["dispute", CASE_ID],
      ["session", SESSION],
      ["outcome", "yes"],
      ...SUPPORTING.map((id) => ["supporting", id] as string[]),
      ...Object.entries(overrides).map(([k, v]) => [k, v] as string[]),
    ],
    { pubkey: COHORT },
  );
}

/**
 * A NIP-01 signed court event, as a real relay delivers it (the hook verifies
 * signatures at ingest, so hook-level fixtures cannot use placeholder sigs).
 */
function signedEvent(
  kind: number,
  tags: string[][],
  opts: { createdAt?: number; content?: string; key?: Uint8Array } = {},
): NostrEvent {
  nowSec += 1;
  return finalizeEvent(
    {
      kind,
      created_at: opts.createdAt ?? nowSec,
      tags,
      content: opts.content ?? "",
    },
    opts.key ?? PRIVATE_KEY,
  ) as unknown as NostrEvent;
}

/**
 * A distinct juror signing key per index. Confirmations are deduped by PUBKEY,
 * so a shared key would collapse four confirmations into one - the fixture has
 * to produce genuinely different signers to exercise the threshold.
 */
function jurorKey(index: number): Uint8Array {
  return sha256(new TextEncoder().encode(`r35-juror-${index}`));
}

/** Signed kind-39015 confirmation by juror #index. */
function signedConfirmation(index: number, createdAt?: number): NostrEvent {
  return signedEvent(COURT_JUROR_CONFIRMATION_KIND, [["dispute", CASE_ID]], {
    createdAt: createdAt ?? nowSec + 1,
    key: jurorKey(index),
  });
}

/** Signed kind-38026 proposal carrying the batch proof for `batch`. */
function signedProposalWithBatchProof(batch: NostrEvent): NostrEvent {
  const leaf = buildBatchMerkleTree([
    hashCourtVerdict({ sessionHash: SESSION, outcome: "yes", supportingEventIds: SUPPORTING }),
  ]).leaves[0]!;
  return signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [
    ["dispute", CASE_ID],
    ["session", SESSION],
    ["outcome", "yes"],
    ...SUPPORTING.map((id) => ["supporting", id] as string[]),
    ["batch", batch.id],
    ["proof-index", "0"],
    ["proof-path", ""],
    ["proof-leaf", leaf],
  ]);
}

function confirmationEvent(pubkey: string, caseId = CASE_ID): NostrEvent {
  return makeEvent(COURT_JUROR_CONFIRMATION_KIND, [["dispute", caseId]], { pubkey });
}

function challengeEvent(caseId = CASE_ID): NostrEvent {
  return makeEvent(COURT_CHALLENGE_KIND, [["dispute", caseId]]);
}

/** A genuinely signed count-1 batch attestation whose only leaf is our case. */
function signedBatchEventForCase(finalizedAtSec = nowSec): NostrEvent {
  const verdictHash = hashCourtVerdict({
    sessionHash: SESSION,
    outcome: "yes",
    supportingEventIds: SUPPORTING,
  });
  const { root } = buildBatchMerkleTree([verdictHash]);
  const manifest = hashBatchManifest({
    epoch: 1,
    cohortPubkey: COHORT,
    batchIndex: 0,
    count: 1,
    root,
    finalizedAtSec,
  });
  const signature = bytesToHex(
    schnorr.sign(hexToBytes(manifest), PRIVATE_KEY, hexToBytes("07".repeat(32))),
  );
  return buildBatchAttestationEvent({
    epoch: 1,
    cohortPubkey: COHORT,
    batchIndex: 0,
    count: 1,
    root,
    finalizedAtSec,
    signature,
    createdAt: finalizedAtSec,
  });
}

/** Proposal carrying batch-inclusion tags for a count-1 single-case batch. */
function proposalWithBatchProof(batch: NostrEvent): NostrEvent {
  // The `proof-leaf` tag carries the domain-hashed BatchLeaf/v1 value (what
  // verifyCaseInBatch calls proof.verdictHash), not the raw verdict hash.
  const leaf = buildBatchMerkleTree([
    hashCourtVerdict({ sessionHash: SESSION, outcome: "yes", supportingEventIds: SUPPORTING }),
  ]).leaves[0]!;
  return proposalEvent({
    batch: batch.id,
    "proof-index": "0",
    "proof-path": "",
    "proof-leaf": leaf,
  });
}

beforeEach(() => {
  backfillEvents = [];
  liveEvents = [];
  vi.clearAllMocks();
  // Batches are verified against the PINNED court group pubkey; the tests
  // sign with the local COHORT key, so pin the env to it.
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", COHORT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deriveConfirmationStatus (pure derivation)", () => {
  it("is pending with no events observed", () => {
    const status = deriveConfirmationStatus(CASE_ID, [], nowSec);
    expect(status.stage).toBe("pending");
    expect(status.confirmations).toBe(0);
    expect(status.verified).toBe(false);
    expect(status.finalReason).toBeNull();
  });

  it("stays pending below the confirmation threshold and confirms at it", () => {
    const two = [
      proposalEvent(),
      confirmationEvent("a".repeat(64)),
      confirmationEvent("b".repeat(64)),
    ];
    expect(deriveConfirmationStatus(CASE_ID, two, nowSec).stage).toBe("pending");
    expect(deriveConfirmationStatus(CASE_ID, two, nowSec).confirmations).toBe(2);

    const three = [...two, confirmationEvent("e".repeat(64))];
    const status = deriveConfirmationStatus(CASE_ID, three, nowSec);
    expect(status.stage).toBe("confirmed");
    expect(status.threshold).toBe(CONFIRMATION_THRESHOLD);
  });

  it("dedupes confirmations by juror pubkey", () => {
    const events = [
      proposalEvent(),
      confirmationEvent("a".repeat(64)),
      confirmationEvent("a".repeat(64)),
    ];
    expect(deriveConfirmationStatus(CASE_ID, events, nowSec).confirmations).toBe(1);
  });

  it("reaches final via a passed challenge deadline with zero challenges", () => {
    const deadline = nowSec - 60;
    const events = [proposalEvent({ "challenge-deadline": String(deadline) })];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("challenge-window");
  });

  it("does NOT reach final via the window while an in-window challenge is observed", () => {
    const deadline = nowSec + 60; // challenge lands before the deadline passes
    const events = [
      proposalEvent({ "challenge-deadline": String(deadline) }),
      makeEvent(COURT_CHALLENGE_KIND, [["dispute", CASE_ID]], { created_at: deadline - 10 }),
    ];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("pending");
    expect(status.challenged).toBe(true);
    expect(status.challengeCount).toBe(1);
    expect(status.finalReason).toBeNull();
  });

  it("still reaches final via the window when the only challenge was published after the deadline", () => {
    const deadline = nowSec - 60;
    const events = [
      proposalEvent({ "challenge-deadline": String(deadline) }),
      makeEvent(COURT_CHALLENGE_KIND, [["dispute", CASE_ID]], { created_at: deadline + 10 }),
    ];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("challenge-window");
    expect(status.challenged).toBe(true);
  });

  it("does NOT reach final from an unobserved future deadline", () => {
    const events = [proposalEvent({ "challenge-deadline": String(nowSec + 3600) })];
    expect(deriveConfirmationStatus(CASE_ID, events, nowSec).stage).toBe("pending");
  });

  it("reaches final via a verified batch attestation and marks verified", () => {
    const batch = signedBatchEventForCase();
    const events = [proposalWithBatchProof(batch), batch];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("batch-attestation");
    expect(status.verified).toBe(true);
    expect(status.verifyReason).toBeNull();
    expect(status.batchEventId).toBe(batch.id);
  });

  it("fails closed when the referenced batch is not observed", () => {
    const batch = signedBatchEventForCase();
    const events = [proposalWithBatchProof(batch)]; // batch event itself missing
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.verified).toBe(false);
    expect(status.verifyReason).toBe("batch attestation not observed");
    expect(status.stage).toBe("pending");
  });

  it("ignores events for other cases", () => {
    const otherCase = "9".repeat(64);
    const events = [
      proposalEvent(),
      confirmationEvent("a".repeat(64), otherCase),
      challengeEvent(otherCase),
    ];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.confirmations).toBe(0);
    expect(status.challenged).toBe(false);
  });
});

describe("verifyBatchesForCase", () => {
  it("verifies a genuine proof and rejects a tampered one", () => {
    const batch = signedBatchEventForCase();
    const good = proposalWithBatchProof(batch);
    expect(verifyBatchesForCase(CASE_ID, [good, batch])).toMatchObject({
      verified: true,
      attributed: true,
      batchEventId: batch.id,
      reason: null,
      epoch: 1,
      count: 1,
    });

    const tampered = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [
      ["dispute", CASE_ID],
      ["session", SESSION],
      ["outcome", "no"], // different outcome -> different leaf
      ...SUPPORTING.map((id) => ["supporting", id]),
      ["batch", batch.id],
      ["proof-index", "0"],
      ["proof-path", ""],
      ["proof-leaf", "0".repeat(64)],
    ]);
    const result = verifyBatchesForCase(CASE_ID, [tampered, batch]);
    expect(result.verified).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe("useCourtConfirmations (hook, mocked relay)", () => {
  it("ingests backfill, dedupes live events by id, and derives statuses", async () => {
    const batch = signedBatchEventForCase();
    const proposal = signedProposalWithBatchProof(batch);
    const confirmations = [
      signedConfirmation(0, nowSec + 2),
      signedConfirmation(1, nowSec + 3),
      signedConfirmation(2, nowSec + 4),
    ];
    backfillEvents = [proposal, batch, ...confirmations];
    // Live stream re-delivers one already-seen event plus a duplicate-free one.
    liveEvents = [confirmations[0]!, signedConfirmation(3, nowSec + 5)];

    const { result } = renderHook(() => useCourtConfirmations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const status = result.current.statusForCase(CASE_ID);
    expect(status.stage).toBe("final");
    expect(status.verified).toBe(true);
    // 3 distinct backfilled jurors + 1 new live juror; the duplicated
    // confirmation must be deduped by event id, not double-counted.
    expect(status.confirmations).toBe(4);

    expect(result.current.verifyBatchForCase(CASE_ID).verified).toBe(true);
    expect(result.current.statuses.get(CASE_ID)?.stage).toBe("final");

    // Unknown case: pending, no events.
    const unknown = result.current.statusForCase("z".repeat(64));
    expect(unknown.stage).toBe("pending");
    expect(unknown.confirmations).toBe(0);
  });

  it("does not double-count a live-redelivered event (dedupe by event id)", async () => {
    backfillEvents = [signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [["dispute", CASE_ID]])];
    const live = signedConfirmation(9, nowSec + 1);
    liveEvents = [live, live]; // same event id twice in one flush window
    const { result } = renderHook(() => useCourtConfirmations());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      // let the live flush timer run
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(result.current.statusForCase(CASE_ID).confirmations).toBe(1);
  });
});
