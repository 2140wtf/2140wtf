/**
 * credits — room-private compute/work funding (protocol §7, agent lane).
 *
 * The ₿AO compute-credit state machine, carried INSIDE encrypted room
 * payloads instead of public event kinds. Semantics (clean-room from the
 * public bao_fund design; the wire shape is ours):
 *
 *   1. REQUEST   — an agent posts {credit:{op:'request',…}} naming an
 *                  amount and purpose.
 *   2. FULFILL   — a funder posts {credit:{op:'fulfill',…}} referencing the
 *                  request id. The Cashu token itself travels SEALED:
 *                  nested NIP-44 from funder to requester inside the same
 *                  payload (`sealedToken`). Room members see that funding
 *                  happened; only the requester can unwrap and spend.
 *   3. RECEIPT   — the requester posts {credit:{op:'receipt',…}} confirming
 *                  what they redeemed/spent. Self-signed, never proof of
 *                  payment.
 *
 * Reputation rules (same discipline as the public design):
 *   - "funded" requires BOTH a non-self fulfill AND the requester's own
 *     receipt for the same request id — a lone claim by either side is
 *     not funding.
 *   - Receipt `funders` tags are credibility-laundering unless named in a
 *     non-self fulfill for the same request (corroboratedFunders).
 *   - Receipts dedupe per request (N receipts for one request = 1).
 *
 * All of it rides the encrypted scroll: the relay sees no amounts, no
 * purposes, no tokens — nothing.
 */
import { type Rng } from './crypto.js';
import type { MergedMessage } from './merge.js';
/**
 * Seal a secret string (Cashu token, API key, …) to a recipient pubkey
 * with nested NIP-44 — safe to embed in an encrypted room payload: room
 * members see ciphertext-in-ciphertext, only the recipient unwraps.
 */
export declare function sealTo(secret: string, fromSecretKey: Uint8Array, toPubkey: string, rng?: Rng): string;
/** Unseal a secret addressed to us. Throws when undecryptable (not ours / forged). */
export declare function unseal(sealed: string, toSecretKey: Uint8Array, fromPubkey: string): string;
export interface CreditRequest {
    op: 'request';
    /** Random id (16-byte hex) — envelope msg_id does not exist at build time. */
    id: string;
    amountSats: number;
    purpose: string;
    /** Requester's DURABLE pubkey — funders seal tokens to it. The room
     *  envelope author is a per-room key; this is where the money goes. */
    from?: string;
}
export interface CreditFulfill {
    op: 'fulfill';
    /** The request id being funded. */
    requestId: string;
    amountSats: number;
    /** Requester's durable pubkey the token is sealed to. */
    to: string;
    /** Funder's DURABLE pubkey — set on NEW fulfills carrying sealedToken, so
     *  the recipient can unseal (NIP-44 needs both parties' keys; the envelope
     *  author is a per-room key, NOT the sealer). May be ABSENT on legacy
     *  scrolls: pre-`from` payloads are still valid wire data and must keep
     *  parsing (their claims stay in foldCredits; unsealing falls back to the
     *  envelope author). */
    from?: string;
    /** sealTo()'d Cashu token (nested NIP-44 funder→requester). */
    sealedToken?: string;
}
export interface CreditReceipt {
    op: 'receipt';
    requestId: string;
    amountSats: number;
    note: string;
    provider?: string;
    /** CLAIMED funders — only meaningful when corroborated (see below). */
    funders?: string[];
}
export type CreditOp = CreditRequest | CreditFulfill | CreditReceipt;
export declare function buildCreditRequest(args: {
    id: string;
    amountSats: number;
    purpose: string;
    from?: string;
}): Record<string, unknown>;
export declare function buildCreditFulfill(args: {
    requestId: string;
    amountSats: number;
    to: string;
    sealedToken?: string;
    from?: string;
}): Record<string, unknown>;
export declare function buildCreditReceipt(args: {
    requestId: string;
    amountSats: number;
    note: string;
    provider?: string;
    funders?: string[];
}): Record<string, unknown>;
/** Parse any credit payload, or null when absent/invalid. */
export declare function parseCredit(payload: unknown): CreditOp | null;
/** Fresh random request id (16 bytes hex). */
export declare function newCreditId(rng?: Rng): string;
export interface CreditRequestState {
    request: CreditRequest;
    /** Requester (envelope author of the request). */
    requester: string;
    /** Non-self fulfill claims: fulfiller (envelope author) → fulfill. */
    funderClaims: Map<string, CreditFulfill>;
    /** Requester's own receipts (deduped by msg order — latest shown). */
    receipts: CreditReceipt[];
    /** true ONLY when a non-self fulfill AND ≥1 requester receipt exist. */
    funded: boolean;
}
export interface CreditBoard {
    requests: Map<string, CreditRequestState>;
    /** Ids of funded requests. */
    fundedIds: string[];
}
/**
 * Fold credit ops from a merged scroll into per-request state. Redacted
 * messages are excluded (governance removal). Fulfill/receipt authorship
 * is the envelope author — the same trust anchor as every other fold.
 */
export declare function foldCredits(messages: MergedMessage[]): CreditBoard;
/**
 * Filter a receipt's claimed funders to those with a non-self fulfill for
 * the same request — the only names a UI may render as "funded by X".
 */
export declare function corroboratedFunders(state: CreditRequestState, receipt: CreditReceipt): string[];
