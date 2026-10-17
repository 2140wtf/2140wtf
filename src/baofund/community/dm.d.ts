import { type Clock, type NostrEvent, type PrivacyPolicy, type Rng } from './crypto.js';
/** NIP-17 DM rumor kind (carries the padded JSON payload). */
export declare const DM_RUMOR_KIND = 14;
/** ADR: DM wraps use a FORWARD bias inside a 60 s window (vs the 600 s
 *  public default) — still inside every stock relay's acceptance window. */
export declare const DM_TIMESTAMP_POLICY: PrivacyPolicy;
/** Default wrap TTL: 48 h — long enough for offline catch-up, short enough
 *  that the relay does not accumulate dead envelopes forever. */
export declare const DEFAULT_DM_TTL_SEC: number;
export interface BuildDmOptions {
    /** NIP-40 expiration TTL in seconds. Minimum 60 (a shorter wrap can
     *  self-expire before the recipient's relay round-trip completes). */
    ttlSec?: number;
    rng?: Rng;
    clock?: Clock;
}
export interface DmEnvelope {
    /** Sender identity pubkey (verified via the seal's signature chain). */
    from: string;
    /** Recipient identity pubkey (the key that unsealed this wrap). */
    to: string;
    /** The JSON payload the sender passed to buildDmWrap. */
    payload: unknown;
    /** Rumor created_at (real send time; the outer wrap is jittered). */
    createdAt: number;
    /** Outer event id — the relay-visible handle for acks/dedupe. */
    wrapId: string;
}
/**
 * Wrap a DM payload (any JSON-serializable value) into the relay-accepted
 * NIP-17 shape for `toPub`. Returns the signed kind-1059 event to publish.
 */
export declare function buildDmWrap(payload: unknown, toPub: string, fromSecretKey: Uint8Array, opts?: BuildDmOptions): NostrEvent;
/**
 * Open a DM wrap addressed to `recipientSecretKey`. Returns null when the
 * wrap is not for us, fails signature/decrypt verification, or does not
 * carry a kind-14 payload — never throw on attacker-controlled input.
 */
export declare function openDmWrap(wrap: NostrEvent, recipientSecretKey: Uint8Array): DmEnvelope | null;
