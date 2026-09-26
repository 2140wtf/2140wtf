/**
 * Disclosure dial + custody tiers — spec §10.
 *
 * Disclosure is per user, per room, ONE-WAY (you can reveal more, never
 * less — UI must say so). All disclosure state travels INSIDE the room,
 * encrypted to the room content key: the relay never sees which stream key
 * belongs to which persona/main key.
 *
 *   verified       main npub (+ optional NIP-05) shown to members — the
 *                  badge is cryptographic (a signature by the main key),
 *                  unforgeable.
 *   named-persona  a display name bound to the device persona (default).
 *   full-pseudonym nothing beyond the stream key (chain admins-only).
 *
 * Custody is a CLIENT policy, not a protocol constraint (spec §10):
 *   strict  persona per device, one main-key signature, re-wraps.
 *   synced  passphrase-encrypted key-bundle export/import (this module).
 *   bunker  NIP-46 remote signing — interface passthrough only (the
 *           bunker satisfies MainSigner; this module adds nothing).
 */
import { type NostrEvent, type EventTemplate, type Clock, type Rng, bytesToHex, hexToBytes, utf8ToBytes } from './crypto.js';
import type { MainSigner } from './attestation.js';
export type DisclosureLevel = 'verified' | 'named-persona' | 'full-pseudonym';
/**
 * An in-room disclosure claim. Signed by the stream key (binding the claim
 * to the room author); 'verified' level additionally carries a signature
 * by the MAIN key over the same fields (the unforgeable badge).
 *
 * Signed event kind reuses the governance state carrier kind — these
 * events are envelope payload material, NEVER relay-published.
 */
export interface DisclosureClaim {
    level: DisclosureLevel;
    streamPub: string;
    roomId: string;
    /** Display name for 'named-persona' (and optionally 'verified'). */
    name?: string;
    /** Main npub for 'verified'. */
    mainPub?: string;
    /** NIP-05 identifier for 'verified' (display hint; clients may verify). */
    nip05?: string;
    /** Signed by the stream key. */
    event: NostrEvent;
    /** Signed by the main key over identical tags — REQUIRED for
     *  'verified', absent otherwise. */
    mainEvent?: NostrEvent;
}
/**
 * Build a disclosure claim. For 'verified', pass a MainSigner (extension —
 * the badge signature proves main-key control without the nsec).
 */
export declare function buildDisclosureClaim(streamSecretKey: Uint8Array, roomId: string, level: DisclosureLevel, opts?: {
    name?: string;
    nip05?: string;
    main?: MainSigner;
    clock?: Clock;
}): Promise<DisclosureClaim>;
/** Envelope payload for in-room carriage. */
export interface DisclosurePayload {
    type: 'disclosure';
    claim: {
        event: NostrEvent;
        mainEvent?: NostrEvent;
    };
}
export declare function disclosurePayload(claim: DisclosureClaim): DisclosurePayload;
/** Tolerant parse + full verification of a disclosure payload. Returns
 *  null for foreign payloads; throws are converted to null (a malformed
 *  claim is ignored at render, never fatal). */
export declare function parseDisclosurePayload(payload: unknown): DisclosureClaim | null;
/**
 * One-way dial enforcement (spec §10: disclosure is one-way per room):
 * given the member's PREVIOUS level, reject transitions that reveal less.
 * Ordering: full-pseudonym (0) < named-persona (1) < verified (2).
 */
export declare function disclosureTransitionAllowed(previous: DisclosureLevel, next: DisclosureLevel): boolean;
/**
 * Export bundle (spec §10 'synced' variant): the full local hierarchy —
 * persona key + per-room stream keys + chain keys — encrypted with a key
 * derived from the passphrase via HKDF-SHA256 over a random salt:
 *
 *   bundleKey = HKDF(sha256, utf8(passphrase), salt, "bao/custody/bundle", 32)
 *
 * then NIP-44 v2 with bundleKey as the conversation key. A leak of the
 * bundle compromises all devices/rooms in it — labeled on export.
 *
 * NOTE: HKDF is a KDF, not a password hash — passphrase strength is the
 * only brute-force defense. Clients SHOULD enforce a minimum passphrase
 * length (this module enforces ≥ 12 chars).
 */
export interface KeyBundle {
    v: 1;
    /** Device persona secret key (hex). */
    personaSecretKey: string;
    /** Per-room stream keys: roomId → stream secret key (hex). */
    streamKeys: Record<string, string>;
    /** Per-room chain keys: roomId → { chainKey, epoch }. */
    chainKeys: Record<string, {
        chainKey: string;
        epoch: number;
    }>;
    /** Retired stream keys (kind-5 deletion ownership, spec §2). */
    retiredStreamKeys?: Record<string, string[]>;
}
export interface ExportedBundle {
    /** NIP-44 v2 ciphertext of the JSON bundle (NIP-44 pads internally). */
    ciphertext: string;
    /** Random HKDF salt (hex) — NOT secret. */
    salt: string;
}
export declare const MIN_PASSPHRASE_LENGTH = 12;
export declare function exportKeyBundle(bundle: KeyBundle, passphrase: string, rng?: Rng): ExportedBundle;
export declare function importKeyBundle(exported: ExportedBundle, passphrase: string): KeyBundle;
/**
 * NIP-46 bunker custody: the keys stay on a remote always-on signer. The
 * protocol adds NOTHING — any NIP-46 client that can getPublicKey +
 * signEvent satisfies MainSigner (attestation.ts) and drops in. This type
 * alias exists to name the tier at call sites.
 */
export type BunkerSigner = MainSigner;
export { bytesToHex, hexToBytes, utf8ToBytes };
export type { EventTemplate };
