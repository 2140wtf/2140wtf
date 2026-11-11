/**
 * Security round 1 — hostile-event repro tests for the court confirmation
 * read path. Every test feeds attacker-controlled relay data (kinds 38026 /
 * 39015 / 39016 / 39018) and asserts a fail-closed display outcome:
 *
 *  S1  batch attestation signed by a NON-pinned cohort key must never read
 *      `final` / `batch verified` (spoofed finality),
 *  S2  hostile proof paths (10k siblings, non-hex entries) must fail closed
 *      without throwing (a throw inside a hook can crash the React tree),
 *  S3  oversized events (10MB tag values / content) are dropped at ingest,
 *  S4  conflicting proposals resolve deterministically regardless of
 *      arrival order,
 *  S5  a challenge published AFTER the challenge-deadline does not re-open
 *      a passed window,
 *  S6  sybil confirmations (10k distinct pubkeys) confirm the stage but the
 *      count is honestly scoped (see ConfirmationStatusRow trust note),
 *  S7  hostile content JSON (__proto__ pollution, deep nesting) cannot poll
 *      Object.prototype or crash derivation.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  COURT_OUTCOME_PROPOSAL_KIND,
  COURT_JUROR_CONFIRMATION_KIND,
  COURT_CHALLENGE_KIND,
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

// ---------------------------------------------------------------------------
// In-memory relay mock (no network) - same conventions as useCourtConfirmations.test.ts
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

// The pinned court group key under test (stubbed into the env below).
const COURT_PRIVATE_KEY = hexToBytes("aa".repeat(32));
const COURT_COHORT = bytesToHex(schnorr.getPublicKey(COURT_PRIVATE_KEY));

// The attacker's keypair — NOT the pinned court group.
const ATTACKER_PRIVATE_KEY = hexToBytes("bb".repeat(32));
const ATTACKER_COHORT = bytesToHex(schnorr.getPublicKey(ATTACKER_PRIVATE_KEY));

let nowSec = 1_700_000_400;

function makeEvent(
  kind: number,
  tags: string[][],
  extra: Partial<NostrEvent> = {},
): NostrEvent {
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

/**
 * A NIP-01 signed event for HOOK-level tests: ingest verifies signatures, so
 * an unsigned fixture would be dropped before the size caps were exercised.
 */
function signedEvent(
  kind: number,
  tags: string[][],
  opts: { content?: string; key?: Uint8Array } = {},
): NostrEvent {
  nowSec += 1;
  return finalizeEvent(
    { kind, created_at: nowSec, tags, content: opts.content ?? "" },
    opts.key ?? COURT_PRIVATE_KEY,
  ) as unknown as NostrEvent;
}

function proposalEvent(overrides: Record<string, string> = {}): NostrEvent {
  // Round 35: finality requires the proposal publisher to be the pinned court
  // authority (the group key in these tests); the unattributed case has its
  // own repro tests in useCourtConfirmations.r35.security.test.ts.
  return makeEvent(
    COURT_OUTCOME_PROPOSAL_KIND,
    [
      ["dispute", CASE_ID],
      ["session", SESSION],
      ["outcome", "yes"],
      ...SUPPORTING.map((id) => ["supporting", id] as string[]),
      ...Object.entries(overrides).map(([k, v]) => [k, v] as string[]),
    ],
    { pubkey: COURT_COHORT },
  );
}

function confirmationEvent(pubkey: string): NostrEvent {
  return makeEvent(COURT_JUROR_CONFIRMATION_KIND, [["dispute", CASE_ID]], { pubkey });
}

function caseLeaf(): string {
  return buildBatchMerkleTree([
    hashCourtVerdict({ sessionHash: SESSION, outcome: "yes", supportingEventIds: SUPPORTING }),
  ]).leaves[0]!;
}

/** A correctly signed count-1 batch attestation by the given cohort key. */
function signedBatchEventForCase(privateKey: Uint8Array, cohort: string): NostrEvent {
  const { root } = buildBatchMerkleTree([
    hashCourtVerdict({ sessionHash: SESSION, outcome: "yes", supportingEventIds: SUPPORTING }),
  ]);
  const manifest = hashBatchManifest({
    epoch: 1,
    cohortPubkey: cohort,
    batchIndex: 0,
    count: 1,
    root,
    finalizedAtSec: nowSec,
  });
  const signature = bytesToHex(
    schnorr.sign(hexToBytes(manifest), privateKey, hexToBytes("07".repeat(32))),
  );
  return buildBatchAttestationEvent({
    epoch: 1,
    cohortPubkey: cohort,
    batchIndex: 0,
    count: 1,
    root,
    finalizedAtSec: nowSec,
    signature,
    createdAt: nowSec,
  });
}

