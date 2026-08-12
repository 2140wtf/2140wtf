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
export const MAX_COMPUTE_CREDIT_TRANCHES = 5;

/**
 * Agent funding is a real-money flow. Cashu does not encode the Bitcoin
 * network in a mint URL, so reject the conventional test/demo endpoints
 * before a token can be minted. This is deliberately conservative: custom
 * production mints remain usable, while an operator must explicitly remove
 * test markers from a URL before it can be selected for funding.
 */
export function isLikelyMainnetMint(mintUrl: string): boolean {
  try {
    const parsed = new URL(mintUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || /^127(?:\\.\\d{1,3}){3}$/.test(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.test')) return false;
    const endpoint = `${host}${parsed.pathname}`;
    return !/(^|[./-])(testnet|signet|regtest|demo|staging|development|dev)([./-]|$)/.test(endpoint);
  } catch {
    return false;
  }
}

export interface ComputeCreditRequest {
  id: string;
  pubkey: string;
  amountSats: number;
  purpose: string;
  createdAt: number;
  /** Number of tranches. Absent = a legacy single-shot request. */
  shots?: ComputeCreditShot;
  /** Legacy v1 second tranche. New requests use `tranches`. */
  amount2Sats?: number;
  /** V2 ordered payout amounts, one to five positive integer sat values. */
  tranches?: number[];
}

export interface ComputeCreditFulfillment {
  id: string;
  pubkey: string;
  requestId: string;
  requesterPubkey: string;
  amountSats: number;
  createdAt: number;
  /** Which tranche this claim funds (1 or 2 while Multi-shot is in testing). Absent = 1. */
  shot?: number;
}

export type ComputeCreditShot = 1 | 2 | 3 | 4 | 5;

/** Read legacy single/double-shot and v2 tranche requests through one safe view. */
export function getComputeCreditTranches(request: ComputeCreditRequest): number[] {
  if (request.tranches && request.tranches.length >= 1 && request.tranches.length <= MAX_COMPUTE_CREDIT_TRANCHES) {
    return request.tranches;
  }
  return request.shots === 2 && request.amount2Sats && request.amount2Sats > 0
    ? [request.amountSats, request.amount2Sats]
    : [request.amountSats];
}

function isComputeCreditShot(value: number): value is ComputeCreditShot {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_COMPUTE_CREDIT_TRANCHES;
}

function requestShot(request: ComputeCreditRequest, shot: number | undefined): ComputeCreditShot | undefined {
  const index = shot ?? 1;
  return isComputeCreditShot(index) && index <= getComputeCreditTranches(request).length ? index : undefined;
}

/**
 * Sum agent-confirmed sats per tranche. Third-party claims never count.
 * Event ids are deduplicated because relay pools can return the same event
 * more than once.
 */
export function confirmedComputeCreditAmounts(
  request: ComputeCreditRequest,
  fulfillments: ComputeCreditFulfillment[],
): Map<ComputeCreditShot, number> {
  const amounts = new Map<ComputeCreditShot, number>();
  const seen = new Set<string>();
  for (const fulfillment of fulfillments) {
    if (
      fulfillment.requestId !== request.id ||
      fulfillment.requesterPubkey !== request.pubkey ||
      fulfillment.pubkey !== request.pubkey ||
      fulfillment.amountSats <= 0 ||
      seen.has(`${fulfillment.id}:${fulfillment.pubkey}:${fulfillment.shot ?? 1}:${fulfillment.amountSats}`)
    ) continue;
    seen.add(`${fulfillment.id}:${fulfillment.pubkey}:${fulfillment.shot ?? 1}:${fulfillment.amountSats}`);
    const shot = requestShot(request, fulfillment.shot);
    if (shot === undefined) continue;
    amounts.set(shot, (amounts.get(shot) ?? 0) + fulfillment.amountSats);
  }
  return amounts;
}

/** Agent-confirmed tranches for a request. Third-party claims never count. */
export function confirmedComputeCreditShots(
  request: ComputeCreditRequest,
  fulfillments: ComputeCreditFulfillment[],
): Set<ComputeCreditShot> {
  const confirmed = new Set<ComputeCreditShot>();
  const amounts = confirmedComputeCreditAmounts(request, fulfillments);
  const targets = getComputeCreditTranches(request).map((amount, index) => [index + 1 as ComputeCreditShot, amount] as const);
  for (const [shot, target] of targets) {
    if (target > 0 && (amounts.get(shot) ?? 0) >= target) confirmed.add(shot);
  }
  return confirmed;
}

/** A request closes only after every stated tranche is agent-confirmed. */
export function isComputeCreditRequestConfirmed(
  request: ComputeCreditRequest,
  fulfillments: ComputeCreditFulfillment[],
): boolean {
  const confirmed = confirmedComputeCreditShots(request, fulfillments);
  return getComputeCreditTranches(request).every((_, index) => confirmed.has(index + 1 as ComputeCreditShot));
}

/** Unsigned event template for a compute-credit request (for useNostrPublish). */
export function buildComputeCreditRequest(input: {
  amountSats: number;
  purpose: string;
  /** Legacy v1 two-payout writer; new callers should use `tranches`. */
  shots?: 1 | 2;
  amount2Sats?: number;
  /** Ordered v2 payout amounts. Exactly one to five positive integers. */
  tranches?: number[];
}) {
  const tranches = input.tranches?.map((amount) => Math.floor(amount));
  if (tranches && (tranches.length < 1 || tranches.length > MAX_COMPUTE_CREDIT_TRANCHES || tranches.some((amount) => !Number.isSafeInteger(amount) || amount <= 0))) {
    throw new Error(`Compute-credit requests need 1-${MAX_COMPUTE_CREDIT_TRANCHES} positive whole-sat tranches.`);
  }
  const firstAmount = tranches?.[0] ?? Math.floor(input.amountSats);
  const tags = [
    ['t', BAO_COMPUTE_CREDIT_TAG],
    ['amount', String(firstAmount)],
    ['alt', '₿AO compute-credit funding request'],
  ];
  if (tranches) {
    tags.push(['v', '2'], ['shots', String(tranches.length)]);
    tranches.forEach((amount, index) => tags.push(['tranche', String(index + 1), String(amount)]));
  }
  if (input.shots === 2 && input.amount2Sats && input.amount2Sats > 0) {
    tags.push(['shots', '2'], ['amount2', String(Math.floor(input.amount2Sats))]);
  }
  return {
    kind: BAO_COMPUTE_CREDIT_REQUEST_KIND,
    content: input.purpose.trim(),
    tags,
  };
}

/** Unsigned event template for a fulfillment receipt (token goes by DM, never here). */
export function buildComputeCreditFulfillment(input: {
  requestId: string;
  requesterPubkey: string;
  amountSats: number;
  /** Tranche being funded (double-shot requests). Absent = 1. */
  shot?: number;
}) {
  const tags = [
    ['e', input.requestId],
    ['p', input.requesterPubkey],
    ['amount', String(Math.floor(input.amountSats))],
    ['alt', '₿AO compute-credit funding claim or agent confirmation'],
  ];
  if (input.shot !== undefined && isComputeCreditShot(input.shot)) tags.push(['shot', String(input.shot)]);
  return {
    kind: BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
    content: '',
    tags,
  };
}

export function parseComputeCreditRequest(event: NostrEvent): ComputeCreditRequest | null {
  if (event.kind !== BAO_COMPUTE_CREDIT_REQUEST_KIND) return null;
  if (!event.tags.some((t) => t[0] === 't' && t[1] === BAO_COMPUTE_CREDIT_TAG)) return null;

  const amountTag = event.tags.find((t) => t[0] === 'amount');
  const amountSats = Number(amountTag?.[1]);
  if (!Number.isFinite(amountSats) || amountSats <= 0) return null;

  const v2 = event.tags.find((t) => t[0] === 'v')?.[1] === '2';
  const v2Tranches = event.tags
    .filter((tag) => tag[0] === 'tranche')
    .map((tag) => ({ index: Number(tag[1]), amount: Number(tag[2]) }))
    .sort((a, b) => a.index - b.index);
  if (v2) {
    if (v2Tranches.length < 1 || v2Tranches.length > MAX_COMPUTE_CREDIT_TRANCHES || v2Tranches.some(({ index, amount }, offset) => index !== offset + 1 || !Number.isSafeInteger(amount) || amount <= 0)) return null;
    const tranches = v2Tranches.map(({ amount }) => amount);
    return { id: event.id, pubkey: event.pubkey, amountSats: tranches[0], purpose: event.content.trim(), createdAt: event.created_at, shots: tranches.length as ComputeCreditShot, tranches };
  }
  const shots = event.tags.find((t) => t[0] === 'shots')?.[1] === '2' ? 2 as const : undefined;
  const amount2Raw = Number(event.tags.find((t) => t[0] === 'amount2')?.[1]);
  const amount2Sats = shots === 2 && Number.isFinite(amount2Raw) && amount2Raw > 0 ? Math.floor(amount2Raw) : undefined;

  return {
    id: event.id,
    pubkey: event.pubkey,
    amountSats: Math.floor(amountSats),
    purpose: event.content.trim(),
    createdAt: event.created_at,
    ...(shots === 2 && amount2Sats ? { shots, amount2Sats } : {}),
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
    ...(isComputeCreditShot(Number(event.tags.find((t) => t[0] === 'shot')?.[1])) ? { shot: Number(event.tags.find((t) => t[0] === 'shot')?.[1]) as ComputeCreditShot } : {}),
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
  /** Tranche this receipt covers for a Multi-shot request. */
  shot?: number;
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
  shot?: number;
}) {
  const tags: string[][] = [
    ['e', input.requestId],
    ['amount', String(Math.floor(input.amountSats))],
    ['alt', '₿AO compute-credit spend receipt'],
  ];
  if (input.provider?.trim()) tags.push(['provider', input.provider.trim()]);
  for (const f of input.funderPubkeys ?? []) {
    if (HEX64.test(f)) tags.push(['p', f]);
  }
  if (input.shot !== undefined) tags.push(['shot', String(Math.floor(input.shot))]);
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
  const shotRaw = Number(event.tags.find((t) => t[0] === 'shot')?.[1]);
  const shot = Number.isSafeInteger(shotRaw) && shotRaw > 0 ? shotRaw : undefined;

  return {
    id: event.id,
    pubkey: event.pubkey,
    requestId,
    amountSats: Math.floor(amountSats),
    provider,
    note: event.content.trim(),
    claimedFunders: [...new Set(claimedFunders)],
    ...(shot ? { shot } : {}),
    createdAt: event.created_at,
  };
}

export type ComputeCreditStage = 'requested' | 'token_sent' | 'agent_confirmed' | 'redeemed';

export interface ComputeCreditProgress {
  shot: ComputeCreditShot;
  amountSats: number;
  stage: ComputeCreditStage;
}

/** Derive retry-safe progress without treating a donor claim as payment proof. */
export function computeCreditProgress(
  request: ComputeCreditRequest,
  fulfillments: ComputeCreditFulfillment[],
  receipts: ComputeCreditReceipt[],
): ComputeCreditProgress[] {
  const shots = getComputeCreditTranches(request).map((_, index) => index + 1 as ComputeCreditShot);
  const confirmed = confirmedComputeCreditShots(request, fulfillments);
  const claims = new Set(
    fulfillments
      .filter((f) => f.requestId === request.id && f.requesterPubkey === request.pubkey && f.pubkey !== request.pubkey)
      .map((f) => requestShot(request, f.shot))
      .filter((shot): shot is ComputeCreditShot => shot !== undefined),
  );
  const redeemed = new Set(
    receipts
      .filter((r) => r.requestId === request.id && r.pubkey === request.pubkey)
      .map((r) => requestShot(request, r.shot))
      .filter((shot): shot is ComputeCreditShot => shot !== undefined),
  );
  return shots.map((shot) => ({
    shot,
    amountSats: getComputeCreditTranches(request)[shot - 1] ?? 0,
    stage: redeemed.has(shot) ? 'redeemed' : confirmed.has(shot) ? 'agent_confirmed' : claims.has(shot) ? 'token_sent' : 'requested',
  }));
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

  const claimsByRequest = new Map<string, Map<ComputeCreditShot, Set<string>>>();
  for (const f of input.fulfillments) {
    const request = requestById.get(f.requestId);
    if (!request) continue;
    if (f.requesterPubkey !== agentPubkey) continue; // p tag must match the real requester
    if (f.pubkey !== agentPubkey) {
      const shot = requestShot(request, f.shot);
      if (shot === undefined) continue;
      const byShot = claimsByRequest.get(f.requestId) ?? new Map<ComputeCreditShot, Set<string>>();
      const set = byShot.get(shot) ?? new Set<string>();
      set.add(f.pubkey);
      byShot.set(shot, set);
      claimsByRequest.set(f.requestId, byShot);
    }
  }

  const claimants = new Set<string>();
  let fundedRequests = 0;
  let selfReportedSats = 0;
  for (const [requestId, requestClaims] of claimsByRequest) {
    const request = requestById.get(requestId);
    if (!request || !isComputeCreditRequestConfirmed(request, input.fulfillments)) continue;
    const expectedShots = getComputeCreditTranches(request).map((_, index) => index + 1 as ComputeCreditShot);
    // A double-shot request needs an independent funder claim for each payout;
    // one claim plus two self-confirmations must not inflate the full amount.
    if (!expectedShots.every((shot) => (requestClaims.get(shot)?.size ?? 0) > 0)) continue;
    fundedRequests += 1;
    selfReportedSats += getComputeCreditTranches(request).reduce((total, amount) => total + amount, 0);
    for (const shotClaims of requestClaims.values()) {
      for (const c of shotClaims) claimants.add(c);
    }
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
