/**
 * dmCallLane - call-signaling payloads on the NIP-17 DM lane.
 *
 * The strict schema from `@bao/community` (`buildCallSignal` /
 * `parseCallSignal`, phase 2a) is:
 *
 *   { v: 1, t: 'bao-call-v1', op, callId, iat, exp, rn }
 *
 * Per ADR §2 ("pubs exchanged in the wrapped offer/accept"), the call layer
 * carries two EXTRA fields alongside the schema fields:
 *
 *   epk   - the sender's per-call ephemeral X25519 public key (64 lowercase
 *           hex; the secret never leaves the device),
 *   nonce - the caller-minted 16-byte transcript nonce `callNonceHex`
 *           (32 lowercase hex).
 *
 * `parseCallSignal` is STRICT ON THE WAY IN: it validates the known fields
 * and DROPS unknown extras, never echoing them into its result. That is
 * deliberate (a parser result is the only source of typed signals
 * downstream). The extras are therefore read from the RAW payload object by
 * this module, and only after `parseCallSignal` has validated the schema -
 * a payload whose known fields are malformed is discarded before `epk` /
 * `nonce` are even looked at. Both values are re-validated here: the lane is
 * untrusted content.
 */

import { buildCallSignal, type DmCallOp } from '@/baofund/community/dmSignaling.js';
import type { DmCallEphemeral, DmCallOfferKeys } from '@/baofund/community/dmCallKeys.js';

/** Signal validity window on the lane: 60 s (the 30 s ring timeout plus
 *  relay latency, so a stale replay beyond the ring window self-expires). */
export const DM_CALL_SIGNAL_TTL_SEC = 60;

const EPK_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

export interface DmCallEnvelopeExtras {
  /** Sender ephemeral X25519 pubkey (64 lowercase hex), or null. */
  epk: string | null;
  /** Caller transcript nonce (32 lowercase hex), or null. */
  nonce: string | null;
}

/**
 * Read the extras from a RAW lane payload object. Never throws; anything
 * malformed is null (the caller fails closed on a missing/invalid value it
 * needs).
 */
export function readDmCallExtras(payload: unknown): DmCallEnvelopeExtras {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { epk: null, nonce: null };
  const p = payload as Record<string, unknown>;
  const epk = typeof p.epk === 'string' && EPK_RE.test(p.epk) ? p.epk : null;
  const nonce = typeof p.nonce === 'string' && NONCE_RE.test(p.nonce) ? p.nonce : null;
  return { epk, nonce };
}

export interface BuildDmCallSignalInput {
  op: DmCallOp;
  callId: string;
  /** Millisecond-free unix seconds; defaults to the clock's now. */
  iat?: number;
  ttlSec?: number;
  rn?: string;
  nowSec?: () => number;
  /** Sender ephemeral pub to attach (offer: caller's, accept: callee's). */
  epk?: string;
  /** Transcript nonce to attach (offer mints it; accept echoes it). */
  nonce?: string;
}

/**
 * Build one lane payload: the validated schema fields plus the raw extras
 * (when provided). The result is a plain object so `buildDmWrap` pads and
 * wraps it exactly like a text DM.
 */
export function buildDmCallPayload(input: BuildDmCallSignalInput): Record<string, unknown> {
  const signal = buildCallSignal(input.op, {
    callId: input.callId,
    ...(input.iat !== undefined ? { iat: input.iat } : {}),
    ttlSec: input.ttlSec ?? DM_CALL_SIGNAL_TTL_SEC,
    ...(input.rn !== undefined ? { rn: input.rn } : {}),
    ...(input.nowSec ? { clock: { nowSec: input.nowSec } } : {}),
  });
  const payload: Record<string, unknown> = { ...signal };
  if (input.epk !== undefined) payload.epk = input.epk;
  if (input.nonce !== undefined) payload.nonce = input.nonce;
  return payload;
}

/** Convenience: the caller-side offer payload from the minted offer keys. */
export function buildDmCallOfferPayload(
  op: Extract<DmCallOp, 'offer'>,
  callId: string,
  keys: DmCallOfferKeys,
  opts: { rn?: string; nowSec?: () => number } = {},
): Record<string, unknown> {
  return buildDmCallPayload({
    op,
    callId,
    rn: opts.rn,
    epk: keys.ephemeral.pubHex,
    nonce: keys.callNonceHex,
    ...(opts.nowSec ? { nowSec: opts.nowSec } : {}),
  });
}

/** Convenience: the callee-side accept payload from the responder ephemeral
 *  (the offer's nonce is echoed so both derivation call sites are uniform). */
export function buildDmCallAcceptPayload(
  callId: string,
  nonce: string,
  ephemeral: DmCallEphemeral,
  opts: { rn?: string; nowSec?: () => number } = {},
): Record<string, unknown> {
  return buildDmCallPayload({
    op: 'accept',
    callId,
    rn: opts.rn,
    epk: ephemeral.pubHex,
    nonce,
    ...(opts.nowSec ? { nowSec: opts.nowSec } : {}),
  });
}
