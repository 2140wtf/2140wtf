// src/wallet/keySchedule.ts
//
// Wallet key schedule - HMAC-SHA512 labeled subkey derivation.
//
// Port of Carbonado v2's `derive_subkey` (bitmask-stack/carbonado,
// src/crypto.rs): the master secret is used as the PRF key of HMAC-SHA512
// and every derived subkey is `HMAC-SHA512(master, prefix || label)`.
// This gives BIP-32-style key separation without curve math:
//   - two labels derive independent keys (domain separation),
//   - a subkey never reveals the master (HMAC is one-way),
//   - the full 64-byte output can feed both 32-byte keys and 64-byte MAC keys.
//
// Domain separation: labels live under `baofund-kdf/v1/` - deliberately NOT
// Carbonado's `carbonado-v2/` namespace. Our subkeys are our own; a shared
// prefix would needlessly couple our key schedule to Carbonado file formats.
//
// FROZEN legacy derivations (do NOT migrate to this KDF):
//   - deriveIdentityPrivkey  ('baofund:identity:v1')
//   - deriveFreshWalletKey   ('baofund:walletkey:v1')
//   - the cashu HKDF info-strings in src/lib/cashu/cashu.ts
// Existing users' keys are pinned by cross-app wallet recovery; re-deriving
// them through this KDF would silently change every wallet. keySchedule.test.ts
// regression-locks their exact outputs. All NEW wallet key derivations MUST
// go through here so they inherit the registry discipline below.

import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/** Domain-separation prefix for every label (mirrors Carbonado's LABEL_PREFIX). */
export const BAO_KDF_PREFIX = 'baofund-kdf/v1/';

/**
 * Normative label registry (mirrors Carbonado's AGENTS.md §2.1 discipline):
 * every derivation MUST use a label registered here, and every registered
 * label MUST document its consumer and output usage. Adding a label is a
 * protocol decision - labels are forever (removing one orphans derived keys).
 */
export const KDF_LABELS = {
  /**
   * Per-artifact master key for PRIVATE milestone evidence:
   * `deriveSubkey32(identity, 'evidence-encryption')`. Never used directly
   * as a cipher/MAC key - it is itself the PRF master for the two purpose
   * labels below (Carbonado-style two-step separation). Consumed by
   * src/lib/evidence/encryptedEvidence.ts.
   */
  evidenceEncryption: 'evidence-encryption',
  /**
   * AES-256-CTR encryption subkey for PRIVATE milestone evidence. First
   * 32 bytes of `deriveSubkey(artifactMaster, 'evidence-enc-ctr')`.
   * Mirrors Carbonado's `aes-ctr` label discipline.
   */
  evidenceEncCtr: 'evidence-enc-ctr',
  /**
   * Full 64-byte HMAC-SHA512 EtM subkey for PRIVATE milestone evidence.
   * `deriveSubkey(artifactMaster, 'evidence-enc-etm')`. Mirrors Carbonado's
   * `etm-hmac` label discipline.
   */
  evidenceEncEtm: 'evidence-enc-etm',
  /**
   * Per-room pseudonymous chat MEMBER identity (first 32 bytes of
   * `deriveSubkey(identity, 'chat-room-identity', utf8(roomId))`). Consumed
   * by src/chat/memberIdentity.ts as the durable room stream key. Purposes:
   * (1) recognise a member across rejoins, (2) give bans/roles a stable
   * principal to name, (3) keep every room unlinkable to the login npub and
   * to other rooms. The label is scoped by roomId context on purpose: no
   * context (or a different room) derives a different key. This is a
   * key-control identity only - never a personhood claim.
   */
  chatRoomIdentity: 'chat-room-identity',
} as const;

const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Derive a 64-byte subkey: HMAC-SHA512(master, BAO_KDF_PREFIX + label [+ context]). */
export function deriveSubkey(master: Uint8Array, label: string, context?: Uint8Array): Uint8Array {
  if (master.length < 32) {
    // Carbonado's documented contract: masters are ≥256-bit PRF keys. Every
    // caller here derives from 32-byte identity/seed material.
    throw new Error(`keySchedule: master must be at least 32 bytes (got ${master.length})`);
  }
  if (!LABEL_RE.test(label)) {
    throw new Error(`keySchedule: label must be lowercase kebab (a-z, 0-9, -), max 64 chars - got "${label}"`);
  }
  const prefixBytes = new TextEncoder().encode(BAO_KDF_PREFIX + label);
  if (!context || context.length === 0) return hmac(sha512, master, prefixBytes);
  // Context domain-separates derivations of the SAME label: e.g. per-artifact
  // keys under one label each get an independent key (Carbonado-style
  // per-record KDF). The label registry stays clean - the context is data,
  // not a new label. Existing derivations (no context) are byte-identical.
  return hmac(sha512, master, new Uint8Array([...prefixBytes, ...context]));
}

/** First 32 bytes of a labeled subkey - for 32-byte keys (Nostr privkeys, AES-256, entropy). */
export function deriveSubkey32(master: Uint8Array, label: string): Uint8Array {
  return deriveSubkey(master, label).slice(0, 32);
}
