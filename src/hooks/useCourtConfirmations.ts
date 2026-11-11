/**
 * useCourtConfirmations - P1 read path for the universal-confirmation flow.
 *
 * Subscribes to the planned universal-confirmation event kinds on the BAO
 * Court relay and derives a per-dispute confirmation status from OBSERVED
 * events only:
 *
 * - kind 38026 - outcome proposals (a case enters the flow via its proposal)
 * - kind 39015 - juror confirmations
 * - kind 39016 - challenges
 * - kind 39018 - epoch batch attestations (vendored court-core validator)
 *
 * ## Derivation rule (documented contract)
 *
 * For a dispute id, the status ladder is `pending -> confirmed -> final`,
 * always evaluated from events actually observed on the relay - never from
 * assumed relays, assumed cohort behaviour, or clock-only inference:
 *
 * - `pending`   - default. A proposal may or may not be observed; fewer than
 *   CONFIRMATION_THRESHOLD distinct juror confirmations (kind 39015, deduped
 *   by juror pubkey) are seen for the case.
 * - `confirmed` - at least CONFIRMATION_THRESHOLD distinct kind-39015
 *   confirmations observed for the case.
 * - `final`     - EITHER
 *     (a) a kind-39018 batch attestation is observed AND the case's
 *         Merkle proof (carried on the case's kind-38026 proposal via the
 *         `batch` / `proof-index` / `proof-path` tags) verifies against the
 *         case verdict with the vendored `verifyCaseInBatch`, OR
 *     (b) the proposal carries an observed `challenge-deadline` tag, that
 *         deadline has passed, and NO kind-39016 challenge was observed for
 *         the case that was published within the window (an in-window
 *         challenge re-opens the ladder; a challenge published after the
 *         deadline is still displayed as `challenged` but cannot re-open a
 *         passed window).
 *
 * `verified: true` is set ONLY when the batch path (a) succeeded
 * fail-closed against the PINNED court group pubkey
 * (`fundCourtGroupPubkey()`); a batch attestation signed by any other key
 * (or a batch tag without a proof, or a failing proof) is reported via
 * `verifyReason` and never counts as finality.
 *
 * ## Attribution pin (security round 35)
 *
 * Both finality arms are **assertions made by a proposal event**, and before
 * round 35 the hook trusted whoever published that proposal:
 *
 * - the batch arm's leaf binds `(sessionHash, outcome, supportingEventIds)`
 *   but NOT the case id, so replaying a genuinely court-signed batch + proof
 *   under a `dispute` tag naming any other case displayed that case `final`;
 * - the window arm trusted a `challenge-deadline` from the same hostile
 *   event, so a single proposal (`dispute: X`, `challenge-deadline: 0`) read
 *   `final` with zero evidence.
 *
 * A case therefore reads `final` ONLY when the winning proposal is published
 * by the pinned court authority ({@link courtProposalPin}) - the empaneled
 * FROST group key by default, overridable with
 * `VITE_FUND_COURT_PROPOSAL_PUBKEY` for a coordinator-published flow. Any
 * other publisher may still *propose* (confirmations are counted, the reason
 * is shown), but never finality: `verified` stays false and `verifyReason`
 * names the reason. `attributed` reports the publisher decision separately
 * from `batchAttestationValid` (the pure crypto result), so the UI can say
 * "cryptographically valid, publisher not pinned" instead of guessing.
 *
 * ## Epoch / replay pins
 *
 * The signed manifest already binds `epoch`, `cohort`, `batchIndex`, `count`,
 * `root` and `finalizedAt`, and `verifyCaseInBatch` re-derives the root from
 * the proof and recomputes the event id - a batch built for another case's
 * verdict cannot contain this case's leaf (the proof is rejected), and a
 * batch from another cohort fails the group-key pin. Because only the pinned
 * authority may assert the case attribution, an `expectedEpoch` pin is not
 * required: the epoch is whatever the pinned authority signed, and it is
 * *surfaced* (`batchEpoch`, `batchCount`) for audit rather than silently
 * assumed. Accepted behaviour: a re-batching of the same verdict in a later
 * epoch is legitimate and reads `final` again.
 *
 * ## Ingest trust
 *
 * Kinds 38026 / 39015 / 39016 are NIP-01 signed events and are verified
 * (`verifyEvent`) at ingest - a hostile relay must not be able to forge a
 * confirmation attributed to a real juror, a challenge, or a proposal
 * claiming the court group's pubkey. Kind 39018 is deliberately NOT
 * NIP-01-verified: a batch attestation carries the cohort's FROST signature
 * over the manifest in its `sig` TAG, so `verifyCaseInBatch` is its
 * authenticity check (see the note above the ingest filter).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NRelay1, type NostrEvent, type NostrFilter } from "@nostrify/nostrify";

import {
  BAO_COURT_BATCH_ATTESTATION_KIND,
  verifyCaseInBatch,
  type BatchMerkleProof,
} from "@/baofund/court-core/batchAttestation";
import { isVerifiedEvent } from "@/lib/nostrEvents";
import { courtGroupPin, courtProposalPin } from "@/lib/courtPins";

// Re-exported for callers that reason about the trust anchor directly.
export { courtProposalPin };

/** Universal-confirmation outcome proposal (planned kind). */
export const COURT_OUTCOME_PROPOSAL_KIND = 38026;
/** Juror confirmation of an outcome proposal (planned kind). */
export const COURT_JUROR_CONFIRMATION_KIND = 39015;
/** Challenge against a confirmed proposal (planned kind). */
export const COURT_CHALLENGE_KIND = 39016;

