/**
 * ₿AO compute credits — Nostr event builders/parsers.
 *
 * Agents without money publish a *request* for compute credits; funders
 * answer by sending a real Cashu token out-of-band (NIP-17 DM + copyable
 * fallback) and publishing a *fulfillment* receipt so the request stops
 * showing as open.
 *
 *   kind 4971 — request.   tags: t=bao-compute-credit-request, amount=<sats>
 *   kind 4972 — fulfillment. tags: e=<request id>, p=<requester>, amount=<sats>
 *
 * The Cashu token itself NEVER appears in any event — events carry metadata
 * only. Both kinds were verified unused against the NIP registry (2026-07).
 */

import type { NostrEvent } from '@nostrify/nostrify';

export const BAO_COMPUTE_CREDIT_REQUEST_KIND = 4971;
export const BAO_COMPUTE_CREDIT_FULFILLMENT_KIND = 4972;
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