function proposalWithBatchProof(batch: NostrEvent): NostrEvent {
  return proposalEvent({
    batch: batch.id,
    "proof-index": "0",
    "proof-path": "",
    "proof-leaf": caseLeaf(),
  });
}

beforeEach(() => {
  backfillEvents = [];
  liveEvents = [];
  vi.clearAllMocks();
  // Tests sign batches with the test cohort key; the hook must pin to it.
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", COURT_COHORT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("S1 — batch attestations from a non-pinned cohort key fail closed", () => {
  it("does NOT mark final/verified when the batch is signed by an attacker key", () => {
    const attackerBatch = signedBatchEventForCase(ATTACKER_PRIVATE_KEY, ATTACKER_COHORT);
    const events = [proposalWithBatchProof(attackerBatch), attackerBatch];

    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.verified).toBe(false);
    expect(status.stage).not.toBe("final");
    expect(status.verifyReason).toMatch(/[Gg]roup pubkey mismatch/);
  });

  it("still verifies a batch signed by the pinned court group key", () => {
    const batch = signedBatchEventForCase(COURT_PRIVATE_KEY, COURT_COHORT);
    const events = [proposalWithBatchProof(batch), batch];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.verified).toBe(true);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("batch-attestation");
  });
});

describe("S2 — hostile proof paths fail closed without throwing", () => {
  it("returns valid:false (not a throw) for a 10k-sibling proof path", () => {
    const batch = signedBatchEventForCase(COURT_PRIVATE_KEY, COURT_COHORT);
    const hostile = proposalEvent({
      batch: batch.id,
      "proof-index": "0",
      "proof-path": Array.from({ length: 10_000 }, (_, i) =>
        (i % 256).toString(16).padStart(2, "0").repeat(32),
      ).join(","),
      "proof-leaf": caseLeaf(),
    });
    expect(() =>
      verifyBatchesForCase(CASE_ID, [hostile, batch]),
    ).not.toThrow();
    const result = verifyBatchesForCase(CASE_ID, [hostile, batch]);
    expect(result.verified).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("returns valid:false for a proof path with non-hex entries", () => {
    const batch = signedBatchEventForCase(COURT_PRIVATE_KEY, COURT_COHORT);
    const hostile = proposalEvent({
      batch: batch.id,
      "proof-index": "0",
      "proof-path": `${"<script>alert(1)</script>".padEnd(64, "x")},zz`,
      "proof-leaf": caseLeaf(),
    });
    expect(() => verifyBatchesForCase(CASE_ID, [hostile, batch])).not.toThrow();
    expect(verifyBatchesForCase(CASE_ID, [hostile, batch]).verified).toBe(false);
  });

  it("never throws (crash the React tree) on a deeply hostile event mix", () => {
    const batch = signedBatchEventForCase(COURT_PRIVATE_KEY, COURT_COHORT);
    const hostileEvents: NostrEvent[] = [
      proposalEvent({
        batch: batch.id,
        "proof-index": "-1",
        "proof-path": "x".repeat(64),
        "proof-leaf": "zz",
      }),
      proposalEvent({
        batch: batch.id,
        "proof-index": "1e999",
        "proof-path": "",
        "proof-leaf": caseLeaf(),
      }),
      batch,
    ];
    expect(() => deriveConfirmationStatus(CASE_ID, hostileEvents, nowSec)).not.toThrow();
    expect(deriveConfirmationStatus(CASE_ID, hostileEvents, nowSec).stage).not.toBe("final");
  });
});

describe("S3 — oversized hostile events are dropped at ingest", () => {
  it("drops an event with a multi-megabyte content field", async () => {
    const hugeCaseId = "e".repeat(64);
    const huge = signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [], {
      // ~10MB of VALID JSON content carrying the case id — the only place it
      // appears (no dispute tag), so ingestion is observable via statuses.
      content: JSON.stringify({
        disputeId: hugeCaseId,
        pad: "A".repeat(10 * 1024 * 1024),
      }),
    });
    backfillEvents = [huge];

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statuses.has(hugeCaseId)).toBe(false);
  });

  it("drops an event with an absurd tag value", async () => {
    const hugeTagCaseId = "f".repeat(64);
    const hugeTag = signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [
      ["dispute", hugeTagCaseId],
      ["outcome", "y".repeat(10 * 1024 * 1024)],
    ]);
    backfillEvents = [hugeTag];

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statuses.has(hugeTagCaseId)).toBe(false);
  });

  it("keeps a small, validly signed event (the size caps are not a deny-all)", async () => {
    const smallCaseId = "d".repeat(64);
    backfillEvents = [
      signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [["dispute", smallCaseId], ["outcome", "yes"]]),
    ];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statuses.has(smallCaseId)).toBe(true);
  });
});