/** Distinct juror confirmations required before a case reads `confirmed`. */
export const CONFIRMATION_THRESHOLD = 3;

const RELAY = "wss://relay.bao.markets";
const QUERY_LIMIT = 500;
const QUERY_TIMEOUT_MS = 15_000;
const LIVE_BATCH_MS = 1_000;
/** Hard cap on retained events so a runaway relay cannot grow state forever. */
const MAX_EVENTS = 2_000;
/**
 * Ingest size caps. A hostile relay can otherwise park 10MB tag values or
 * multi-megabyte content in every retained event (2000 events x 10MB = 20GB
 * of React-reachable memory). Legitimate court events are far smaller.
 */
const MAX_EVENT_CONTENT_CHARS = 65_536;
const MAX_EVENT_TAGS = 256;
const MAX_EVENT_TAG_VALUE_CHARS = 8_192;
/**
 * Cap on eagerly derived cases per render. `statuses` re-derives every known
 * case on each event batch (each derivation scans all retained events), so a
 * relay that parks 2 000 proposal events for 2 000 distinct case ids would
 * otherwise make every flush O(cases x events). Consumers that need a specific
 * case use `statusForCase(id)` (uncapped); the map is a convenience index.
 */
const MAX_DERIVED_CASES = 300;

export type CourtConfirmationStage = "pending" | "confirmed" | "final";

export interface CourtConfirmationStatus {
  readonly caseId: string;
  readonly stage: CourtConfirmationStage;
  /** Distinct juror confirmations observed (kind 39015, deduped by pubkey). */
  readonly confirmations: number;
  readonly threshold: number;
  readonly challenged: boolean;
  /** Distinct challenge events observed for the case (kind 39016). */
  readonly challengeCount: number;
  /** Event id of the observed kind-38026 proposal, when present. */
  readonly proposalEventId: string | null;
  /** Pubkey that published the winning proposal, when present. */
  readonly proposalPublisher: string | null;
  /**
   * True when the winning proposal is published by the pinned court
   * authority ({@link courtProposalPin}). Only an attributed proposal may
   * assert finality.
   */
  readonly attributed: boolean;
  /** Event id of the kind-39018 batch the proposal claims inclusion in. */
  readonly batchEventId: string | null;
  /** Pure crypto result: the batch + proof verified against the group pin. */
  readonly batchAttestationValid: boolean;
  /**
   * True ONLY when the batch path succeeded fail-closed against the PINNED
   * court group pubkey AND the winning proposal is attributed. This - not
   * `batchAttestationValid` - is what the UI shows as verified finality.
   */
  readonly verified: boolean;
  /** Fail-closed explanation when a batch was referenced but not verified. */
  readonly verifyReason: string | null;
  /** Epoch of the verifying batch (surfaced for audit; not pinned). */
  readonly batchEpoch: number | null;
  /** Declared verdict count of the verifying batch. */
  readonly batchCount: number | null;
  /** Which observed-evidence rule produced `final`, when it did. */
  readonly finalReason: "batch-attestation" | "challenge-window" | null;
}


function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags?.find((t) => t[0] === name)?.[1];
}

