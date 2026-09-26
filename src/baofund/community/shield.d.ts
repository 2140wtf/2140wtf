import { type NostrEvent, type RelayClass, type PrivacyPolicy } from './crypto.js';
import { type GiftWrapKind } from './kinds.js';
export interface ShieldWrapOptions {
    /** NIP-40 expiration TTL for the wrap (default 3600s). Wraps exist only
     *  to get from client→shield; they must not linger on the relay. */
    ttlSec?: number;
    rng?: (bytes: number) => Uint8Array;
    clock?: {
        nowSec(): number;
    };
    /** Relay-class privacy policy for the wrap's created_at (§11). Default =
     *  forward/600 (public posture) — safe on any relay. Private rooms on a
     *  patched strfry relay pass 'private' (or a custom policy) for the full
     *  backward ±48 h jitter. */
    policy?: RelayClass | PrivacyPolicy | number;
}
/**
 * Gift-wrap a signed envelope event to the shield.
 *
 * @param signedEvent     the signed kind-21045 envelope event (the same one
 *                        a config-A client would publish directly)
 * @param shieldPub       the shield's wrap-recipient pubkey
 * @param authorSecretKey the envelope author's private key (signs the rumor
 *                        and the seal — must match signedEvent.pubkey)
 * @param opts
 */
export declare function giftWrapEnvelope(signedEvent: NostrEvent, shieldPub: string, authorSecretKey: Uint8Array, opts?: ShieldWrapOptions): NostrEvent;
export interface UnwrapContext {
    shieldSecretKey: Uint8Array;
    allowedRoutingIds: ReadonlySet<string>;
    /** Default: verifyEvent() — the rumor must carry a valid author signature. */
    verify?: (inner: NostrEvent) => boolean;
}
/**
 * Unwrap a shielded envelope event and validate it for re-publication.
 * Returns the inner event only when EVERYTHING checks out:
 *   - the wrap decrypts with the shield key (addressed to us);
 *   - the rumor's `#r` routing tag is in the shield's allowed set;
 *   - the rumor verifies (valid author signature).
 */
export declare function unwrapShielded(wrap: NostrEvent, ctx: UnwrapContext): NostrEvent | null;
/** The REQ filter a shield daemon subscribes with: wraps addressed to it. */
export declare function shieldFilterFor(shieldPub: string): {
    kinds: GiftWrapKind[];
    '#p': string[];
};
export interface BatchPolicy {
    maxMessages: number;
    maxWindowMs: number;
    /** Extra uniform random delay added to the window (0..jitterMs). */
    jitterMs?: number;
}
export interface BatchFlush {
    routingId: string;
    events: NostrEvent[];
}
/**
 * Per-room queue that flushes when the message count OR the window elapses,
 * with optional uniform jitter on the window. Fuels the "hand the relay as
 * little timing correlation as possible" property of shielded rooms.
 */
export declare class ShieldBatcher {
    private readonly policy;
    private readonly onFlush;
    private readonly now;
    private readonly rng;
    private readonly queues;
    private readonly timers;
    private readonly inFlight;
    constructor(policy: BatchPolicy, onFlush: (batch: BatchFlush) => void | Promise<void>, now?: () => number, rng?: () => number);
    push(routingId: string, event: NostrEvent): void;
    private arm;
    flush(routingId: string): Promise<void>;
    flushAll(): Promise<void>;
    pending(): number;
}
