/**
 * shield — NIP-59 gift-wrap transport for shielded rooms (protocol §7, P5).
 *
 * Super-private rooms (config B) route message UPLOADS through a shield hop:
 * the client gift-wraps the signed envelope event to the shield's pubkey
 * (kinds 13+1059 — standard NIP-59), so the relay never sees the routing
 * tag, the sender, or the room. The shield unwraps, validates, BATCHES
 * (N msgs or T ms) and re-publishes the inner event over the NORMAL relay
 * path — the scribe ingests it exactly as a direct message. Read path,
 * segments, d-tags, receipts: byte-identical v1.
 *
 * Author/signature preservation: createRumor spreads the signed event
 * (author + sig survive — the re-computed rumor id equals the original id),
 * the seal is signed by the envelope author's key, and the outer wrap is
 * signed by a FRESH random key — the relay sees a random sender, and the
 * shield's re-published event verifies under the author key the scribe
 * expects. Pure module (no relay I/O, no env) — the daemon wires it.
 */
import { generateSecretKey, finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { createRumor, createSeal, unwrapEvent } from 'nostr-tools/nip59';
import { verifyEvent, privacyTimestamp, padJsonToBucket } from './crypto.js';
import { GIFT_WRAP_KIND } from './kinds.js';
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
export function giftWrapEnvelope(signedEvent, shieldPub, authorSecretKey, opts = {}) {
    const rng = opts.rng ?? ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
    const clock = opts.clock ?? { nowSec: () => Math.floor(Date.now() / 1000) };
    const ttl = opts.ttlSec ?? 3600;
    // Require minimum 60s TTL — sub-minute wraps self-expire before the shield
    // can unwrap and re-publish (the shield batch window is typically 1-5s,
    // but network latency can exceed sub-second TTLs). Prevents silent data loss.
    if (ttl < 60)
        throw new Error(`ttlSec must be >= 60 (got ${ttl})`);
    const authorPub = getPublicKey(authorSecretKey);
    if (authorPub !== signedEvent.pubkey)
        throw new Error('authorSecretKey does not match signedEvent.pubkey');
    const rumor = createRumor(signedEvent, authorSecretKey); // keeps the original sig; id unchanged
    const seal = createSeal(rumor, authorSecretKey, shieldPub);
    const wrapKey = generateSecretKey(); // fresh random sender — relay sees an uncorrelatable signer
    const wrapConvKey = nip44.v2.utils.getConversationKey(wrapKey, shieldPub);
    // Relay-leak hardening (config B, leak analysis 2026-08-19): the wrap's
    // created_at gets privacyTimestamp jitter per the room's relay-class policy
    // (§11; default FORWARD/600s — vanilla strfry hard-rejects both >60s-old
    // and >~15min-future timestamps, bisected live 2026-08-23; private rooms
    // on a patched relay pass the full backward window) — NIP-59 itself
    // recommends randomized wrap timestamps — and the seal JSON is padded to
    // a §11 bucket, so exact send times and content sizes don't leak through
    // the wrap stream. The NIP-40 expiration stays REAL (wrappers must
    // actually expire); jitter only moves creation time within the policy.
    return finalizeEvent({
        kind: GIFT_WRAP_KIND,
        content: nip44.v2.encrypt(padJsonToBucket(JSON.stringify(seal)), wrapConvKey, rng(32)),
        created_at: privacyTimestamp(clock, rng, opts.policy),
        tags: [
            ['p', shieldPub],
            ['expiration', String(clock.nowSec() + ttl)],
            ['-'],
        ],
    }, wrapKey);
}
/**
 * Unwrap a shielded envelope event and validate it for re-publication.
 * Returns the inner event only when EVERYTHING checks out:
 *   - the wrap decrypts with the shield key (addressed to us);
 *   - the rumor's `#r` routing tag is in the shield's allowed set;
 *   - the rumor verifies (valid author signature).
 */
export function unwrapShielded(wrap, ctx) {
    let inner;
    try {
        // unwrapEvent returns a Rumor (UnsignedEvent + id) — cast to NostrEvent
        // because Rumor has all NostrEvent fields (sig, pubkey, kind, etc.).
        // verifyEvent() below recomputes the id from unsigned event + sig,
        // confirming the cast is type-correct at runtime.
        inner = unwrapEvent(wrap, ctx.shieldSecretKey);
    }
    catch {
        return null; // not decryptable with our key — not addressed to us
    }
    const routingId = inner.tags.find((t) => t[0] === 'r')?.[1];
    if (!routingId || !ctx.allowedRoutingIds.has(routingId))
        return null;
    const verify = ctx.verify ?? verifyEvent;
    if (!verify(inner))
        return null;
    return inner;
}
/** The REQ filter a shield daemon subscribes with: wraps addressed to it. */
export function shieldFilterFor(shieldPub) {
    return { kinds: [GIFT_WRAP_KIND], '#p': [shieldPub] };
}
/**
 * Per-room queue that flushes when the message count OR the window elapses,
 * with optional uniform jitter on the window. Fuels the "hand the relay as
 * little timing correlation as possible" property of shielded rooms.
 */
export class ShieldBatcher {
    constructor(policy, onFlush, now = Date.now, rng = Math.random) {
        this.policy = policy;
        this.onFlush = onFlush;
        this.now = now;
        this.rng = rng;
        this.queues = new Map();
        this.timers = new Map();
        this.inFlight = new Set();
        if (policy.maxMessages < 1 || policy.maxWindowMs < 1)
            throw new Error('BatchPolicy must be positive');
    }
    push(routingId, event) {
        const q = this.queues.get(routingId) ?? [];
        q.push(event);
        this.queues.set(routingId, q);
        if (!this.timers.has(routingId))
            this.arm(routingId);
        if (q.length >= this.policy.maxMessages)
            this.flush(routingId);
    }
    arm(routingId) {
        const jitter = this.policy.jitterMs ? Math.floor(this.rng() * (this.policy.jitterMs + 1)) : 0;
        const timer = setTimeout(() => this.flush(routingId), this.policy.maxWindowMs + jitter);
        timer.unref?.();
        this.timers.set(routingId, timer);
    }
    flush(routingId) {
        const timer = this.timers.get(routingId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(routingId);
        }
        const events = this.queues.get(routingId);
        if (!events || events.length === 0)
            return Promise.resolve();
        this.queues.delete(routingId);
        // Tracked so shutdown can await in-flight deliveries instead of
        // dropping them (audit FIX 5 — shielded messages were lost on exit).
        const p = Promise.resolve().then(() => this.onFlush({ routingId, events }));
        this.inFlight.add(p);
        void p.catch(() => { }).finally(() => this.inFlight.delete(p));
        return p;
    }
    flushAll() {
        const all = [...this.queues.keys()].map((routingId) => this.flush(routingId));
        return Promise.all([...all, ...this.inFlight]).then(() => { });
    }
    pending() {
        return [...this.queues.values()].reduce((n, q) => n + q.length, 0);
    }
}