function getTagAll(event: NostrEvent, name: string): string[] {
  return (event.tags ?? [])
    .filter((t) => t[0] === name && typeof t[1] === "string")
    .map((t) => t[1] as string);
}

function isHex64(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

/**
 * An event within the ingest size caps (see MAX_EVENT_* constants), or null
 * when a hostile relay sent an oversized event.
 */
function sizeCapped(event: NostrEvent): NostrEvent | null {
  if (typeof event.content === "string" && event.content.length > MAX_EVENT_CONTENT_CHARS) {
    return null;
  }
  if (!Array.isArray(event.tags) || event.tags.length > MAX_EVENT_TAGS) return null;
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) return null;
    for (const value of tag) {
      if (typeof value === "string" && value.length > MAX_EVENT_TAG_VALUE_CHARS) return null;
    }
  }
  return event;
}

/** The dispute/case id an event refers to, or null when it carries none. */
const caseIdCache = new WeakMap<NostrEvent, string | null>();

export function eventCaseId(event: NostrEvent): string | null {
  const cached = caseIdCache.get(event);
  if (cached !== undefined) return cached;
  let result: string | null = null;
  const tagged = getTag(event, "dispute");
  if (tagged) {
    result = tagged;
  } else {
    try {
      const content = JSON.parse(event.content || "{}") as Record<string, unknown>;
      const id = content.disputeId ?? content.caseId;
      if (typeof id === "string" && id.length > 0) result = id;
    } catch {
      // Malformed content - fall through.
    }
  }
  caseIdCache.set(event, result);
  return result;
}

export interface ObservedBatchProof {
  readonly batchEventId: string;
  readonly proof: BatchMerkleProof;
}

/**
 * Extract the batch-inclusion proof a kind-38026 proposal carries, if any.
 * Returns null unless every required tag is present and well-formed.
 */
export function proposalBatchProof(proposal: NostrEvent): ObservedBatchProof | null {
  const batchEventId = getTag(proposal, "batch");
  const indexRaw = getTag(proposal, "proof-index");
  const pathRaw = getTag(proposal, "proof-path");
  const leaf = getTag(proposal, "proof-leaf");
  if (!isHex64(batchEventId) || !isHex64(leaf) || indexRaw == null || pathRaw == null) {
    return null;
  }
  const index = Number(indexRaw);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  // An empty path is valid for a count-1 batch (a single leaf needs no
  // siblings); any listed sibling must be a 64-hex hash. The path is capped
  // defensively: a count<=10000 RFC-6962 tree needs at most ~14 siblings,
  // so anything longer is hostile padding (bounds the split + fold work).
  const path = pathRaw.split(",").filter((s) => s.length > 0);
  if (path.length > 64) return null;
  if (!path.every(isHex64)) return null;
  // NB: `proof-leaf` is the domain-hashed BatchLeaf/v1 value (what
  // verifyCaseInBatch calls proof.verdictHash), NOT the raw court verdict
  // hash - the vendored proof format carries domain-hashed leaves.
  return { batchEventId, proof: { index, verdictHash: leaf, path } };
}

function caseInputFromProposal(proposal: NostrEvent): {
  sessionHash: string;
  outcome: string;
  supportingEventIds: string[];
} | null {
  const sessionHash = getTag(proposal, "session");
  const outcome = getTag(proposal, "outcome");
  if (!isHex64(sessionHash) || !outcome) return null;
  const supportingEventIds = getTagAll(proposal, "supporting").filter(isHex64);
  return { sessionHash, outcome, supportingEventIds };
}

/**
 * The court group pubkey every kind-39018 batch attestation MUST be signed
 * by. Verification is pinned to the empaneled standing FROST group key
 * (`fundCourtGroupPubkey()`, overridable via VITE_FUND_COURT_GROUP_PUBKEY);
 * without the pin ANY keypair holder could self-sign a batch attestation
 * and the client would display "final / batch verified" for a case the
 * court never finalized. See `@/lib/courtPins`.
 */
function courtBatchPin(): string | null {
  return courtGroupPin();
}

/**
 * The pubkey allowed to assert a case's attribution (the `dispute` tag on a
 * kind-38026 proposal that carries a batch proof or a challenge deadline).
 * See `@/lib/courtPins#courtProposalPin` - it defaults to the group key.
 */

