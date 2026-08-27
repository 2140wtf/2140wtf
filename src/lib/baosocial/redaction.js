import { REDACTION_LIST, redactDTag } from './kinds.js';
/**
 * Redaction list — spec §3, §11. Kind 31146, d = bao-redact:<roomId>,
 * governance-key-authored, room-encrypted. Clients enforce at render time.
 *
 * State semantics = design rule 4: state is a pure function of the entry
 * set, folded in (created_at, id) lexicographic order; latest-state-wins;
 * arrival order never matters. This is the only union-merge-safe redaction
 * mechanism — rewriting one scribe's segment does nothing to another's copy.
 */
import { systemClock, defaultRng, encryptToRoomKey, decryptWithRoomKey, monotonicTimestamp, padJsonToBucket, signEvent, verifyEvent, findTag, } from './crypto.js';
import { dedupKey } from './envelope.js';
export function encodeRedactionListEvent(entries, governanceSecretKey, ctx, previousCreatedAt, clock = systemClock, rng = defaultRng) {
    for (const e of entries) {
        if (!/^[0-9a-f]{64}$/.test(e.author))
            throw new Error('bad author in entry');
        if (!/^[0-9a-f]{32}$/.test(e.msg_id))
            throw new Error('bad msg_id in entry');
        if (e.action !== 'redact' && e.action !== 'unredact')
            throw new Error('bad action');
    }
    return signEvent({
        kind: REDACTION_LIST,
        created_at: monotonicTimestamp(previousCreatedAt, clock),
        tags: [
            ['d', redactDTag(ctx.scope)],
            ['-'],
        ],
        content: encryptToRoomKey(padJsonToBucket(JSON.stringify({ v: 1, entries })), ctx.encKey, rng),
    }, governanceSecretKey);
}
export function decodeRedactionListEvent(event, ctx, governancePubkey) {
    if (event.kind !== REDACTION_LIST)
        throw new Error(`unexpected kind ${event.kind}`);
    if (!verifyEvent(event))
        throw new Error('bad signature');
    // Fail-closed: only the room governance key may redact (spec §3). Without
    // this check any member could redact anyone's messages for all clients
    // (post-review bug: moderation privilege escalation).
    if (event.pubkey.toLowerCase() !== governancePubkey.toLowerCase()) {
        throw new Error('redaction list not authored by the room governance key');
    }
    if (findTag(event, 'd') !== redactDTag(ctx.scope))
        throw new Error('d tag mismatch');
    const parsed = JSON.parse(decryptWithRoomKey(event.content, ctx.encKey));
    if (parsed.v !== 1 || !Array.isArray(parsed.entries))
        throw new Error('bad redaction payload');
    return parsed.entries;
}
/**
 * Fold entries into the current redaction state (rule 4): sort by
 * (ts, author:msg_id), last write per key wins; an exact (ts, key) tie is
 * broken deterministically — 'redact' beats 'unredact' (fail-closed).
 * Arrival order never matters.
 */
export function foldRedactionState(entries) {
    const sorted = [...entries].sort((a, b) => {
        if (a.ts !== b.ts)
            return a.ts - b.ts;
        const ka = dedupKey(a);
        const kb = dedupKey(b);
        if (ka !== kb)
            return ka < kb ? -1 : 1;
        if (a.action === b.action)
            return 0;
        return a.action === 'unredact' ? -1 : 1; // unredact first → redact wins the tie
    });
    const state = new Map();
    for (const e of sorted)
        state.set(dedupKey(e), e.action);
    const redacted = new Set();
    for (const [k, action] of state)
        if (action === 'redact')
            redacted.add(k);
    return redacted;
}
export function isRedacted(entries, author, msgId) {
    return foldRedactionState(entries).has(`${author}:${msgId}`);
}
