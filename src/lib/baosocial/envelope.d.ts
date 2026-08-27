/**
 * Envelope codec — spec §3.1. The envelope is the decrypted content of a
 * kind-21045 ephemeral message: NIP-44 v2 to the room content key.
 *
 * dedup key = (author, msg_id) — this is what makes retry-until-scrolled
 * safe (§3).
 */
import { type NostrEvent, type Clock, type Rng, type RelayClass, type PrivacyPolicy } from './crypto.js';
export interface Envelope {
    v: 1;
    /** 16 random bytes, hex. */
    msg_id: string;
    room: string;
    epoch: number;
    /** Author pubkey (hex). Redundant with the outer event; enforced equal. */
    author: string;
    payload: unknown;
}
export interface EnvelopeContext {
    roomId: string;
    epoch: number;
    encKey: Uint8Array;
    routingId: string;
}
/** (author, msg_id) — the dedup key enforced by scribes and clients. */
export declare function dedupKey(env: Pick<Envelope, 'author' | 'msg_id'>): string;
export declare function newMsgId(rng?: Rng): string;
export declare function buildEnvelope(authorSecretKey: Uint8Array, payload: unknown, ctx: EnvelopeContext, rng?: Rng): Envelope;
export declare function serializeEnvelope(env: Envelope): string;
export declare function parseEnvelope(json: string): Envelope;
/**
 * Epoch acceptance window (spec §3.1): P1 = current epoch only (window 0).
 * P2 grace during epoch roll-over: window 1 accepts the current AND the
 * previous epoch, so in-flight envelopes from just before the roll are
 * not dropped. Wider windows weaken the delayed-re-injection defense.
 */
export declare function epochAccepted(envEpoch: number, currentEpoch: number, window?: number): boolean;
/** P2 default grace: accept the previous epoch during roll-over. */
export declare const P2_EPOCH_WINDOW = 1;
/**
 * Build, encrypt, and sign a kind-21045 ephemeral event. Timestamp is
 * privacyTimestamp-jittered per the relay-class POLICY (§11: observer
 * uncertainty = policy.windowSec; public relays keep the vanilla-safe
 * forward default, private relays full backward jitter).
 */
export declare function encodeEphemeralEvent(authorSecretKey: Uint8Array, payload: unknown, ctx: EnvelopeContext, clock?: Clock, rng?: Rng, policy?: RelayClass | PrivacyPolicy | number): {
    event: NostrEvent;
    envelope: Envelope;
};
/**
 * Re-encode an EXISTING envelope (same msg_id) into a fresh ephemeral
 * event — the retry half of retry-until-scrolled (§3). Scribes dedup on
 * (author, msg_id), so republication races are safe.
 */
export declare function encodeEnvelopeEvent(authorSecretKey: Uint8Array, envelope: Envelope, ctx: EnvelopeContext, clock?: Clock, rng?: Rng, policy?: RelayClass | PrivacyPolicy | number): NostrEvent;
/**
 * Verify + decrypt a kind-21045 event into its envelope.
 * Throws on any structural or crypto failure.
 */
export declare function decodeEphemeralEvent(event: NostrEvent, ctx: EnvelopeContext, epochWindow?: number): Envelope;