export interface BatchVerification {
  /** Crypto result: proof + manifest signature + group pin all passed. */
  readonly verified: boolean;
  /** True when the batch was published by the pinned group key (attribution). */
  readonly attributed: boolean;
  readonly batchEventId: string | null;
  readonly reason: string | null;
  readonly epoch: number | null;
  readonly count: number | null;
}

/**
 * Verify every observed kind-39018 batch attestation against one case's
 * verdict using the vendored court-core `verifyCaseInBatch`, pinned to the
 * court's group pubkey. Returns the first PASSING verification, else the
 * LAST failure reason (fail-closed: nothing observed means
 * { verified: false }). Never throws on hostile protocol data.
 *
 * `attributed` is set when the winning proposal's publisher IS the pinned
 * court authority. `verified` is the pure crypto check; callers decide
 * whether unattributed (but cryptographically valid) inclusion may advance a
 * case's stage - {@link deriveConfirmationStatus} does not let it.
 */
export function verifyBatchesForCase(
  caseId: string,
  events: readonly NostrEvent[],
): BatchVerification {
  const proposal = latestProposal(caseId, events);
  if (!proposal) {
    return {
      verified: false,
      attributed: false,
      batchEventId: null,
      reason: "no proposal observed",
      epoch: null,
      count: null,
    };
  }
  const attributed = isAttributedProposal(proposal);
  const caseInput = caseInputFromProposal(proposal);
  const observed = proposalBatchProof(proposal);
  if (!caseInput || !observed) {
    return {
      verified: false,
      attributed,
      batchEventId: null,
      reason: "proposal carries no verifiable batch proof",
      epoch: null,
      count: null,
    };
  }

  const batches = events.filter(
    (e) => e.kind === BAO_COURT_BATCH_ATTESTATION_KIND && e.id === observed.batchEventId,
  );
  if (batches.length === 0) {
    return {
      verified: false,
      attributed,
      batchEventId: observed.batchEventId,
      reason: "batch attestation not observed",
      epoch: null,
      count: null,
    };
  }

  const pin = courtBatchPin();
  let lastReason: string | null = null;
  for (const batch of batches) {
    try {
      const result = verifyCaseInBatch(
        batch,
        { ...caseInput, proof: observed.proof },
        pin ? { expectedGroupPubkey: pin } : undefined,
      );
      if (result.valid) {
        return {
          verified: true,
          attributed,
          batchEventId: batch.id,
          reason: null,
          epoch: tagNumber(batch, "epoch"),
          count: tagNumber(batch, "count"),
        };
      }
      lastReason = result.reason ?? null;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    verified: false,
    attributed,
    batchEventId: observed.batchEventId,
    reason: lastReason,
    epoch: null,
    count: null,
  };
}

/** A decimal tag value as a safe non-negative integer, or null. */
function tagNumber(event: NostrEvent, name: string): number | null {
  const raw = getTag(event, name);
  if (raw == null || !/^[0-9]+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * True when the event's publisher is the pinned court authority. Used for
 * BOTH proposal attribution and the batch publisher check: an unattributed
 * proposal cannot assert a case's finality however well-formed its tags are.
 */
function isAttributedProposal(proposal: NostrEvent): boolean {
  const pin = courtProposalPin();
  if (!pin) return false;
  return typeof proposal.pubkey === "string" && proposal.pubkey.toLowerCase() === pin;
}

/**
 * The winning kind-38026 proposal for a case: newest created_at wins;
 * created_at ties break deterministically by the lexicographically smaller
 * event id, so two clients observing the same hostile event set agree on
 * the SAME proposal regardless of relay delivery order.
 *
 * Attributed proposals (published by the pinned court authority) always beat
 * unattributed ones, regardless of created_at. Without that rule a hostile
 * publisher could suppress an already-final case - or pre-empt a court
 * re-proposal - by posting a newer proposal with no evidence, making the row
 * flicker away from `final` on every hostile event.
 */
function latestProposal(caseId: string, events: readonly NostrEvent[]): NostrEvent | null {
  let latest: NostrEvent | null = null;
  let latestAttributed: NostrEvent | null = null;
  for (const event of events) {
    if (event.kind !== COURT_OUTCOME_PROPOSAL_KIND) continue;
    if (eventCaseId(event) !== caseId) continue;
    if (isNewerProposal(event, latest)) latest = event;
    if (isAttributedProposal(event) && isNewerProposal(event, latestAttributed)) {
      latestAttributed = event;
    }
  }
  return latestAttributed ?? latest;
}

function isNewerProposal(event: NostrEvent, latest: NostrEvent | null): boolean {
  if (!latest) return true;
  return (
    event.created_at > latest.created_at ||
    (event.created_at === latest.created_at && event.id < latest.id)
  );
}


/**
 * Pure derivation - exported for tests. `now` is unix seconds; it is used
 * ONLY against an OBSERVED `challenge-deadline` tag, never to assume a
 * window length.
 */
export function deriveConfirmationStatus(
  caseId: string,
  events: readonly NostrEvent[],
  now: number,
  threshold: number = CONFIRMATION_THRESHOLD,
): CourtConfirmationStatus {
  const relevant = events.filter((e) => eventCaseId(e) === caseId);
  const proposal = latestProposal(caseId, relevant);
  const attributed = proposal ? isAttributedProposal(proposal) : false;

  const confirmationPubkeys = new Set<string>();
  const challengeIds = new Set<string>();
  const deadlineRaw = proposal ? getTag(proposal, "challenge-deadline") : undefined;
  const deadline = deadlineRaw != null && /^[0-9]+$/.test(deadlineRaw) ? Number(deadlineRaw) : null;
  for (const event of relevant) {
    if (event.kind === COURT_JUROR_CONFIRMATION_KIND && isHex64(event.pubkey)) {
      confirmationPubkeys.add(event.pubkey.toLowerCase());
    } else if (event.kind === COURT_CHALLENGE_KIND && event.id) {
      challengeIds.add(event.id);
    }
  }

  const batchRef = proposal ? getTag(proposal, "batch") : undefined;
  const batchCheck = verifyBatchesForCase(caseId, events);

  // Only challenges published WITHIN the proposal's challenge window block
  // the window from closing; a challenge published after the deadline is
  // displayed as observed (`challenged`) but cannot re-open the ladder.
  const inWindowChallengeCount =
    deadline == null
      ? challengeIds.size
      : relevant.filter(
          (e) =>
            e.kind === COURT_CHALLENGE_KIND &&
            e.id != null &&
            typeof e.created_at === "number" &&
            e.created_at <= deadline,
        ).length;
  // The deadline itself is a proposal assertion, so an UNATTRIBUTED proposal
  // can never close a window - otherwise one hostile event (`dispute: X`,
  // `challenge-deadline: 0`, no evidence) reads `final`.
  const windowPassed =
    attributed && deadline != null && now > deadline && inWindowChallengeCount === 0;
  // Same rule for the batch arm: cryptographically valid inclusion is not
  // finality unless the pinned court authority asserts the case attribution.
  const verified = batchCheck.verified && attributed;

  let stage: CourtConfirmationStage = "pending";
  let finalReason: CourtConfirmationStatus["finalReason"] = null;
  if (verified) {
    stage = "final";
    finalReason = "batch-attestation";
  } else if (windowPassed) {
    stage = "final";
    finalReason = "challenge-window";
  } else if (confirmationPubkeys.size >= threshold) {
    stage = "confirmed";
  }

  let verifyReason: string | null = null;
  if (!verified) {
    if (batchCheck.verified && !attributed) {
      verifyReason = "batch is valid but the proposal publisher is not the pinned court authority";
    } else {
      verifyReason = batchCheck.reason;
    }
  }

  return {
    caseId,
    stage,
    confirmations: confirmationPubkeys.size,
    threshold,
    challenged: challengeIds.size > 0,
    challengeCount: challengeIds.size,
    proposalEventId: proposal?.id ?? null,
    proposalPublisher: proposal?.pubkey ?? null,
    attributed,
    batchEventId: isHex64(batchRef) ? batchRef : batchCheck.batchEventId,
    batchAttestationValid: batchCheck.verified,
    verified,
    verifyReason,
    batchEpoch: batchCheck.epoch,
    batchCount: batchCheck.count,
    finalReason,
  };
}

export interface UseCourtConfirmationsResult {
  /**
   * Observed status per dispute id, keyed by case id. Bounded index: only
   * cases with an observed kind-38026 proposal appear (a case enters the
   * ladder via its proposal), at most `MAX_DERIVED_CASES` of them, sorted by
   * id. Use `statusForCase` for any specific id (uncapped).
   */
  statuses: ReadonlyMap<string, CourtConfirmationStatus>;
  /** Observed status for one case (derived on demand). */
  statusForCase: (caseId: string) => CourtConfirmationStatus;
  /** Batch-verify one case against its observed kind-39018 attestations. */
  verifyBatchForCase: (caseId: string) => BatchVerification;
  /** True while the initial backfill query is in flight. */
  isLoading: boolean;
}

export function useCourtConfirmations(): UseCourtConfirmationsResult {
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const relay = new NRelay1(RELAY);
    const controller = new AbortController();
    const kinds = [
      COURT_OUTCOME_PROPOSAL_KIND,
      COURT_JUROR_CONFIRMATION_KIND,
      COURT_CHALLENGE_KIND,
      BAO_COURT_BATCH_ATTESTATION_KIND,
    ];

    const ingest = (incoming: readonly NostrEvent[]) => {
      const fresh: NostrEvent[] = [];
      for (const event of incoming) {
        if (!event?.id || seenIds.current.has(event.id)) continue;
        seenIds.current.add(event.id);
        // Drop oversized hostile events before they can enter state.
        if (!sizeCapped(event)) continue;
        // NIP-01 authenticity for the event kinds that are genuinely signed.
        // Kind 39018 is excluded on purpose: its authenticity is the cohort's
        // FROST signature over the manifest in the `sig` TAG (the NIP-01
        // `sig` is empty by construction), and `verifyCaseInBatch` recomputes
        // the id + signature. Verifying it here would drop every real batch.
        if (event.kind !== BAO_COURT_BATCH_ATTESTATION_KIND && !isVerifiedEvent(event)) {
          continue;
        }
        fresh.push(event);
      }
      if (fresh.length === 0) return;
      setEvents((old) => {
        const merged = [...old, ...fresh];
        // Bounded retention: newest events win.
        return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
      });
    };

    const pending: NostrEvent[] = [];
    const flushPending = () => {
      if (pending.length === 0) return;
      ingest(pending.splice(0, pending.length));
    };

    (async () => {
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        // Backfill: recent history for each kind.
        const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
        try {
          const backfilled = await relay.query([{ kinds, limit: QUERY_LIMIT }], {
            signal: controller.signal,
          });
          ingest(backfilled);
        } finally {
          clearTimeout(timeoutId);
        }
        setIsLoading(false);

        // Live subscription with a since-cursor; dedupe is by event id.
        const filter: NostrFilter = {
          kinds,
          limit: QUERY_LIMIT,
          since: Math.floor(Date.now() / 1000),
        };
        const flush = () => {
          flushTimer = null;
          if (controller.signal.aborted) return;
          flushPending();
        };
        const scheduleFlush = () => {
          if (flushTimer == null && !controller.signal.aborted) {
            flushTimer = setTimeout(flush, LIVE_BATCH_MS);
          }
        };

        for await (const msg of relay.req([filter], { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          if (msg[0] !== "EVENT") continue;
          pending.push(msg[2] as NostrEvent);
          scheduleFlush();
        }
      } catch {
        // Subscription errors are best-effort; the backfill result stands.
        setIsLoading(false);
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        // Flush anything already received when the stream ends (relay
        // disconnect, generator close) instead of dropping it.
        flushPending();
        relay.close().catch(() => {});
      }
    })();

    return () => {
      controller.abort();
      relay.close().catch(() => {});
    };
  }, []);

  const statusForCase = useCallback(
    (caseId: string) => deriveConfirmationStatus(caseId, events, Math.floor(Date.now() / 1000)),
    [events],
  );

  const verifyBatchForCase = useCallback(
    (caseId: string) => verifyBatchesForCase(caseId, events),
    [events],
  );

  const statuses = useMemo(() => {
    // Only cases that actually have a PROPOSAL can leave `pending`, so those
    // are the only ids worth deriving eagerly - a relay cannot inflate the
    // index with bare confirmations/challenges for invented case ids.
    const ids: string[] = [];
    for (const event of events) {
      if (event.kind !== COURT_OUTCOME_PROPOSAL_KIND) continue;
      const id = eventCaseId(event);
      if (id) ids.push(id);
    }
    const unique = [...new Set(ids)].sort().slice(0, MAX_DERIVED_CASES);
    const now = Math.floor(Date.now() / 1000);
    const map = new Map<string, CourtConfirmationStatus>();
    for (const id of unique) map.set(id, deriveConfirmationStatus(id, events, now));
    return map;
  }, [events]);

  return { statuses, statusForCase, verifyBatchForCase, isLoading };
}
