import { replyTarget, parseReaction } from './message.js';
import { parseReview } from './codeCollab.js';
import { parseBotManifest } from './botCommands.js';
import { parsePresence, foldRoster } from './presence.js';
import { parseTyping } from './typing.js';
import { parseRetract, foldRetractions } from './retract.js';
// ─── Internal fold functions ───────────────────────────────────────────────
/** Fold reactions by (target, emoji, author), latest-in-scroll wins. */
function foldReactions(messages) {
    const latest = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        const r = parseReaction(m.envelope.payload);
        if (!r)
            continue;
        const key = `${r.target}:${r.emoji}:${m.envelope.author}`;
        latest.set(key, { target: r.target, emoji: r.emoji, author: m.envelope.author, remove: r.remove });
    }
    const byTarget = new Map();
    for (const entry of latest.values()) {
        if (entry.remove)
            continue;
        let emojis = byTarget.get(entry.target);
        if (!emojis) {
            emojis = new Map();
            byTarget.set(entry.target, emojis);
        }
        const authors = emojis.get(entry.emoji) ?? new Set();
        authors.add(entry.author);
        emojis.set(entry.emoji, authors);
    }
    const out = new Map();
    for (const [target, emojis] of byTarget) {
        out.set(target, [...emojis.entries()]
            .map(([emoji, authors]) => ({ emoji, count: authors.size, authors: [...authors].sort() }))
            .sort((a, b) => (a.emoji < b.emoji ? -1 : 1)));
    }
    return out;
}
/** Build reply trees from a scroll. Replies to redacted parents orphan. */
function buildThreads(messages) {
    const live = messages.filter((m) => !m.redacted);
    const byId = new Map();
    for (const m of live)
        byId.set(m.envelope.msg_id, m);
    const threads = new Map();
    const orphans = [];
    for (const m of live) {
        const parent = replyTarget(m.envelope.payload);
        if (!parent)
            continue;
        const root = byId.get(parent);
        if (!root) {
            orphans.push(m);
            continue;
        }
        let t = threads.get(parent);
        if (!t) {
            t = { root, replies: [], replyCount: 0, participants: [] };
            threads.set(parent, t);
        }
        t.replies.push(m);
    }
    for (const t of threads.values()) {
        t.replyCount = t.replies.length;
        t.participants = [...new Set(t.replies.map((r) => r.envelope.author))].sort();
    }
    return { threads, orphans };
}
/** Fold reviews by (target, author), latest-in-scroll wins. */
function foldReviews(messages) {
    const latest = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        const r = parseReview(m.envelope.payload);
        if (!r)
            continue;
        const key = `${r.target}:${m.envelope.author}`;
        latest.set(key, { target: r.target, author: m.envelope.author, review: r });
    }
    const out = new Map();
    for (const entry of latest.values()) {
        let state = out.get(entry.target);
        if (!state) {
            state = { target: entry.target, verdicts: {}, approved: 0, changesRequested: 0, comments: 0 };
            out.set(entry.target, state);
        }
        state.verdicts[entry.author] = entry.review;
        if (entry.review.verdict === 'approved')
            state.approved++;
        else if (entry.review.verdict === 'changes-requested')
            state.changesRequested++;
        else
            state.comments++;
    }
    return out;
}
/** Latest valid manifest per author (lowercased pubkey), in scroll order. */
function collectManifests(messages) {
    const out = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        const manifest = parseBotManifest(m.envelope.payload);
        if (!manifest)
            continue;
        out.set(m.envelope.author.toLowerCase(), manifest);
    }
    return out;
}
function hasText(m) {
    const p = m.envelope.payload;
    return !!p && typeof p === 'object' && typeof p.text === 'string' && (p.text.length > 0);
}
/** One-call fold of a merged scroll into every consumer view. */
export function aggregateScroll(result) {
    const allMessages = result.messages;
    // Author retractions (B4): tombstones exclude the original from every
    // view exactly like governance redactions — but only when the retractor
    // IS the original author (foldRetractions enforces).
    const retractions = foldRetractions(allMessages);
    const messages = allMessages.filter((m) => !retractions.retracted.has(m.envelope.msg_id));
    const redactedCount = messages.filter((m) => m.redacted).length;
    const { threads, orphans } = buildThreads(messages);
    const reactions = foldReactions(messages);
    const reviews = foldReviews(messages);
    const manifests = collectManifests(messages);
    const roster = foldRoster(messages);
    const replyIds = new Set();
    for (const t of threads.values())
        for (const r of t.replies)
            replyIds.add(r.envelope.msg_id);
    for (const o of orphans)
        replyIds.add(o.envelope.msg_id);
    const timeline = messages.filter((m) => {
        if (m.redacted)
            return false;
        if (replyIds.has(m.envelope.msg_id))
            return false; // replies live in their thread
        const p = m.envelope.payload;
        if (!p || typeof p !== 'object')
            return true; // unknown payload — surface it
        // Pure reaction (reaction fields, no text, no other content) → reactions view only.
        if (parseReaction(p) && !hasText(m))
            return false;
        // Pure manifest (botManifest, no text) → manifest registry only.
        if (parseBotManifest(p) && !hasText(m))
            return false;
        // Pure presence (display-name declaration, no text) → roster only.
        if (parsePresence(p) && !hasText(m))
            return false;
        // Pure typing signal → never conversation content (and never in the scroll anyway).
        if (parseTyping(p) && !hasText(m))
            return false;
        // Pure retraction tombstone → bookkeeping, not conversation.
        if (parseRetract(p) && !hasText(m))
            return false;
        return true;
    });
    return { timeline, threadIndex: { threads, orphans }, reactions, reviews, manifests, roster, redactedCount, retractions };
}
