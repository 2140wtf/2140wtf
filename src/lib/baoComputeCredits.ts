/**
 * ₿AO compute credits — Nostr event builders/parsers.
 *
 * Agents without money publish a *request* for compute credits; funders
 * answer by sending a real Cashu token out-of-band (NIP-17 DM + copyable
 * fallback) and publishing a *fulfillment claim*; the agent closes the
 * request by confirming receipt with their OWN fulfillment event. A
 * fulfillment event is never proof of payment — anyone can publish one —
 * so clients must only treat a request as funded when the fulfillment is
 * authored by the requester.
 *
 *   kind 4971 — request.   tags: t=bao-compute-credit-request, amount=<sats>
 *   kind 4972 — fulfillment. tags: e=<request id>, p=<requester>, amount=<sats>
 *
 * The Cashu token itself NEVER appears in any event — events carry metadata
 * only. Both kinds were verified unused against the NIP registry (2026-07).
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { normalizeMintUrl } from '@/lib/cashu/cashu';

export const BAO_COMPUTE_CREDIT_REQUEST_KIND = 4971;
export const BAO_COMPUTE_CREDIT_FULFILLMENT_KIND = 4972;
/**
 * kind 4973 — spend receipt. The agent reports (self-signed, no proof) that
 * they redeemed/spent credits for the request's purpose. Verified unused
 * against the NIP registry (2026-07), same as 4971/4972.
 */
export const BAO_COMPUTE_CREDIT_RECEIPT_KIND = 4973;
export const BAO_COMPUTE_CREDIT_TAG = 'bao-compute-credit-request';

export interface ComputeCreditRequest {
  id: string;
  pubkey: string;
  amountSats: number;
  purpose: string;
  createdAt: number;
}

export interface ComputeCreditFulfillment {
  id: string;
  pubkey: string;
  requestId: string;
  requesterPubkey: string;
  amountSats: number;
  createdAt: number;
}

/** Unsigned event template for a compute-credit request (for useNostrPublish). */
export function buildComputeCreditRequest(input: { amountSats: number; purpose: string }) {
  return {
    kind: BAO_COMPUTE_CREDIT_REQUEST_KIND,
    content: input.purpose.trim(),
    tags: [
      ['t', BAO_COMPUTE_CREDIT_TAG],
      ['amount', String(Math.floor(input.amountSats))],
    ],
  };
}

/** Unsigned event template for a fulfillment receipt (token goes by DM, never here). */
export function buildComputeCreditFulfillment(input: {
  requestId: string;
  requesterPubkey: string;
  amountSats: number;
}) {
  return {
    kind: BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
    content: '',
    tags: [
      ['e', input.requestId],
      ['p', input.requesterPubkey],
      ['amount', String(Math.floor(input.amountSats))],
    ],
  };
}

export function parseComputeCreditRequest(event: NostrEvent): ComputeCreditRequest | null {
  if (event.kind !== BAO_COMPUTE_CREDIT_REQUEST_KIND) return null;
  if (!event.tags.some((t) => t[0] === 't' && t[1] === BAO_COMPUTE_CREDIT_TAG)) return null;

  const amountTag = event.tags.find((t) => t[0] === 'amount');
  const amountSats = Number(amountTag?.[1]);
  if (!Number.isFinite(amountSats) || amountSats <= 0) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    amountSats: Math.floor(amountSats),
    purpose: event.content.trim(),
    createdAt: event.created_at,
  };
}

