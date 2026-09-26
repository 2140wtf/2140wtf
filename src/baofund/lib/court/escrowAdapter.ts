// src/lib/court/escrowAdapter.ts
//
// App-agnostic escrow adapter contract for the BAO Court.
// Architecture decision record: docs/adr/ADR-court-app-agnostic.md
//
// TYPES AND CONTRACTS ONLY — no behavior, no network, no keys. This module is
// the interface every app (bao.fund, bao.markets, future apps) implements once
// per settlement rail so the shared court engine can be consumed without the
// court knowing anything about that app's escrow.
//
// Division of responsibility (ADR §1):
//   - The court core owns: dispute lifecycle (38025...), juror selection
//     (39001/39002), per-epoch FROST group state, the tally, and the
//     group-signed verdict (39007).
//   - Each app owns: the escrow lock (which rail, which keys, which
//     locktime), the settlement transaction/swap, and the UI.
//   - A rail adapter is the ONLY place that turns a verified kind-39007
//     verdict into value movement. The court core never touches funds.
//
// Hard rules encoded by the type shapes (ADR §6):
//   - `CourtVerdict` must come from `CourtVerdictVerifier`, which recomputes
//     the signed `marketId` from the adapter's OWN `(app, escrowId)` — never
//     from tags an attacker controls (replay defense).
//   - `SettlementReceipt.phase` distinguishes `initiated` from `settled`:
//     an escrow that is only initiated is NOT settled (Fund invariant,
//     deep-hunt wave 5).
//   - `FrostSignerService` is a settlement authorizer, not a blind digest
//     oracle: it re-verifies the verdict before signing (ADR §4).

import type { Event as NostrEvent } from 'nostr-tools/pure';

/**
 * Stable, registered id of a court client app. Lowercase ASCII, dot/dash
 * separated (`bao.fund`, `bao.markets`). The registry lives in the ADR; the
 * id is the origin half of the engine `marketId` (`<appId>:<escrowRef>`), so
 * a verdict is cryptographically bound to the app that commissioned it.
 */
export type CourtAppId = string;

/**
 * Settlement rail families known to the court. The court never interprets
 * them; they select which adapter an app must implement. New rails are added
 * by ADR amendment, never by overloading an existing value.
 */
export type SettlementRail =
  /** Cashu NUT-11 P2PK/SIG_ALL escrow (2-of-3 co-sign + party completion). */
  | 'cashu-nut11'
  /** Bitcoin tapscript judge/refund leaves (testnet4 today; L1 when enabled). */
  | 'bitcoin-tapscript'
  /** Liquid Elements tapscript leaves (0xc4 leaf version, Elements domains). */
  | 'liquid-tapscript'
  /** Lightning hold-invoice settlement (vendor lnSettlement primitives). */
  | 'lightning-hold';

/** Network a settlement rail is deployed on. */
export type SettlementNetwork =
  | 'mainnet'
  | 'signet'
  | 'testnet4'
  | 'liquid-mainnet'
  | 'liquid-testnet';

/**
 * Opaque, app-scoped escrow handle. The court treats `escrowId` as an opaque
 * string: it MUST NOT parse it, and only the owning app knows how to resolve
 * it to a lock. `app` + `escrowId` are committed to the verdict through the
 * app-scoped engine `marketId` (ADR §2).
 */
export interface EscrowRef {
  readonly app: CourtAppId;
  readonly escrowId: string;
}

/**
 * A verdict that has passed `CourtVerdictVerifier` for one specific escrow.
 * Everything here is exported so adapters can bind rails to it; the authority
 * remains the kind-39007 event (`attestationEventId`) and its signature under
 * `groupPubkey`.
 */
export interface CourtVerdict {
  readonly app: CourtAppId;
  readonly escrowId: string;
  readonly rail: SettlementRail;
  /** The kind-38025 dispute event id the verdict overrides. */
  readonly disputeId: string;
  /** The kind-39007 event id — the portable settlement authority. */
  readonly attestationEventId: string;
  /** Real empaneled FROST group key (x-only, 32-byte hex). NEVER dispute-derived. */
  readonly groupPubkey: string;
  /** App-mapped outcome. For escrow disputes this is the winner's x-only pubkey. */
  readonly outcome: string;
  /** Dispute-verdict commitment (`hashDisputeVerdict`) the signature certifies. */
  readonly verdictHash: string;
  /** FROST signing round bound into the signed message (1 for disputes). */
  readonly round: number | string;
}

