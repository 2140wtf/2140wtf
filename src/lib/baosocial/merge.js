import { SCROLL_SEGMENT, parseScrollDTag } from './kinds.js';
/**
 * Canonical client merge — spec §3.3.
 *
 * 1. Take segments from all listed scribes.
 * 2. Verify every segment signature against the signed scribe list; reject
 *    segments from unlisted keys.
 * 3. Dedup by (author, msg_id).
 * 4. Apply the redaction list (latest-state-wins, rule 4).
 * 5. Render order: per-scribe (seg#, position); cross-scribe tie-break by
 *    msg_id. Cross-scribe order is approximate by design.
 */
import { verifyEvent, findTag, } from './crypto.js';
import { decodeSegmentEvent } from './segment.js';
import { foldRedactionState } from './redaction.js';
import { dedupKey } from './envelope.js';
export function mergeScrolls(events, opts) {
    const scribeSet = new Set(opts.scribes.map((s) => s.toLowerCase()));
    const redacted = foldRedactionState(opts.redactions ?? []);
    const rejected = [];
    const chainWarnings = [];
    const coverage = new Map();
    // Per-scribe ordered streams.
    const streams = new Map();
    const segmentsByScribe = new Map();
    for (const event of events) {
        try {
            if (event.kind !== SCROLL_SEGMENT)
                throw new Error('not a segment');
            if (!scribeSet.has(event.pubkey.toLowerCase()))
                throw new Error('unlisted scribe');
            if (!verifyEvent(event))
                throw new Error('bad signature');
            const decoded = decodeSegmentEvent(event, opts.ctx);
            if (decoded.warnings.length > 0)
                chainWarnings.push(...decoded.warnings.map((w) => `${event.pubkey.slice(0, 12)}: ${w}`));
            // Segment chain sanity: d tag room already checked by decode.
            const d = findTag(event, 'd');
            if (!d || !parseScrollDTag(d))
                throw new Error('bad d tag');
            const stream = streams.get(event.pubkey) ?? [];
            decoded.envelopes.forEach((envelope, pos) => {
                stream.push({ seg: decoded.seg, pos, envelope });
                const key = dedupKey(envelope);
                const set = coverage.get(key) ?? new Set();
                set.add(event.pubkey);
                coverage.set(key, set);
            });
            streams.set(event.pubkey, stream);
            const segList = segmentsByScribe.get(event.pubkey) ?? [];
            segList.push(decoded);
            segmentsByScribe.set(event.pubkey, segList);
        }
        catch (err) {
            rejected.push({ eventId: event.id ?? '<unknown>', reason: err.message });
        }
    }
    // Union-merge with per-scribe order, cross-scribe tie-break by msg_id.
    const merged = new Map();
    for (const [scribe, stream] of streams) {
        stream.sort((a, b) => a.seg - b.seg || a.pos - b.pos);
        for (const item of stream) {
            const key = dedupKey(item.envelope);
            const orderKey = `${String(item.seg).padStart(12, '0')}:${String(item.pos).padStart(8, '0')}:${item.envelope.msg_id}`;
            const existing = merged.get(key);
            if (existing) {
                existing.scribes.push(scribe);
                if (orderKey < existing.orderKey)
                    existing.orderKey = orderKey;
            }
            else {
                merged.set(key, {
                    envelope: item.envelope,
                    scribes: [scribe],
                    redacted: redacted.has(key),
                    orderKey,
                });
            }
        }
    }
    const messages = [...merged.values()]
        .sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1))
        .map(({ orderKey: _orderKey, ...m }) => m);
    // Prev-chain verification per scribe (§3.2): contiguous seg numbers must
    // chain; gaps are flagged (retention is the benign explanation, scribe
    // truncation the hostile one — clients decide which).
    for (const [scribe, segs] of segmentsByScribe) {
        const ordered = [...segs].sort((a, b) => a.seg - b.seg);
        for (let i = 1; i < ordered.length; i++) {
            const prev = ordered[i - 1];
            const cur = ordered[i];
            if (cur.seg === prev.seg) {
                chainWarnings.push(`${scribe}: duplicate seg# ${cur.seg}`);
            }
            else if (cur.seg === prev.seg + 1) {
                if (cur.prevSegmentId !== prev.event.id) {
                    chainWarnings.push(`${scribe}: seg ${cur.seg} prev does not point at seg ${prev.seg} (broken chain)`);
                }
            }
            else {
                chainWarnings.push(`${scribe}: seg# gap ${prev.seg} → ${cur.seg} (retention purge or truncation)`);
            }
        }
    }
    return { messages, rejected, coverage, chainWarnings };
}
