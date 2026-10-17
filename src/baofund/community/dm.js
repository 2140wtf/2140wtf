/**
 * dm — 1:1 direct messages on BAO relays (NIP-17 shape, relay-compatible).
 *
 * Owner ADR (ADR-dm-calls.md, "Proposed shape" §1): text DMs — and the
 * call-signaling rider on the same lane — ride ordinary NIP-17 gift wraps
 * on the fund relay:
 *
 *   rumor kind 14 (JSON payload, padded to a §11 bucket, UNSIGNED)
 *     -> seal kind 13 (NIP-44 to the recipient, signed by the sender)
 *       -> outer kind 1059 (fresh random signer; tags: ['p', recipient],
 *          ['expiration', now + TTL], ['-']; created_at forward-jittered
 *          inside 60 s per the ADR).
 *
 * Why a builder instead of nostr-tools' nip17.wrapEvent: the relay's write
 * policy admits kind 1059 ONLY with exactly one valid NIP-40 expiration tag
 * (deploy/write-policy.mjs); wrapEvent emits none, so its wraps are
 * rejected. Every DM on a BAO relay goes through this module.
 *
 * Pair-hiding (ADR §5): the payload JSON is padded to a padding bucket, the
 * seal JSON is padded too, and the outer wrap's created_at is forward-
 * jittered — an observer cannot distinguish a call-signal wrap from any
 * text DM, nor read sizes or exact send times off the wrap stream.
 *
 * Authenticity: the seal is signed by the real sender identity, so the
 * recipient learns `from` from a verified chain even though the kind-14
 * rumor itself is unsigned (NIP-17 canonical). A wrap that fails to
 * decrypt, fails signature verification, or is addressed elsewhere returns
 * null — never a partial result.
 */
import { generateSecretKey, finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { createRumor, createSeal, unwrapEvent } from 'nostr-tools/nip59';
import { verifyEvent, privacyTimestamp, padJsonToBucket, defaultRng, systemClock, } from './crypto.js';
import { GIFT_WRAP_KIND } from './kinds.js';
/** NIP-17 DM rumor kind (carries the padded JSON payload). */
export const DM_RUMOR_KIND = 14;
/** ADR: DM wraps use a FORWARD bias inside a 60 s window (vs the 600 s
 *  public default) — still inside every stock relay's acceptance window. */
export const DM_TIMESTAMP_POLICY = { bias: 'forward', windowSec: 60 };
/** Default wrap TTL: 48 h — long enough for offline catch-up, short enough
 *  that the relay does not accumulate dead envelopes forever. */
export const DEFAULT_DM_TTL_SEC = 48 * 3600;
/**
 * Wrap a DM payload (any JSON-serializable value) into the relay-accepted
 * NIP-17 shape for `toPub`. Returns the signed kind-1059 event to publish.
 */
export function buildDmWrap(payload, toPub, fromSecretKey, opts = {}) {
    const rng = opts.rng ?? defaultRng;
    const clock = opts.clock ?? systemClock;
    const ttl = opts.ttlSec ?? DEFAULT_DM_TTL_SEC;
    if (!Number.isInteger(ttl) || ttl < 60) {
        throw new Error(`dm: ttlSec must be an integer >= 60 (got ${String(ttl)})`);
    }
    const content = padJsonToBucket(JSON.stringify(payload ?? null));
    const rumor = createRumor({ kind: DM_RUMOR_KIND, content, tags: [['p', toPub]], created_at: clock.nowSec() }, fromSecretKey);
    const seal = createSeal(rumor, fromSecretKey, toPub);
    const wrapKey = generateSecretKey(); // fresh random signer: uncorrelatable on the relay
    const convKey = nip44.v2.utils.getConversationKey(wrapKey, toPub);
    return finalizeEvent({
        kind: GIFT_WRAP_KIND,
        content: nip44.v2.encrypt(padJsonToBucket(JSON.stringify(seal)), convKey, rng(32)),
        created_at: privacyTimestamp(clock, rng, DM_TIMESTAMP_POLICY),
        tags: [
            ['p', toPub],
            ['expiration', String(clock.nowSec() + ttl)],
            ['-'],
        ],
    }, wrapKey);
}
/**
 * Open a DM wrap addressed to `recipientSecretKey`. Returns null when the
 * wrap is not for us, fails signature/decrypt verification, or does not
 * carry a kind-14 payload — never throw on attacker-controlled input.
 */
export function openDmWrap(wrap, recipientSecretKey) {
    if (!wrap || wrap.kind !== GIFT_WRAP_KIND)
        return null;
    let inner;
    try {
        if (!verifyEvent(wrap))
            return null;
        inner = unwrapEvent(wrap, recipientSecretKey);
    }
    catch {
        return null; // not decryptable with our key / malformed
    }
    if (!inner || inner.kind !== DM_RUMOR_KIND)
        return null;
    const to = getPublicKey(recipientSecretKey);
    const addressed = inner.tags.some((t) => Array.isArray(t) && t[0] === 'p' && t[1] === to);
    if (!addressed)
        return null; // rumor says it belongs to someone else
    let payload;
    try {
        payload = JSON.parse(inner.content);
    }
    catch {
        return null; // payload is padded JSON; anything else is hostile
    }
    return { from: inner.pubkey, to, payload, createdAt: inner.created_at, wrapId: wrap.id };
}
