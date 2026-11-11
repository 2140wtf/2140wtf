/**
 * Security round 36 — adversarial re-audit of the round-35 court fixes.
 *
 * The round-35 attribution pin, ingest verification and derived-case cap were
 * attacked here with an adversary who knows them:
 *
 *  R36-C1 an UNSIGNED kind-39018 flood (the exemption means such an event needs
 *         no NIP-01 signature at all) used to evict the attributed proposal
 *         from retention, so a genuinely final case read `pending` and vanished
 *         from the status index — the flood was free,
 *  R36-C2 a forged batch (valid outer event, garbage FROST `sig` tag, pin
 *         claimed in `p`/`cohort`) is refused at ingest and, if it somehow
 *         reaches the derivation, refused by `verifyCaseInBatch`,
 *  R36-C3 a batch claiming a DIFFERENT cohort is dropped before any hashing,
 *  R36-C4 a batch observed with no proposal is never finality,
 *  R36-C5 the derived-case cap ranks attributed proposals first, so 300
 *         attacker proposals with lexicographically-smaller case ids cannot
 *         push a court-attributed case out of `statuses` (the card rendered
 *         nothing for it),
 *  R36-C6 the relabelling pin survives the strongest relabel: every leaf input
 *         (session / outcome / supporting) is IDENTICAL, so the crypto really
 *         passes — only the pinned publisher stops the second case reading
 *         final,
 *  R36-C7 the pin is fail-closed for every falsy/malformed configuration
 *         (empty string, whitespace, garbage hex, junk group pin): it resolves
 *         to a real group key, never to "no pin",
 *  R36-C8 a stranger cannot become attributed by publishing an uppercase copy
 *         of a genuine court event (the base58/hex id no longer verifies).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { finalizeEvent } from "nostr-tools";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import type { NostrEvent } from "@nostrify/nostrify";

import {
  COURT_OUTCOME_PROPOSAL_KIND,
  CONFIRMATION_THRESHOLD,
  deriveConfirmationStatus,
  useCourtConfirmations,
  verifyBatchesForCase,
} from "./useCourtConfirmations";
import {
  buildBatchAttestationEvent,
  buildBatchMerkleTree,
  hashBatchManifest,
} from "@/baofund/court-core/batchAttestation";
import { hashCourtVerdict } from "@/baofund/court-core/courtVoteMachine";
import { STANDING_COURT_GROUP_PUBKEY } from "@/baofund/lib/court/courtGroupPubkey";
import { courtProposalPin } from "@/lib/courtPins";

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
const SUPPORTING = ["aa".repeat(32)];

const COURT_KEY = hexToBytes("aa".repeat(32));
const COURT_COHORT = bytesToHex(schnorr.getPublicKey(COURT_KEY));
const ATTACKER_KEY = hexToBytes("bb".repeat(32));
const ATTACKER_COHORT = bytesToHex(schnorr.getPublicKey(ATTACKER_KEY));

let nowSec = 1_700_000_400;
const tick = () => ++nowSec;

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

function verdictHash(outcome = "yes", session = SESSION): string {
  return hashCourtVerdict({ sessionHash: session, outcome, supportingEventIds: SUPPORTING });
}

function batchOver(leaves: readonly string[], opts: { key?: Uint8Array; epoch?: number } = {}) {
  const key = opts.key ?? COURT_KEY;
  const cohort = bytesToHex(schnorr.getPublicKey(key));
  const epoch = opts.epoch ?? 1;
  const createdAt = tick();
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
  }) as unknown as NostrEvent;
}

function leafFor(hash: string): string {
  return buildBatchMerkleTree([hash]).leaves[0]!;
}

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

/** A court-attributed, batch-verified final case for {@link CASE_ID}. */
function attributedFinalCase(): NostrEvent[] {
  const hash = verdictHash();
  const batch = batchOver([hash]);
  const vote = proposalWithProof(batch, leafFor(hash));
  return [batch, vote];
}

/** Kind-39018 with no valid NIP-01 signature (a hostile relay's free flood). */
function unsignedBatch(seed: string, tags?: string[][]): NostrEvent {
  return {
    kind: 39018,
    created_at: tick(),
    tags: tags ?? [
      ["p", COURT_COHORT],
      ["cohort", COURT_COHORT],
      ["count", "1"],
      ["root", "ee".repeat(32)],
    ],
    content: "",
    pubkey: COURT_COHORT,
    id: bytesToHex(sha256(new TextEncoder().encode(seed))),
    sig: "",
  } as unknown as NostrEvent;
}

