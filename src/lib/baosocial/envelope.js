import { EPHEMERAL_MESSAGE } from './kinds.js';
/**
 * Envelope codec — spec §3.1. The envelope is the decrypted content of a
 * kind-21045 ephemeral message: NIP-44 v2 to the room content key.
 *
 * dedup key = (author, msg_id) — this is what makes retry-until-scrolled
 * safe (§3).
 */
import { defaultRng, systemClock, bytesToHex, encryptToRoomKey, decryptWithRoomKey, privacyTimestamp, DEFAULT_PRIVACY_POLICY, padJsonToBucket, signEvent, getPublicKey, verifyEvent, findTag, } from './crypto.js';
/** (author, msg_id) — the dedup key enforced by scribes and clients. */
export function dedupKey(env) {
    return `${env.author}:${env.msg_id}`;
}
export function newMsgId(rng = defaultRng) {
    return bytesToHex(rng(16));
}
export function buildEnvelope(authorSecretKey, payload, ctx, rng = defaultRng) {
    return {
        v: 1,
        msg_id: newMsgId(rng),
        room: ctx.roomId,
        epoch: ctx.epoch,
        author: getPublicKey(authorSecretKey),
        payload,
    };
}
export function serializeEnvelope(env) {
    return JSON.stringify(env);
}
export function parseEnvelope(json) {
    const raw = JSON.parse(json);
    if (raw.v !== 1)
        throw new Error(`unsupported envelope version: ${raw.v}`);
    if (typeof raw.msg_id !== 'string' || !/^[0-9a-f]{32}$/.test(raw.msg_id)) {
        throw new Error('invalid msg_id');
    }
    if (typeof raw.room !== 'string' || raw.room.length === 0)
        throw new Error('missing room');
    if (!Number.isSafeInteger(raw.epoch) || raw.epoch < 0)
        throw new Error('invalid epoch');
    if (typeof raw.author !== 'string' || !/^[0-9a-f]{64}$/.test(raw.author)) {
        throw new Error('invalid author');
    }
    return raw;
}
/**
 * Epoch acceptance window (spec §3.1): P1 = current epoch only (window 0).
 * P2 grace during epoch roll-over: window 1 accepts the current AND the
 * previous epoch, so in-flight envelopes from just before the roll are
 * not dropped. Wider windows weaken the delayed-re-injection defense.
 */
export function epochAccepted(envEpoch, currentEpoch, window = 0) {
    return envEpoch <= currentEpoch && envEpoch >= currentEpoch - window;
}
/** P2 default grace: accept the previous epoch during roll-over. */
export const P2_EPOCH_WINDOW = 1;
/**
 * Build, encrypt, and sign a kind-21045 ephemeral event. Timestamp is
 * privacyTimestamp-jittered per the relay-class POLICY (§11: observer
 * uncertainty = policy.windowSec; public relays keep the vanilla-safe
 * forward default, private relays full backward jitter).
 */
export function encodeEphemeralEvent(authorSecretKey, payload, ctx, clock = systemClock, rng = defaultRng, policy = DEFAULT_PRIVACY_POLICY) {
    const envelope = buildEnvelope(authorSecretKey, payload, ctx, rng);
    const content = encryptToRoomKey(padJsonToBucket(serializeEnvelope(envelope)), ctx.encKey, rng);
    const template = {
        kind: EPHEMERAL_MESSAGE,
        created_at: privacyTimestamp(clock, rng, policy),
        tags: [
            ['r', ctx.routingId],
            ['-'],
        ],
        content,
    };
    return { event: signEvent(template, authorSecretKey), envelope };
}
/**
 * Re-encode an EXISTING envelope (same msg_id) into a fresh ephemeral
 * event — the retry half of retry-until-scrolled (§3). Scribes dedup on
 * (author, msg_id), so republication races are safe.
 */
export function encodeEnvelopeEvent(authorSecretKey, envelope, ctx, clock = systemClock, rng = defaultRng, policy = DEFAULT_PRIVACY_POLICY) {
    return signEvent({
        kind: EPHEMERAL_MESSAGE,
        created_at: privacyTimestamp(clock, rng, policy),
        tags: [
            ['r', ctx.routingId],
            ['-'],
        ],
        content: encryptToRoomKey(padJsonToBucket(serializeEnvelope(envelope)), ctx.encKey, rng),
    }, authorSecretKey);
}
/**
 * Verify + decrypt a kind-21045 event into its envelope.
 * Throws on any structural or crypto failure.
 */
export function decodeEphemeralEvent(event, ctx, epochWindow = 0) {
    if (event.kind !== EPHEMERAL_MESSAGE)
        throw new Error(`unexpected kind ${event.kind}`);
    if (!verifyEvent(event))
        throw new Error('bad signature');
    if (findTag(event, 'r') !== ctx.routingId)
        throw new Error('routing tag mismatch');
    const envelope = parseEnvelope(decryptWithRoomKey(event.content, ctx.encKey));
    if (envelope.room !== ctx.roomId)
        throw new Error('room mismatch');
    if (envelope.author !== event.pubkey)
        throw new Error('author mismatch (inner vs outer)');
    if (!epochAccepted(envelope.epoch, ctx.epoch, epochWindow))
        throw new Error('epoch outside acceptance window');
    return envelope;
}
