/**
 * Low-level cryptographic helpers for the BAO Court / Juror Mode threshold oracle.
 *
 * Browser-compatible: uses @noble/curves and @noble/hashes instead of Node crypto.
 */

import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as frost from '@vbyte/frost';
import type { PublicNonce } from '@vbyte/frost';

const SCALAR_ORDER = secp256k1.Point.Fn.ORDER;

function modN(x: bigint): bigint {
  const r = x % SCALAR_ORDER;
  return r < 0n ? r + SCALAR_ORDER : r;
}

export function randomHex32(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Return a uniformly random non-zero scalar in the secp256k1 field.
 *
 * Uses `@noble/curves`'s vetted `randomSecretKey()` implementation, which
 * samples from `[1, n-1]` without modulo bias.
 */
export function randomScalar(): bigint {
  return bytesToNumberBE(secp256k1.utils.randomSecretKey());
}

/** Encode a scalar as a 32-byte zero-padded hex string. */
export function scalarToHex(s: bigint): string {
  return bytesToHex(numberToBytesBE(modN(s), 32));
}

/**
 * Derive the x-only public key from a 32-byte secret key hex string.
 */
export function deriveXOnlyPubkey(seckeyHex: string): string {
  const pk = schnorr.getPublicKey(hexToBytes(seckeyHex));
  return bytesToHex(pk);
}

/**
 * Build the canonical attestation message that all jurors sign.
 */
export function buildAttestationMessage(
  marketId: string,
  outcome: string,
  round: number | string,
  disputeEventId?: string,
): string {
  const parts = [marketId, outcome, String(round)];
  if (disputeEventId) parts.push(disputeEventId);
  return bytesToHex(sha256(new TextEncoder().encode(parts.join('|'))));
}

export function aggregatePublicNonce(pnonces: PublicNonce[]): string {
  const binders = frost.Lib.get_group_binders(
    pnonces,
    frost.Lib.get_commits_prefix(pnonces),
  );
  return frost.Lib.get_group_pubnonce(pnonces, binders);
}

export function verifyFinalSignature(
  groupPubkey: string,
  messageHex: string,
  signatureHex: string,
): boolean {
  const keyCtx = frost.Lib.get_group_key_context(groupPubkey);
  return frost.Lib.verify_final_sig(
    keyCtx,
    hexToBytes(messageHex),
    hexToBytes(signatureHex),
  );
}

export function verifySchnorr(
  pubkeyHex: string,
  messageHex: string,
  signatureHex: string,
): boolean {
  return schnorr.verify(
    hexToBytes(signatureHex),
    hexToBytes(messageHex),
    hexToBytes(pubkeyHex),
  );
}

export { frost };
export type { PublicNonce };