export function parseComputeCreditFulfillment(event: NostrEvent): ComputeCreditFulfillment | null {
  if (event.kind !== BAO_COMPUTE_CREDIT_FULFILLMENT_KIND) return null;

  const requestId = event.tags.find((t) => t[0] === 'e')?.[1];
  const requesterPubkey = event.tags.find((t) => t[0] === 'p')?.[1];
  if (!requestId || !requesterPubkey) return null;

  const amountTag = event.tags.find((t) => t[0] === 'amount');
  const amountSats = Number(amountTag?.[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    requestId,
    requesterPubkey,
    amountSats: Number.isFinite(amountSats) ? Math.floor(amountSats) : 0,
    createdAt: event.created_at,
  };
}

// ── Spend receipts (kind 4973) ───────────────────────────────────────────────

export interface ComputeCreditReceipt {
  id: string;
  /** Agent (event author). */
  pubkey: string;
  /** The kind-4971 request this receipt reports on (e tag). */
  requestId: string;
  amountSats: number;
  provider?: string;
  note: string;
  /** p tags = CLAIMED funders — only render when corroborated (see below). */
  claimedFunders: string[];
  createdAt: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Unsigned event template for a spend receipt (for useNostrPublish). */
export function buildComputeCreditReceipt(input: {
  requestId: string;
  amountSats: number;
  note: string;
  provider?: string;
  funderPubkeys?: string[];
}) {
  const tags: string[][] = [
    ['e', input.requestId],
    ['amount', String(Math.floor(input.amountSats))],
  ];
  if (input.provider?.trim()) tags.push(['provider', input.provider.trim()]);
  for (const f of input.funderPubkeys ?? []) {
    if (HEX64.test(f)) tags.push(['p', f]);
  }
  return {
    kind: BAO_COMPUTE_CREDIT_RECEIPT_KIND,
    content: input.note.trim(),
    tags,
  };
}

export function parseComputeCreditReceipt(event: NostrEvent): ComputeCreditReceipt | null {
  if (event.kind !== BAO_COMPUTE_CREDIT_RECEIPT_KIND) return null;

  const requestId = event.tags.find((t) => t[0] === 'e')?.[1];
  if (!requestId || !HEX64.test(requestId)) return null;

  const amountTag = event.tags.find((t) => t[0] === 'amount');
  const amountSats = Number(amountTag?.[1]);
  if (!Number.isFinite(amountSats) || amountSats <= 0) return null;

  const provider = event.tags.find((t) => t[0] === 'provider')?.[1]?.trim() || undefined;
  const claimedFunders = event.tags
    .filter((t) => t[0] === 'p' && typeof t[1] === 'string' && HEX64.test(t[1]))
    .map((t) => t[1]);

  return {
    id: event.id,
    pubkey: event.pubkey,
    requestId,
    amountSats: Math.floor(amountSats),
    provider,
    note: event.content.trim(),
    claimedFunders: [...new Set(claimedFunders)],
    createdAt: event.created_at,
  };
}

// ── Corroborated reputation aggregation ──────────────────────────────────────
//
// NOTHING here is proof of payment — every input kind is self-published. The
// rules below only make inflation COST something and keep the numbers honest:
//  - "funded" requires BOTH a non-self funder claim (4972) AND the agent's
//    own confirmation for the same request — a lone sockpuppet can still fake
//    it with a second key, but the claimant list stays inspectable.
//  - receipts count only when they reference the agent's OWN known request,
//    deduped per request (N receipts for one request = 1).
//  - receipt p tags ("funded by X") are credibility-laundering unless X has
//    their own 4972 claim for that request — see corroboratedFunders.

export interface AgentCreditStats {
  requests: number;
  fundedRequests: number;
  /** Distinct non-self claimants on funded requests. */
  claimants: string[];
  receipts: number;
  /** Sum of request amounts for funded requests — self-reported, never verified. */
  selfReportedSats: number;
}

export function aggregateAgentCreditStats(input: {
  agentPubkey: string;
  requests: ComputeCreditRequest[];
  fulfillments: ComputeCreditFulfillment[];
  receipts: ComputeCreditReceipt[];
}): AgentCreditStats {
  const { agentPubkey } = input;
  const ownRequests = input.requests.filter((r) => r.pubkey === agentPubkey);
  const requestById = new Map(ownRequests.map((r) => [r.id, r]));

  const claimsByRequest = new Map<string, Set<string>>();
  const confirmedRequestIds = new Set<string>();
  for (const f of input.fulfillments) {
    if (!requestById.has(f.requestId)) continue;
    if (f.requesterPubkey !== agentPubkey) continue; // p tag must match the real requester
    if (f.pubkey === agentPubkey) {
      confirmedRequestIds.add(f.requestId);
    } else {
      const set = claimsByRequest.get(f.requestId) ?? new Set<string>();
      set.add(f.pubkey);
      claimsByRequest.set(f.requestId, set);
    }
  }

  const claimants = new Set<string>();
  let fundedRequests = 0;
  let selfReportedSats = 0;
  for (const [requestId, requestClaims] of claimsByRequest) {
    if (!confirmedRequestIds.has(requestId)) continue; // both sides required
    fundedRequests += 1;
    selfReportedSats += requestById.get(requestId)?.amountSats ?? 0;
    for (const c of requestClaims) claimants.add(c);
  }

  const receiptRequestIds = new Set<string>();
  for (const r of input.receipts) {
    if (r.pubkey !== agentPubkey) continue;
    if (!requestById.has(r.requestId)) continue; // must reference the agent's own request
    receiptRequestIds.add(r.requestId); // dedupe per request
  }

  return {
    requests: ownRequests.length,
    fundedRequests,
    claimants: [...claimants],
    receipts: receiptRequestIds.size,
    selfReportedSats,
  };
}

/**
 * Filter a receipt's claimed funders to those with their own 4972 claim for
 * the same request — the only p tags a UI may render as "funded by X".
 */
export function corroboratedFunders(
  receipt: ComputeCreditReceipt,
  fulfillments: ComputeCreditFulfillment[],
): string[] {
  const claimers = new Set(
    fulfillments
      .filter((f) => f.requestId === receipt.requestId && f.pubkey !== receipt.pubkey)
      .map((f) => f.pubkey),
  );
  return receipt.claimedFunders.filter((f) => claimers.has(f));
}

// ── Funder lock-target resolution ────────────────────────────────────────────

export type CreditLockMode = 'wallet-key' | 'identity-key' | 'bearer';

export interface CreditLockTarget {
  mode: CreditLockMode;
  /** Hex pubkey to P2PK-lock the token to (x-only or compressed); null = bearer. */
  lockPubkey: string | null;
  /** Mint the funder should send from (normalized URL). */
  mintUrl: string;
}

/**
 * Decide what a funder's token is locked to and from which mint it is sent.
 *
 * Hierarchy (credits-flow review 2026-07):
 *  1. Agent's kind-10019 wallet key — sweepable by the agent's own wallet
 *     (no raw nsec needed, works with remote signers). Requires a common
 *     mint (agent's 10019 mints ∩ funder's mints); Routstr-accepted mints
 *     are preferred so the agent's redeem avoids a cross-mint swap fee.
 *  2. Agent's Nostr identity key — agents running their own tooling hold
 *     their nsec and can sweep there; browser users get an in-app path.
 *  3. Bearer — ONLY on explicit funder opt-in: a token inside an encrypted
 *     DM is still bearer money for whoever sees it.
 */
export function resolveCreditLockTarget(input: {
  nutzapInfo: { pubkey: string; mints: string[] } | null;
  agentIdentityPubkey: string;
  funderMints: string[];
  routstrMints: string[];
  activeMint: string;
  allowBearer: boolean;
}): CreditLockTarget {
  const norm = (u: string) => normalizeMintUrl(u) ?? u.trim().replace(/\/+$/, '');
  const funder = input.funderMints.map(norm);
  const routstr = input.routstrMints.map(norm);
  const active = norm(input.activeMint);

  if (input.allowBearer) {
    return { mode: 'bearer', lockPubkey: null, mintUrl: active };
  }

  if (input.nutzapInfo) {
    const agentMints = input.nutzapInfo.mints.map(norm);
    const common = agentMints.filter((m) => funder.includes(m));
    if (common.length > 0) {
      const preferred = common.find((m) => routstr.includes(m)) ?? common[0];
      return { mode: 'wallet-key', lockPubkey: input.nutzapInfo.pubkey, mintUrl: preferred };
    }
    // No common mint — fall through to the identity lock rather than failing:
    // the agent can still sweep with their signer/nsec.
  }

  return { mode: 'identity-key', lockPubkey: input.agentIdentityPubkey, mintUrl: active };
}
