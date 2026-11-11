/**
 * Security round 35 — hostile-event repro tests for the court confirmation
 * read path (kinds 38026 / 39015 / 39016 / 39018), focused on the two
 * finality arms and the ingest trust boundary.
 *
 *  R35-1  a single UNATTRIBUTED proposal with `challenge-deadline: 0` must
 *         never read `final` (before this round: fake finality from one event),
 *  R35-2  a genuinely court-signed batch replayed under another case's
 *         `dispute` tag must not make THAT case final (leaf binds
 *         (session, outcome, supporting) — never the case id),
 *  R35-3  a forged proposal claiming the pinned court pubkey is dropped at
 *         ingest (NIP-01 signature verification),
 *  R35-4  a batch whose ROOT comes from a different case's verdict is rejected
 *         by the proof, however valid its signature,
 *  R35-5  a later hostile proposal cannot flip an attributed `final` back off
 *         (no status flicker / suppression), while the court's own newer
 *         proposal legitimately supersedes,
 *  R35-6  a sybil confirmation flood through the hook confirms the stage but
 *         never produces finality,
 *  R35-7  the verifying batch's epoch/count are surfaced (no silent epoch pin).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent } from "nostr-tools";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  COURT_CHALLENGE_KIND,
  COURT_JUROR_CONFIRMATION_KIND,
  COURT_OUTCOME_PROPOSAL_KIND,
  CONFIRMATION_THRESHOLD,
  deriveConfirmationStatus,
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
// In-memory relay mock (no network)
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
const OTHER_CASE_ID = "d".repeat(64);
const SESSION = "11".repeat(32);
const OTHER_SESSION = "22".repeat(32);
const SUPPORTING = ["aa".repeat(32)];

const COURT_KEY = hexToBytes("aa".repeat(32));
const COURT_COHORT = bytesToHex(schnorr.getPublicKey(COURT_KEY));
const ATTACKER_KEY = hexToBytes("bb".repeat(32));
const ATTACKER_COHORT = bytesToHex(schnorr.getPublicKey(ATTACKER_KEY));

let nowSec = 1_700_000_400;

function tick(): number {
  nowSec += 1;
  return nowSec;
}

function verdictHash(outcome = "yes", session = SESSION): string {
  return hashCourtVerdict({
    sessionHash: session,
    outcome,
    supportingEventIds: SUPPORTING,
  });
}

/** A NIP-01 signed event, as a relay delivers it. */
function signedEvent(
  kind: number,
  tags: string[][],
  opts: { key?: Uint8Array; createdAt?: number; content?: string } = {},
): NostrEvent {
  return finalizeEvent(
    {
      kind,
      created_at: opts.createdAt ?? tick(),
      tags,
      content: opts.content ?? "",
    },
    opts.key ?? COURT_KEY,
  ) as unknown as NostrEvent;
}

/** Signed kind-39015 confirmation by a distinct juror key. */
function signedConfirmation(index: number, caseId = CASE_ID): NostrEvent {
  return signedEvent(
    COURT_JUROR_CONFIRMATION_KIND,
    [["dispute", caseId]],
    { key: sha256(new TextEncoder().encode(`r35-sybil-${index}`)) },
  );
}

interface BatchOptions {
  readonly key?: Uint8Array;
  readonly epoch?: number;
  readonly createdAt?: number;
}

/** A signed kind-39018 batch over the given verdict hashes. */
function batchOver(leaves: readonly string[], opts: BatchOptions = {}): NostrEvent {
  const key = opts.key ?? COURT_KEY;
  const cohort = bytesToHex(schnorr.getPublicKey(key));
  const epoch = opts.epoch ?? 1;
  const createdAt = opts.createdAt ?? tick();
  const { root } = buildBatchMerkleTree(leaves);
  const manifest = hashBatchManifest({
    epoch,
    cohortPubkey: cohort,
    batchIndex: 0,
    count: leaves.length,
    root,
    finalizedAtSec: createdAt,
  });
  const signature = bytesToHex(
    schnorr.sign(hexToBytes(manifest), key, hexToBytes("07".repeat(32))),
  );
  return buildBatchAttestationEvent({
    epoch,
    cohortPubkey: cohort,
    batchIndex: 0,
    count: leaves.length,
    root,
    finalizedAtSec: createdAt,
    signature,
    createdAt,
  });
}