/**
 * Re-verification of a kind-39007 verdict against THIS escrow.
 *
 * Implementations must:
 *   1. require kind 39007 (kind 89 is not settlement authority),
 *   2. recompute the engine `marketId` from `(app, escrowId)` and compare it
 *      with the signed `m` tag — the adapter's own ref is the binding, never
 *      a tag supplied by the event,
 *   3. pin the REAL empaneled group key and reject the publicly-computable
 *      dispute-derived key,
 *   4. verify the FROST signature over the recomputed attestation message,
 *   5. require `outcome` to be one this escrow can actually pay.
 *
 * The Fund's shipped implementation is `verifyEscrowCourtAttestation`
 * (`src/lib/court/escrowCourt.ts`) plus `parseDisputeEvent`
 * (`src/lib/court/disputeStatus.ts`); new apps reuse those folds.
 */
export interface CourtVerdictVerifier {
  verifyVerdict(input: {
    /** The raw relay event the adapter believes is a 39007 attestation. */
    readonly event: NostrEvent;
    /** The adapter's own escrow handle (never taken from the event). */
    readonly escrow: EscrowRef;
    /** The rail the escrow is locked on (bound into the adapter's marketId check). */
    readonly rail: SettlementRail;
    /** The real empaneled group key this app pinned for the escrow epoch. */
    readonly groupPubkey: string;
    /** Optional outcome allow-list (escrow parties for the Fund mapping). */
    readonly allowedOutcomes?: readonly string[];
  }): { readonly valid: true; readonly verdict: CourtVerdict } | { readonly valid: false; readonly error: string };
}

/** Read-only snapshot of an escrow lock. Never moves value. */
export interface EscrowLock {
  readonly rail: SettlementRail;
  readonly network: SettlementNetwork;
  /** Rail-native lock id: token secret id, outpoint, or payment hash. */
  readonly lockId: string;
  readonly amountSats: number;
  /** The two (or more) party pubkeys the rail may pay, x-only hex. */
  readonly partyPubkeys: readonly string[];
  /**
   * The key the lock requires for the disputed path. For new escrows this is
   * the court group key for the pinned epoch — the whole point of ADR §4.
   * For legacy escrows it is the old operator/oracle key.
   */
  readonly oraclePubkey: string;
  /** Unix seconds after which the unilateral refund/timeout path wins. */
  readonly refundDeadline: number;
}

/** Which signature slots a rail's settlement needs. */
export type SettlementSignatureRole =
  | 'oracle'
  | 'winner'
  | 'party'
  | 'funder'
  /** A FROST group signature (the aggregate schnorr signature over the digest). */
  | 'group';

/**
 * A rail-native settlement instruction, produced by `prepareSettlement` and
 * consumed by `settle`. Opaque to the court core: it is a NUT-11 swap wire,
 * a PSBT/descriptor, a hold-invoice decision, etc.
 */
export interface SettlementPlan {
  /** Deterministic idempotency key (same escrow + verdict + rail => same id). */
  readonly planId: string;
  readonly escrow: EscrowRef;
  readonly rail: SettlementRail;
  readonly network: SettlementNetwork;
  readonly verdict: CourtVerdict;
  /** Release = verdict pays the winner; refund = verdict/ timeout pays back. */
  readonly action: 'release' | 'refund';
  /** Rail-native instruction. NEVER contains secret material. */
  readonly instructions: unknown;
  /** Signature slots this rail will need, in rail order. */
  readonly requiredSignatures: readonly SettlementSignatureRole[];
  /** Unix seconds after which the plan must not be submitted (refund race). */
  readonly validUntil: number;
}

/**
 * Result of a settle/refund attempt.
 *
 * `initiated` is a first-class state: the two-phase Cashu rail returns an
 * initiate that still needs the party witness, and reporting that as
 * `settled` is the exact regression the Fund fixed on 2026-09-21. Adapters
 * MUST NOT collapse the two.
 */
export interface SettlementReceipt {
  readonly phase: 'settled' | 'initiated' | 'failed';
  readonly rail: SettlementRail;
  readonly planId: string;
  readonly escrow: EscrowRef;
  readonly settledAt?: number;
  /** Rail proof: txid, swap id, payment preimage. Never secret material. */
  readonly proof?: string;
  /** Human-readable detail for the UI; must never contain secrets. */
  readonly detail?: string;
}

export interface PrepareSettlementInput {
  readonly escrow: EscrowRef;
  readonly verdict: CourtVerdict;
  /** Injected clock (unix seconds); the adapter refuses after `validUntil`. */
  readonly nowSeconds: number;
}

