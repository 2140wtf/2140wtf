/**
 * Scroll segment codec — spec §3.2.
 *
 * Content: NIP-44 v2 to the room content key of a JSON manifest
 *   { count, first_event_id, last_event_id, messages: [<ephemeral EVENT json>] }
 *
 * BLIND SCRIBE FORMAT (v2): messages are the full, signed kind-21045
 * ephemeral events — NOT decrypted envelopes. The scribe packs ciphertext
 * it cannot read (spec §5.1 headline property); readers verify each
 * message's outer signature and decrypt per message.
 * padded to EXACTLY 24 KB (see SEGMENT_CONTENT_SIZE for why not 32 KB).
 *
 * Tags: d = bao-scroll:<roomId>:<seg#>, prev-chain, flush reason,
 * NIP-40 expiration for time-window rooms, ['-'].
 *
 * Timestamp discipline: addressable kind → strictly monotonic created_at
 * (§11) — never past-jittered, or replacement silently no-ops.
 */
import { type NostrEvent, type Clock, type Rng } from './crypto.js';
import type { Envelope } from './envelope.js';
export interface SegmentManifest {
    count: number;
    first_event_id: string | null;
    last_event_id: string | null;
    /** Serialized kind-21045 events, in scribe order. */
    messages: string[];
}
export type FlushReason = 'size' | 'time' | 'purge' | 'redact';
export interface SegmentContext {
    roomId: string;
    /** Room CONTENT key — decrypts the packed message envelopes. Readers
     *  have it; blind scribes never do. */
    encKey: Uint8Array;
    /** Scroll-wrapper key for the padded CONTAINER. Readers derive it from
     *  encKey; blind scribes are provisioned with it directly. */
    segKey?: Uint8Array;
    /** Routing tag — readers verify each packed event against it. */
    routingId: string;
    /** Current epoch for envelope acceptance. */
    epoch?: number;
    /** NIP-40 expiration (absolute unix seconds) for time-window rooms. */
    expiration?: number;
}
export declare function manifestFor(events: NostrEvent[]): SegmentManifest;
/**
 * Serialize envelopes into a manifest and pad to exactly 24 KB.
 *
 * The padded bundle is binary (length header + zero fill). It is
 * base64-encoded before NIP-44 encryption so the plaintext is pure ASCII —
 * a latin1 pseudo-string would be utf8-re-encoded by NIP-44 libraries,
 * inflating the ciphertext and corrupting foreign decoders. base64 keeps
 * the wire event at ~44.6 KB, safely under strfry's 64 KB maxEventSize.
 */
export declare function encodeSegmentContent(events: NostrEvent[], containerEncKey: Uint8Array, rng?: Rng): string;
export declare function decodeSegmentContent(content: string, ctx: SegmentContext): {
    manifest: SegmentManifest;
    envelopes: Envelope[];
    warnings: string[];
};
export interface EncodeSegmentArgs {
    scribeSecretKey: Uint8Array;
    events: NostrEvent[];
    seg: number;
    prevSegmentId: string | null;
    flush: FlushReason;
    ctx: SegmentContext;
    previousCreatedAt?: number;
    clock?: Clock;
    rng?: Rng;
}
/** Build + sign a kind-31145 segment event (monotonic created_at, §11). */
export declare function encodeSegmentEvent(args: EncodeSegmentArgs): NostrEvent;
export interface DecodedSegment {
    event: NostrEvent;
    seg: number;
    prevSegmentId: string | null;
    flush: FlushReason;
    envelopes: Envelope[];
    /** Duplicate (author, msg_id) copies dropped during decode — logical
     *  duplicates from honest cross-ratchet republish, or a misbehaving
     *  scribe stuffing the scroll. Evidence, surfaced never silently. */
    warnings: string[];
}
/** Verify + decode a segment event. Throws on any failure. */
export declare function decodeSegmentEvent(event: NostrEvent, ctx: SegmentContext): DecodedSegment;
/**
 * Tombstone rewrite (§3): replace a segment's messages with redacted
 * tombstones. Governance/mod-driven; scribe re-signs its own segment.
 */
export declare function tombstoneEnvelopes(envelopes: Envelope[], redactedKeys: Set<string>, ts: string): Envelope[];