function leafFor(hash: string): string {
  return buildBatchMerkleTree([hash]).leaves[0]!;
}

/** A proposal claiming `caseId`, with optional extra tags. */
function proposal(
  opts: {
    caseId?: string;
    tags?: Record<string, string>;
    key?: Uint8Array;
    outcome?: string;
    session?: string;
    createdAt?: number;
  } = {},
): NostrEvent {
  const tags: string[][] = [
    ["dispute", opts.caseId ?? CASE_ID],
    ["session", opts.session ?? SESSION],
    ["outcome", opts.outcome ?? "yes"],
    ...SUPPORTING.map((id) => ["supporting", id] as string[]),
    ...Object.entries(opts.tags ?? {}),
  ];
  return signedEvent(COURT_OUTCOME_PROPOSAL_KIND, tags, {
    key: opts.key ?? COURT_KEY,
    createdAt: opts.createdAt,
  });
}

/** Attributed proposal carrying a batch-inclusion proof for `leaf`. */
function proposalWithProof(
  batch: NostrEvent,
  leaf: string,
  opts: Parameters<typeof proposal>[0] = {},
): NostrEvent {
  return proposal({
    ...opts,
    tags: {
      batch: batch.id,
      "proof-index": "0",
      "proof-path": "",
      "proof-leaf": leaf,
      ...(opts.tags ?? {}),
    },
  });
}

beforeEach(() => {
  backfillEvents = [];
  liveEvents = [];
  vi.clearAllMocks();
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", COURT_COHORT);
  // Proposal attribution defaults to the group pin; keep it explicit.
  vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", COURT_COHORT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("R35-1 — an unattributed proposal cannot mint finality from a deadline", () => {
  it("does NOT read final from `dispute: X, challenge-deadline: 0` by a stranger", () => {
    const hostile = proposal({
      key: ATTACKER_KEY,
      tags: { "challenge-deadline": "0" },
      createdAt: nowSec - 10,
    });
    const status = deriveConfirmationStatus(CASE_ID, [hostile], nowSec);
    expect(status.attributed).toBe(false);
    expect(status.stage).toBe("pending");
    expect(status.finalReason).toBeNull();
    expect(status.proposalPublisher).toBe(ATTACKER_COHORT);
  });

  it("still closes the window for a proposal from the pinned court authority", () => {
    const legit = proposal({ tags: { "challenge-deadline": "0" } });
    const status = deriveConfirmationStatus(CASE_ID, [legit], nowSec);
    expect(status.attributed).toBe(true);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("challenge-window");
  });

  it("honours VITE_FUND_COURT_PROPOSAL_PUBKEY as a separate coordinator pin", () => {
    vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", ATTACKER_COHORT);
    const coordinatorProposal = proposal({
      key: ATTACKER_KEY,
      tags: { "challenge-deadline": "0" },
    });
    const status = deriveConfirmationStatus(CASE_ID, [coordinatorProposal], nowSec);
    expect(status.attributed).toBe(true);
    expect(status.stage).toBe("final");
  });
});

