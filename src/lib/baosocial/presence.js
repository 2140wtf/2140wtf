const MAX_NAME_CHARS = 40;
const MAX_COLOR_CHARS = 24;
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
/** Build a presence payload (encrypted in-envelope, like every §7 structure). */
export function buildPresence(name, opts = {}) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_CHARS)
        throw new Error(`name required (≤${MAX_NAME_CHARS} chars)`);
    if (/[\r\n]/.test(trimmed))
        throw new Error('name must be single-line');
    if (opts.color !== undefined && !COLOR_RE.test(opts.color))
        throw new Error('color must be #rgb/#rrggbb/#rrggbbaa');
    return { presence: { name: trimmed, ...(opts.color ? { color: opts.color } : {}) } };
}
/** Parse a presence payload, or null when absent/invalid. */
export function parsePresence(payload) {
    if (!payload || typeof payload !== 'object')
        return null;
    const p = payload.presence;
    if (!p || typeof p !== 'object')
        return null;
    const o = p;
    if (typeof o.name !== 'string')
        return null;
    const name = o.name.trim();
    if (name.length === 0 || name.length > MAX_NAME_CHARS || /[\r\n]/.test(name))
        return null;
    const color = typeof o.color === 'string' && COLOR_RE.test(o.color) ? o.color : undefined;
    return { name, ...(color ? { color } : {}) };
}
/**
 * Fold the room roster from a merged scroll: latest presence per author
 * (scroll order wins), redacted excluded. Authors without a presence get a
 * key-derived handle so every speaker is addressable.
 */
export function foldRoster(messages) {
    const byAuthor = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        const p = parsePresence(m.envelope.payload);
        if (p)
            byAuthor.set(m.envelope.author, p);
    }
    // Also include every speaker (presence or not) so autocomplete covers all.
    const authors = new Map();
    for (const m of messages) {
        if (m.redacted)
            continue;
        if (!authors.has(m.envelope.author))
            authors.set(m.envelope.author, byAuthor.get(m.envelope.author) ?? null);
    }
    // Collision pass: names claimed by >1 author get a ·suffix.
    const nameCount = new Map();
    for (const p of byAuthor.values())
        nameCount.set(p.name.toLowerCase(), (nameCount.get(p.name.toLowerCase()) ?? 0) + 1);
    const out = new Map();
    for (const [author, p] of authors) {
        const base = p?.name ?? author.slice(0, 8);
        const collides = p ? (nameCount.get(p.name.toLowerCase()) ?? 0) > 1 : false;
        out.set(author, {
            author,
            name: base,
            ...(p?.color ? { color: p.color } : {}),
            handle: collides ? `${base}·${author.slice(0, 4)}` : base,
        });
    }
    return out;
}
/** Find the next @handle match at-or-after `pos`, or null. Shared matcher
 *  for resolve/segment so routing and chip rendering can never disagree:
 *  every occurrence of every handle is considered (an early word-glued
 *  occurrence like "@alicex" doesn't hide a real "@alice" later), hits must
 *  end at a word boundary, and ties on position go to the LONGER handle
 *  ("@alice·3f2a" beats "@alice" — entries are pre-sorted longest-first).
 *  Matches consume their span: callers advance past `at + len`. */
function nextMention(lower, entries, pos) {
    let best = null;
    for (const e of entries) {
        const needle = `@${e.handle.toLowerCase()}`;
        let i = pos;
        while ((i = lower.indexOf(needle, i)) !== -1) {
            const after = lower[i + needle.length];
            if (after === undefined || !/[a-z0-9_]/.test(after))
                break;
            i += needle.length;
        }
        if (i !== -1 && (!best || i < best.at))
            best = { entry: e, at: i, len: needle.length };
    }
    return best;
}
/**
 * Resolve @handles in display text to roster author keys. Case-insensitive,
 * non-overlapping leftmost-longest (so "@alice·3f2a" routes to the
 * disambiguated author, not plain @alice). Returns the deduped `to` list
 * for payload routing — the text itself is left untouched for display.
 */
export function resolveMentions(text, roster) {
    const entries = [...roster.values()].sort((a, b) => b.handle.length - a.handle.length);
    const found = new Set();
    const lower = text.toLowerCase();
    let pos = 0;
    for (;;) {
        const m = nextMention(lower, entries, pos);
        if (!m)
            return [...found];
        found.add(m.entry.author);
        pos = m.at + m.len;
    }
}
export function segmentMentions(text, roster) {
    const entries = [...roster.values()].sort((a, b) => b.handle.length - a.handle.length);
    const lower = text.toLowerCase();
    const out = [];
    let pos = 0;
    while (pos < text.length) {
        const matched = nextMention(lower, entries, pos);
        if (!matched) {
            out.push({ kind: 'text', text: text.slice(pos) });
            break;
        }
        if (matched.at > pos)
            out.push({ kind: 'text', text: text.slice(pos, matched.at) });
        out.push({ kind: 'mention', text: text.slice(matched.at, matched.at + matched.len), entry: matched.entry });
        pos = matched.at + matched.len;
    }
    return out;
}
/**
 * Autocomplete source: roster entries whose handle starts with the fragment
 * after the last "@" in the composer text. Returns [] when the caret is not
 * in a mention context.
 */
export function autocompleteMentions(composerText, roster) {
    const at = composerText.lastIndexOf('@');
    if (at === -1)
        return [];
    const frag = composerText.slice(at + 1).toLowerCase();
    if (/\s/.test(frag))
        return []; // whitespace ends the mention context
    return [...roster.values()]
        .filter((e) => e.handle.toLowerCase().startsWith(frag))
        .sort((a, b) => a.handle.localeCompare(b.handle))
        .slice(0, 8);
}