beforeEach(() => {
  backfillEvents = [];
  liveEvents = [];
  vi.clearAllMocks();
  vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", COURT_COHORT);
  vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", COURT_COHORT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------

describe("R36-C1 — an unsigned batch flood cannot silence a final case", () => {
  it("keeps the attributed final case after 2000 unsigned 39018 events", async () => {
    const marked = attributedFinalCase();
    expect(deriveConfirmationStatus(CASE_ID, marked, nowSec).stage).toBe("final");

    backfillEvents = [
      ...marked,
      ...Array.from({ length: 2_000 }, (_, i) => unsignedBatch(`r36-c1-${i}`)),
    ];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const status = result.current.statusForCase(CASE_ID);
    expect(status.stage).toBe("final");
    expect(status.verified).toBe(true);
    expect(result.current.statuses.has(CASE_ID)).toBe(true);
  });
});

describe("R36-C2 — a forged batch never gets past the ingest exemption", () => {
  it("drops a batch whose FROST `sig` tag is garbage even when it claims the cohort", async () => {
    const hash = verdictHash();
    // Forged batch: valid outer NIP-01 event (attacker-signed), pin claimed in
    // `p`/`cohort`, garbage FROST signature in the `sig` tag.
    const forged = signedEvent(
      39018,
      [
        ["p", COURT_COHORT],
        ["cohort", COURT_COHORT],
        ["sig", "f".repeat(128)],
        ["nonce", "f".repeat(64)],
        ["epoch", "1"],
        ["batch", "0"],
        ["count", "1"],
        ["root", "ee".repeat(32)],
      ],
      { key: ATTACKER_KEY, content: JSON.stringify({ root: "ee".repeat(32), count: 1, epoch: 1, batch: 0 }) },
    );
    // The proposal points at the FORGED batch id, hoping the client treats
    // "a batch event with that id exists" as inclusion.
    const hostileProposal = proposalWithProof(forged, leafFor(hash));

    backfillEvents = [forged, hostileProposal];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const status = result.current.statusForCase(CASE_ID);
    expect(status.stage).not.toBe("final");
    expect(status.verified).toBe(false);
    expect(status.batchAttestationValid).toBe(false);
    // Fail-closed explanation, not silence.
    expect(status.verifyReason).toBeTruthy();
  });

  it("refuses the same forgery at the derivation boundary (defence in depth)", () => {
    const hash = verdictHash();
    const forged = {
      ...unsignedBatch("r36-c2-derive", [
        ["p", COURT_COHORT],
        ["cohort", COURT_COHORT],
        ["sig", "f".repeat(128)],
        ["nonce", "f".repeat(64)],
        ["epoch", "1"],
        ["batch", "0"],
        ["count", "1"],
        ["root", "ee".repeat(32)],
      ]),
    } as NostrEvent;
    const hostileProposal = proposalWithProof(forged, leafFor(hash));
    const status = deriveConfirmationStatus(CASE_ID, [forged, hostileProposal], nowSec);
    expect(status.batchAttestationValid).toBe(false);
    expect(status.verified).toBe(false);
    // Fail-closed reason from the vendored verifier (proof/root/signature).
    expect(status.verifyReason).toMatch(/proof|signature|missing|invalid/i);
  });
});

describe("R36-C3 — a batch claiming another cohort is dropped early", () => {
  it("does not retain a foreign-cohort batch that could evict the real one", async () => {
    const marked = attributedFinalCase();
    const foreign = Array.from({ length: 600 }, (_, i) =>
      unsignedBatch(`r36-c3-${i}`, [
        ["p", ATTACKER_COHORT],
        ["cohort", ATTACKER_COHORT],
        ["count", "1"],
        ["root", "ee".repeat(32)],
      ]),
    );
    backfillEvents = [...foreign, ...marked];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.statusForCase(CASE_ID).stage).toBe("final");
  });
});

describe("R36-C4 — no proposal means no finality", () => {
  it("reports 'no proposal observed' for a batch with no case attribution", () => {
    const batch = batchOver([verdictHash()]);
    const result = verifyBatchesForCase(CASE_ID, [batch]);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("no proposal observed");
  });
});

describe("R36-C5 — the derived-case cap cannot be used to hide a court case", () => {
  it("keeps an attributed case in `statuses` behind 300 attacker proposals", async () => {
    backfillEvents = [
      ...attributedFinalCase(),
      ...Array.from({ length: 300 }, (_, i) =>
        signedEvent(
          COURT_OUTCOME_PROPOSAL_KIND,
          // Ids chosen to sort BEFORE the real case id.
          [["dispute", i.toString(16).padStart(64, "0")], ["outcome", "yes"]],
          { key: ATTACKER_KEY },
        ),
      ),
    ];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.statuses.has(CASE_ID)).toBe(true);
    expect(result.current.statuses.get(CASE_ID)!.stage).toBe("final");
    // The cap still bounds the index.
    expect(result.current.statuses.size).toBeLessThanOrEqual(300);
  });
});