describe("R35-2 — a genuine batch cannot be relabelled onto another case", () => {
  it("reports crypto validity but refuses finality for the relabelled case", () => {
    const batch = batchOver([verdictHash()]);
    // The attacker copies the court's proof, only changing the `dispute` tag.
    const relabelled = proposalWithProof(batch, leafFor(verdictHash()), {
      caseId: OTHER_CASE_ID,
      key: ATTACKER_KEY,
    });

    const victim = deriveConfirmationStatus(OTHER_CASE_ID, [relabelled, batch], nowSec);
    expect(victim.batchAttestationValid).toBe(true); // crypto really did pass
    expect(victim.verified).toBe(false);
    expect(victim.stage).not.toBe("final");
    expect(victim.verifyReason).toMatch(/not the pinned court authority/);

    // The case the batch actually belongs to is unaffected.
    expect(deriveConfirmationStatus(CASE_ID, [relabelled, batch], nowSec).stage).toBe("pending");
  });

  it("fails closed when the attacker-signed proposal claims the court pubkey but cannot sign", async () => {
    // Raw (unsigned) proposal whose `pubkey` field claims the court key - the
    // exact forgery a hostile relay can serve. Ingest must drop it.
    const forged: NostrEvent = {
      kind: COURT_OUTCOME_PROPOSAL_KIND,
      created_at: tick(),
      tags: [
        ["dispute", CASE_ID],
        ["outcome", "yes"],
        ["challenge-deadline", "0"],
      ],
      content: "",
      pubkey: COURT_COHORT,
      id: "1".repeat(64),
      sig: "f".repeat(128),
    };
    backfillEvents = [forged];

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.statuses.has(CASE_ID)).toBe(false);
    expect(result.current.statusForCase(CASE_ID).stage).toBe("pending");
  });

  it("does not count forged confirmations/challenges attributed to real keys", async () => {
    const forgedJuror = "e".repeat(64);
    const forgedConfirmation: NostrEvent = {
      kind: COURT_JUROR_CONFIRMATION_KIND,
      created_at: tick(),
      tags: [["dispute", CASE_ID]],
      content: "",
      pubkey: forgedJuror,
      id: "2".repeat(64),
      sig: "f".repeat(128),
    };
    const forgedChallenge: NostrEvent = {
      kind: COURT_CHALLENGE_KIND,
      created_at: tick(),
      tags: [["dispute", CASE_ID]],
      content: "",
      pubkey: forgedJuror,
      id: "3".repeat(64),
      sig: "f".repeat(128),
    };
    backfillEvents = [forgedConfirmation, forgedChallenge];

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const status = result.current.statusForCase(CASE_ID);
    expect(status.confirmations).toBe(0);
    expect(status.challenged).toBe(false);
  });
});

describe("R35-4 — a valid signature over a DIFFERENT case's root is rejected", () => {
  it("rejects a court-signed batch whose root covers another case's verdict", () => {
    // The batch is genuinely court-signed, but its only leaf is the OTHER
    // case's verdict; the proposal still claims this case's verdict.
    const foreignBatch = batchOver([verdictHash("yes", OTHER_SESSION)]);
    const hostile = proposalWithProof(foreignBatch, leafFor(verdictHash()));

    const status = deriveConfirmationStatus(CASE_ID, [hostile, foreignBatch], nowSec);
    expect(status.batchAttestationValid).toBe(false);
    expect(status.verified).toBe(false);
    expect(status.stage).toBe("pending");
    expect(status.verifyReason).toBeTruthy();
  });

  it("rejects a proof whose index points at a sibling leaf", () => {
    // Two-leaf batch: claiming index 0 while carrying leaf #1's value.
    const ours = verdictHash();
    const theirs = verdictHash("no");
    const twoLeaf = batchOver([ours, theirs]);
    const { leaves } = buildBatchMerkleTree([ours, theirs].sort());
    const wrongLeaf = leaves.find((leaf) => leaf !== leafFor(ours))!;
    const hostile = proposalWithProof(twoLeaf, wrongLeaf);

    const status = deriveConfirmationStatus(CASE_ID, [hostile, twoLeaf], nowSec);
    expect(status.verified).toBe(false);
    expect(status.stage).not.toBe("final");
  });
});