describe("S4 — conflicting proposals resolve deterministically", () => {
  it("breaks created_at ties by event id, independent of arrival order", () => {
    nowSec += 1;
    const ts = nowSec;
    const proposalA = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [
      ["dispute", CASE_ID],
      ["session", SESSION],
      ["outcome", "yes"],
    ]);
    const proposalB = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [
      ["dispute", CASE_ID],
      ["session", SESSION],
      ["outcome", "no"],
    ]);
    // Force the same created_at and known id order.
    proposalA.created_at = ts;
    proposalB.created_at = ts;
    const [lowId] = [proposalA.id, proposalB.id].sort();
    const low = lowId === proposalA.id ? proposalA : proposalB;
    const high = lowId === proposalA.id ? proposalB : proposalA;

    const first = deriveConfirmationStatus(CASE_ID, [low, high], nowSec);
    const second = deriveConfirmationStatus(CASE_ID, [high, low], nowSec);
    expect(first.proposalEventId).toBe(lowId);
    expect(second.proposalEventId).toBe(lowId);
  });

  it("prefers the newest created_at regardless of arrival order", () => {
    const older = proposalEvent();
    const newer = proposalEvent();
    newer.created_at = older.created_at + 100;
    const a = deriveConfirmationStatus(CASE_ID, [older, newer], nowSec);
    const b = deriveConfirmationStatus(CASE_ID, [newer, older], nowSec);
    expect(a.proposalEventId).toBe(newer.id);
    expect(b.proposalEventId).toBe(newer.id);
  });
});

describe("S5 — challenges after the deadline do not re-open a passed window", () => {
  it("keeps final-by-window when the only challenge was published late", () => {
    const deadline = nowSec - 60;
    const lateChallenge = makeEvent(
      COURT_CHALLENGE_KIND,
      [["dispute", CASE_ID]],
      { created_at: deadline + 10 }, // after the deadline
    );
    const events = [proposalEvent({ "challenge-deadline": String(deadline) }), lateChallenge];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("challenge-window");
    // The late challenge is still honestly surfaced as observed.
    expect(status.challenged).toBe(true);
  });

  it("still blocks the window for a challenge published before the deadline", () => {
    const deadline = nowSec - 60;
    const inTimeChallenge = makeEvent(
      COURT_CHALLENGE_KIND,
      [["dispute", CASE_ID]],
      { created_at: deadline - 10 },
    );
    const events = [proposalEvent({ "challenge-deadline": String(deadline) }), inTimeChallenge];
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("pending");
    expect(status.challenged).toBe(true);
  });
});

describe("S6 — sybil confirmations are counted honestly", () => {
  it("counts 10k distinct sybil pubkeys as relay-observed confirmations", () => {
    const events = [proposalEvent()];
    for (let i = 0; i < 10_000; i += 1) {
      events.push(confirmationEvent(i.toString(16).padStart(64, "0")));
    }
    const status = deriveConfirmationStatus(CASE_ID, events, nowSec);
    expect(status.stage).toBe("confirmed");
    expect(status.confirmations).toBe(10_000);
    // Sybils alone must never produce finality.
    expect(status.stage === "final" && status.finalReason === null).toBe(false);
  });
});

describe("S7 — hostile content JSON", () => {
  it("cannot pollute Object.prototype via __proto__ in event content", () => {
    const polluted = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [], {
      content: JSON.stringify({
        disputeId: CASE_ID,
        __proto__: { polluted: "yes" },
        constructor: { prototype: { polluted: "yes" } },
      }),
    });
    expect(() => deriveConfirmationStatus(CASE_ID, [polluted], nowSec)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("survives deeply-nested JSON content without crashing", () => {
    const deep = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [["dispute", CASE_ID]], {
      content: `{"disputeId":"${CASE_ID}","x":${"[".repeat(200_000)}${"]".repeat(200_000)}}`,
    });
    expect(() => deriveConfirmationStatus(CASE_ID, [deep], nowSec)).not.toThrow();
  });

  it("treats malformed content as case-less (no crash, no status)", () => {
    const broken = makeEvent(COURT_OUTCOME_PROPOSAL_KIND, [], {
      content: "{{{not json",
    });
    expect(() => deriveConfirmationStatus(CASE_ID, [broken], nowSec)).not.toThrow();
  });
});