describe("R36-C6 — relabelling with IDENTICAL leaf inputs still needs the pin", () => {
  it("reads crypto-valid but refuses finality for the relabelled case", () => {
    const hash = verdictHash();
    const batch = batchOver([hash]);
    // Same session, outcome and supporting ids as the genuine case, so the leaf
    // matches: the only thing that differs is the `dispute` tag the attacker
    // wants to claim.
    const relabelled = proposalWithProof(batch, leafFor(hash), {
      caseId: OTHER_CASE_ID,
      key: ATTACKER_KEY,
    });
    const victim = deriveConfirmationStatus(OTHER_CASE_ID, [batch, relabelled], nowSec);
    expect(victim.batchAttestationValid).toBe(true);
    expect(victim.attributed).toBe(false);
    expect(victim.verified).toBe(false);
    expect(victim.stage).not.toBe("final");
    expect(victim.verifyReason).toMatch(/not the pinned court authority/);
    // …and the case the batch belongs to stays untouched by the copy.
    expect(deriveConfirmationStatus(CASE_ID, [batch, relabelled], nowSec).stage).toBe("pending");
  });

  it("a genuine (attributed) proposal for the same leaf is what makes it final", () => {
    const hash = verdictHash();
    const batch = batchOver([hash]);
    const genuine = proposalWithProof(batch, leafFor(hash));
    const status = deriveConfirmationStatus(CASE_ID, [batch, genuine], nowSec);
    expect(status.attributed).toBe(true);
    expect(status.verified).toBe(true);
    expect(status.stage).toBe("final");
    expect(status.finalReason).toBe("batch-attestation");
    expect(status.batchEpoch).toBe(1);
    expect(status.batchCount).toBe(1);
  });
});

describe("R36-C7 — the attribution pin is fail-closed for every bad config", () => {
  const junkPins = ["", "   ", "0x" + "a".repeat(62), "not-hex", "a".repeat(63), "a".repeat(65)];

  for (const junk of junkPins) {
    it(`VITE_FUND_COURT_PROPOSAL_PUBKEY=${JSON.stringify(junk)} falls back to the group pin`, () => {
      vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", junk);
      expect(courtProposalPin()).toBe(COURT_COHORT);
    });
  }

  it("never resolves to null, even with junk for both pins", () => {
    vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", "junk");
    vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", "junk");
    expect(courtProposalPin()).toBe(STANDING_COURT_GROUP_PUBKEY);
  });

  it("an attacker proposal is unattributed whatever the pin is", () => {
    const hostile = proposal({ key: ATTACKER_KEY, tags: { "challenge-deadline": "0" } });
    const status = deriveConfirmationStatus(CASE_ID, [hostile], nowSec);
    expect(status.attributed).toBe(false);
    expect(status.stage).toBe("pending");
  });

  it("an empty group pin cannot let a self-signed batch through", () => {
    vi.stubEnv("VITE_FUND_COURT_GROUP_PUBKEY", "");
    vi.stubEnv("VITE_FUND_COURT_PROPOSAL_PUBKEY", "");
    const hash = verdictHash();
    const attackerBatch = batchOver([hash], { key: ATTACKER_KEY });
    const hostile = proposalWithProof(attackerBatch, leafFor(hash), {
      key: ATTACKER_KEY,
      tags: { "challenge-deadline": "0" },
    });
    const status = deriveConfirmationStatus(CASE_ID, [attackerBatch, hostile], nowSec);
    expect(status.verified).toBe(false);
    expect(status.stage).not.toBe("final");
  });
});

describe("R36-C8 — a case-variant copy of a court event cannot be attributed", () => {
  it("drops an uppercase-pubkey copy of a genuine court proposal at ingest", async () => {
    const genuine = proposal({ tags: { "challenge-deadline": "0" } });
    const uppercased: NostrEvent = {
      kind: genuine.kind,
      created_at: genuine.created_at,
      tags: genuine.tags,
      content: genuine.content,
      pubkey: genuine.pubkey.toUpperCase(),
      id: genuine.id,
      sig: genuine.sig,
    };
    backfillEvents = [uppercased];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The id no longer matches the canonical serialisation, so the event is not
    // verified at all — the lowercase pin comparison never sees it.
    expect(result.current.statusForCase(CASE_ID).stage).toBe("pending");
    expect(result.current.statusForCase(CASE_ID).attributed).toBe(false);
  });
});

describe("R36-C10 — a signed confirmation flood cannot evict the court proposal", () => {
  it("keeps the attributed final case through 2000 valid kind-39015 events", async () => {
    const marked = attributedFinalCase();
    const sybil = Array.from({ length: 2_000 }, (_, i) =>
      signedEvent(39015, [["dispute", CASE_ID]], {
        key: sha256(new TextEncoder().encode(`r36-c10-${i}`)),
      }),
    );
    backfillEvents = [...marked, ...sybil];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const status = result.current.statusForCase(CASE_ID);
    // The proposal + batch must survive retention: finality is monotone here.
    expect(status.proposalEventId).toBeTruthy();
    expect(status.stage).toBe("final");
    expect(status.verified).toBe(true);
  });
});

describe("R36-C9 — the confirmation ladder is untouched by the new ingest path", () => {
  it("counts distinct juror confirmations but never mints finality", async () => {
    const confirmations = Array.from({ length: CONFIRMATION_THRESHOLD }, (_, i) =>
      signedEvent(39015, [["dispute", CASE_ID]], {
        key: sha256(new TextEncoder().encode(`r36-sybil-${i}`)),
      }),
    );
    backfillEvents = [...confirmations, proposal({ key: ATTACKER_KEY })];
    const { result } = renderHook(() => useCourtConfirmations());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const status = result.current.statusForCase(CASE_ID);
    expect(status.stage).toBe("confirmed");
    expect(status.verified).toBe(false);
  });
});