export interface RefundInput {
  readonly escrow: EscrowRef;
  /**
   * `timeout`: the unilateral refund locktime elapsed. `verdict-refund`: a
   * verified verdict orders the refund (for rails where refund is not
   * unilateral, e.g. Cashu co-signed refunds).
   */
  readonly reason: 'timeout' | 'verdict-refund';
  /** Required for `verdict-refund`; forbidden otherwise. */
  readonly verdict?: CourtVerdict;
  readonly nowSeconds: number;
}

/**
 * The contract each app implements once per rail. All methods fail closed:
 * a missing lock, an unverifiable verdict, an expired deadline, or a rail
 * error must surface as a typed failure — never as a fabricated receipt.
 */
export interface EscrowAdapter {
  readonly app: CourtAppId;
  readonly rail: SettlementRail;
  readonly network: SettlementNetwork;

  /** Read the lock (never moves value). Null when the escrow is unknown. */
  inspect(escrow: EscrowRef): Promise<EscrowLock | null>;

  /** Verify the verdict against this escrow and build the rail instruction. */
  prepareSettlement(input: PrepareSettlementInput): Promise<SettlementPlan>;

  /** Execute a prepared settlement. Idempotent by `planId`. */
  settle(plan: SettlementPlan): Promise<SettlementReceipt>;

  /**
   * The refund path. Always available for rail-timeout refunds, independent
   * of the court and of the signer service — a court outage must never lock
   * funds. `verdict-refund` is the co-signed variant.
   */
  refund(input: RefundInput): Promise<SettlementReceipt>;
}

/** Static capabilities of a rail, used by UIs and by the ADR's migration plan. */
export interface RailCapabilities {
  readonly rail: SettlementRail;
  readonly networks: readonly SettlementNetwork[];
  /** What the court group key signs for this rail. */
  readonly oracleSignature: 'nut11-sigall' | 'bip340-sighash' | 'bolt11-preimage';
  /** True when the depositor/party can exit without the court (locktime). */
  readonly supportsUnilateralRefund: boolean;
  /** True when the rail settles only through an app server (Cashu API today). */
  readonly requiresAppService: boolean;
}

/**
 * One pinned FROST court group epoch. Escrows lock to exactly one epoch key;
 * rotation mints a new epoch and only new escrows pin it (ADR §4/§5). Legacy
 * per-dispute DKG keys are NOT group epochs and can never be pinned.
 */
export interface CourtGroupEpoch {
  /** x-only aggregate key (32-byte hex) that escrows pin as the oracle/judge. */
  readonly groupPubkey: string;
  readonly threshold: number;
  readonly participants: number;
  readonly epoch: number;
  /** Unix seconds this epoch becomes pinnable for new escrows. */
  readonly activatedAt: number;
  /** Unix seconds this epoch stops accepting new locks (settlement still valid). */
  readonly retiredAt?: number;
  /** Where the signer service endpoints live (never shares). */
  readonly signerEndpoints?: readonly string[];
}

/**
 * What an escrow adapter sends the FROST signer service for one settlement.
 * The digest is rail-native (NUT-11 SIG_ALL message digest or a taproot
 * sighash); `planId` and `verdict` let the service independently re-verify
 * the verdict and refuse a digest it cannot bind to an actual settlement.
 */
export interface FrostSigningRequest {
  /** 32-byte hex digest the rail verifies (sighash / SIG_ALL message). */
  readonly digest: string;
  /** The verdict being executed — the signer re-verifies this itself. */
  readonly verdict: CourtVerdict;
  /** The settlement plan this signature is for (single-use replay guard). */
  readonly planId: string;
  readonly action: 'release' | 'refund';
}

export interface FrostSigningResponse {
  readonly groupPubkey: string;
  /** 64-byte BIP-340 Schnorr signature (R || s) over `digest`. */
  readonly signature: string;
  readonly scheme: 'bip340';
}

/**
 * Group-key signer service boundary: digest in -> schnorr signature out.
 *
 * NOT a blind signing oracle. The service MUST re-verify the kind-39007
 * verdict's binding (group key, dispute id, app-scoped `marketId`, verdict
 * hash) before signing, derive or confirm the digest against the actual
 * settlement it authorizes, and enforce one signature per
 * `(escrow, rail, action, planId)`. Shares live only with the empaneled
 * signers — never with the app, never in this repo's client bundle.
 */
export interface FrostSignerService {
  /** Request one settlement signature. */
  signSettlement(request: FrostSigningRequest): Promise<FrostSigningResponse>;
  /** Group epochs this service can sign for (metadata only, no shares). */
  groupEpochs(): Promise<readonly CourtGroupEpoch[]>;
}
