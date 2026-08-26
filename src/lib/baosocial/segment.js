import { SCROLL_SEGMENT, scrollDTag, parseScrollDTag } from './kinds.js';
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
import { systemClock, defaultRng, utf8ToBytes, encryptToRoomKey, decryptWithRoomKey, monotonicTimestamp, signEvent, verifyEvent, padToBucket, unpadBucket, SEGMENT_CONTENT_SIZE, deriveScrollWrapperKey, scrollScope, findTag, } from './crypto.js';
import { decodeEphemeralEvent, dedupKey } from './envelope.js';
function containerKey(ctx) {
    return ctx.segKey ?? deriveScrollWrapperKey(ctx.encKey);
}
import { base64 } from '@scure/base';
export function manifestFor(events) {
    const messages = events.map((e) => JSON.stringify(e));
    return {
        count: messages.length,
        first_event_id: events[0]?.id ?? null,
        last_event_id: events[events.length - 1]?.id ?? null,
        messages,
    };
}
/**
 * Serialize envelopes into a manifest and pad to exactly 24 KB.
 *
 * The padded bundle is binary (length header + zero fill). It is
 * base64-encoded before NIP-44 encryption so the plaintext is pure ASCII —
 * a latin1 pseudo-string would be utf8-re-encoded by NIP-44 libraries,
 * inflating the ciphertext and corrupting foreign decoders. base64 keeps
 * the wire event at ~44.6 KB, safely under strfry's 64 KB maxEventSize.
 */
export function encodeSegmentContent(events, containerEncKey, rng = defaultRng) {
    const padded = padToBucket(utf8ToBytes(JSON.stringify(manifestFor(events))), SEGMENT_CONTENT_SIZE);
    return encryptToRoomKey(base64.encode(padded), containerEncKey, rng);
}
export function decodeSegmentContent(content, ctx) {
    const padded = base64.decode(decryptWithRoomKey(content, containerKey(ctx)));
    if (padded.length !== SEGMENT_CONTENT_SIZE) {
        throw new Error(`segment plaintext must be exactly ${SEGMENT_CONTENT_SIZE}B, got ${padded.length}B`);
    }
    const manifest = JSON.parse(new TextDecoder().decode(unpadBucket(padded)));
    if (!Array.isArray(manifest.messages) || manifest.count !== manifest.messages.length) {
        throw new Error('manifest count mismatch');
    }
    // Each message is a full signed ephemeral event (blind-scribe format):
    // verify the outer signature, then decrypt + validate the envelope.
    const envelopes = manifest.messages.map((raw) => {
        const ev = JSON.parse(raw);
        if (!verifyEvent(ev))
            throw new Error('message event signature invalid');
        return decodeEphemeralEvent(ev, { roomId: ctx.roomId, encKey: ctx.encKey, routingId: ctx.routingId, epoch: ctx.epoch ?? 0 });
    });
    // Logical dedup: the SAME (author, msg_id) can legitimately appear twice
    // with different event ids — a client republishing across an epoch
    // ratchet re-stamps the envelope (new epoch, new ciphertext, same
    // msg_id) and the BLIND scribe cannot dedup those at ingest (msg_id is
    // inside the ciphertext). Keep the first in segment order, drop later
    // copies, and surface a warning (tamper evidence without rejecting the
    // whole segment — the merge layer dedups across segments regardless).
    const seen = new Set();
    const kept = [];
    const warnings = [];
    for (const env of envelopes) {
        const k = dedupKey(env);
        if (seen.has(k)) {
            warnings.push(`duplicate message dropped in segment: ${k}`);
            continue;
        }
        seen.add(k);
        kept.push(env);
    }
    return { manifest, envelopes: kept, warnings };
}
/** Build + sign a kind-31145 segment event (monotonic created_at, §11). */
export function encodeSegmentEvent(args) {
    const clock = args.clock ?? systemClock;
    const rng = args.rng ?? defaultRng;
    const tags = [
        ['d', scrollDTag(scrollScope(containerKey(args.ctx), args.ctx.roomId), args.seg)],
        ['prev', args.prevSegmentId ?? 'genesis'],
        ['flush', args.flush],
        ['-'],
    ];
    if (args.ctx.expiration !== undefined)
        tags.push(['expiration', String(args.ctx.expiration)]);
    return signEvent({
        kind: SCROLL_SEGMENT,
        created_at: monotonicTimestamp(args.previousCreatedAt, clock),
        tags,
        content: encodeSegmentContent(args.events, containerKey(args.ctx), rng),
    }, args.scribeSecretKey);
}
/** Verify + decode a segment event. Throws on any failure. */
export function decodeSegmentEvent(event, ctx) {
    if (event.kind !== SCROLL_SEGMENT)
        throw new Error(`unexpected kind ${event.kind}`);
    if (!verifyEvent(event))
        throw new Error('bad signature');
    const d = findTag(event, 'd');
    if (!d)
        throw new Error('missing d tag');
    const parsed = parseScrollDTag(d);
    if (!parsed || parsed.scope !== scrollScope(containerKey(ctx), ctx.roomId))
        throw new Error('d tag mismatch');
    const prev = findTag(event, 'prev') ?? 'genesis';
    const flush = findTag(event, 'flush');
    if (!flush || !['size', 'time', 'purge', 'redact'].includes(flush))
        throw new Error('bad flush tag');
    const { envelopes, warnings } = decodeSegmentContent(event.content, ctx);
    for (const env of envelopes) {
        if (env.room !== ctx.roomId)
            throw new Error('envelope room mismatch');
        if (env.author && !/^[0-9a-f]{64}$/.test(env.author))
            throw new Error('bad author');
    }
    return {
        event,
        seg: parsed.seg,
        prevSegmentId: prev === 'genesis' ? null : prev,
        flush,
        envelopes,
        warnings,
    };
}
/**
 * Tombstone rewrite (§3): replace a segment's messages with redacted
 * tombstones. Governance/mod-driven; scribe re-signs its own segment.
 */
export function tombstoneEnvelopes(envelopes, redactedKeys, ts) {
    return envelopes.map((env) => redactedKeys.has(dedupKey(env))
        ? { ...env, payload: { tombstone: `⟂ redacted by mod at ${ts}` } }
        : env);
}
