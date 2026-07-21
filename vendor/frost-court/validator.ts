/**
 * FROST attestation validator for the BAO Court / FROST appeal layer.
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { Event as NostrEvent } from 'nostr-tools/pure';
import { BAO_COURT_ATTESTATION_KIND } from './events';

export interface ValidationResult {
  readonly valid: boolean;
  readonly pubkey: string;
  readonly outcome?: string;
  readonly message?: string;
  readonly disputeEventId?: string;
  readonly error?: string;
}

function isHex64(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function validateAttestationEvent(
  event: Pick<NostrEvent, 'kind' | 'tags' | 'content' | 'id'>,
  expectedGroupPubkey?: string,
): ValidationResult {
  if (event.kind !== 89 && event.kind !== BAO_COURT_ATTESTATION_KIND) {
    return { valid: false, pubkey: '', error: `Not a Kind 89 or ${BAO_COURT_ATTESTATION_KIND} attestation` };
  }

  const pTag = event.tags.find((t) => t[0] === 'p');
  const sigTag = event.tags.find((t) => t[0] === 'sig');
  const nonceTag = event.tags.find((t) => t[0] === 'nonce');
  const outcomeTag = event.tags.find((t) => t[0] === 'outcome');
  const disputeTag = event.tags.find((t) => t[0] === 'dispute');

  if (!pTag || !sigTag || !nonceTag) {
    return { valid: false, pubkey: '', error: 'Missing required tags' };
  }

  const pubkey = pTag[1];
  const signature = sigTag[1];
  const nonce = nonceTag[1];
  const outcome = outcomeTag?.[1] ?? '';

  if (!pubkey || !isHex64(pubkey)) {
    return { valid: false, pubkey: pubkey ?? '', error: 'Invalid group pubkey' };
  }
  if (!signature || signature.length !== 128) {
    return { valid: false, pubkey, error: 'Invalid signature length' };
  }
  if (!nonce || nonce.length !== 64) {
    return { valid: false, pubkey, error: 'Invalid public nonce length' };
  }

  if (expectedGroupPubkey && pubkey !== expectedGroupPubkey) {
    return {
      valid: false,
      pubkey,
      error: `Pubkey mismatch: expected ${expectedGroupPubkey}, got ${pubkey}`,
    };
  }

  try {
    const content = JSON.parse(event.content || '{}') as Record<string, unknown>;
    const message = String(content.message || '');
    const contentOutcome = content.outcome;
    const contentDisputeId = content.disputeEventId;

    if (!message) {
      return { valid: false, pubkey, error: 'Attestation message missing' };
    }
    if (outcome && contentOutcome && outcome !== String(contentOutcome)) {
      return {
        valid: false,
        pubkey,
        error: 'Outcome tag does not match content outcome',
      };
    }
    if (disputeTag && contentDisputeId && disputeTag[1] !== String(contentDisputeId)) {
      return {
        valid: false,
        pubkey,
        error: 'Dispute tag does not match content dispute id',
      };
    }

    const ok = schnorr.verify(
      hexToBytes(signature),
      hexToBytes(message),
      hexToBytes(pubkey),
    );
    return ok
      ? { valid: true, pubkey, outcome, message, disputeEventId: disputeTag?.[1] }
      : { valid: false, pubkey, error: 'Schnorr signature verification failed' };
  } catch (err) {
    return {
      valid: false,
      pubkey,
      error: `Validation exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function verifyRawSignature(
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