describe("R35-5 — contradictory events do not flicker an attributed final", () => {
  it("keeps the court's final when a newer hostile proposal appears", () => {
    const batch = batchOver([verdictHash()]);
    const legit = proposalWithProof(batch, leafFor(verdictHash()));
    // Hostile, newer, no evidence at all - tries to suppress / re-open.
    const hostile = proposal({
      key: ATTACKER_KEY,
      createdAt: legit.created_at + 10_000,
      outcome: "no",
    });

    const after = deriveConfirmationStatus(CASE_ID, [legit, batch, hostile], nowSec);
    expect(after.proposalEventId).toBe(legit.id);
    expect(after.stage).toBe("final");
    expect(after.verified).toBe(true);

    // Order independence: the same set in the other order agrees.
    const before = deriveConfirmationStatus(CASE_ID, [hostile, batch, legit], nowSec);
    expect(before.stage).toBe("final");
    expect(before.proposalEventId).toBe(legit.id);
  });

  it("lets the court's own newer proposal supersede (documented, not flicker)", () => {
    const first = proposal({ tags: { "challenge-deadline": "0" }, createdAt: nowSec - 100 });
    expect(deriveConfirmationStatus(CASE_ID, [first], nowSec).stage).toBe("final");

    // The court re-proposes with a fresh future window and no confirmations:
    // the ladder legitimately re-opens (this is a re-opened case, not a
    // hostile flip - the newer proposal is attributed).
    const reopened = proposal({ tags: { "challenge-deadline": String(nowSec + 3600) } });
    const status = deriveConfirmationStatus(CASE_ID, [first, reopened], nowSec);
    expect(status.attributed).toBe(true);
    expect(status.stage).toBe("pending");
    expect(status.finalReason).toBeNull();
  });
});

describe("R35-6 — a sybil confirmation flood confirms but never finalises", () => {
  it("counts signed sybils, caps the stage at confirmed, and keeps the trust note", async () => {
    const flood: NostrEvent[] = [];
    for (let i = 0; i < 60; i += 1) flood.push(signedConfirmation(i));
    backfillEvents = [proposal(), ...flood];

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const status = result.current.statusForCase(CASE_ID);
    expect(status.confirmations).toBe(60);
    expect(status.confirmations).toBeGreaterThanOrEqual(CONFIRMATION_THRESHOLD);
    expect(status.stage).toBe("confirmed");
    expect(status.finalReason).toBeNull();
    expect(status.verified).toBe(false);
  });
});

describe("R35-7 — the verified batch's epoch and count are surfaced", () => {
  it("reports epoch/count instead of silently pinning them", () => {
    const batch = batchOver([verdictHash()], { epoch: 42 });
    const legit = proposalWithProof(batch, leafFor(verdictHash()));
    const status = deriveConfirmationStatus(CASE_ID, [legit, batch], nowSec);
    expect(status.verified).toBe(true);
    expect(status.batchEpoch).toBe(42);
    expect(status.batchCount).toBe(1);
    expect(status.finalReason).toBe("batch-attestation");
  });
});

describe("R35-8 — a challenge flood can only delay, never finalise", () => {
  it("counts challenges from any verified key, which blocks the window but cannot mint finality", () => {
    // Accepted behaviour (documented): a challenge is a party action, so it is
    // counted from ANY verified publisher. The direction is fail-closed - the
    // worst a flood achieves is keeping a case at `pending`, never `final`.
    const flood: NostrEvent[] = [];
    for (let i = 0; i < 10; i += 1) {
      flood.push(
        signedEvent(COURT_CHALLENGE_KIND, [["dispute", CASE_ID]], {
          key: sha256(new TextEncoder().encode(`r35-challenger-${i}`)),
          createdAt: nowSec - 100,
        }),
      );
    }
    const legit = proposal({ tags: { "challenge-deadline": String(nowSec - 60) } });
    const status = deriveConfirmationStatus(CASE_ID, [legit, ...flood], nowSec);
    expect(status.challenged).toBe(true);
    expect(status.challengeCount).toBe(10);
    expect(status.stage).toBe("pending");
    expect(status.finalReason).toBeNull();
  });
});

describe("R35-9 — the derived status index is bounded", () => {
  it("does not derive a status for every one of 400 invented case ids", async () => {
    // Each derivation scans all retained events, so an unbounded index turns
    // every relay flush into O(cases x events).
    const flood: NostrEvent[] = [];
    for (let i = 0; i < 400; i += 1) {
      flood.push(
        signedEvent(COURT_OUTCOME_PROPOSAL_KIND, [
          ["dispute", i.toString(16).padStart(64, "0")],
          ["outcome", "yes"],
        ]),
      );
    }
    backfillEvents = flood;

    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statuses.size).toBeLessThanOrEqual(300);
    // On-demand derivation still answers for any case id.
    expect(result.current.statusForCase(flood[399]!.tags[0]![1]!).stage).toBe("pending");
  });
});
