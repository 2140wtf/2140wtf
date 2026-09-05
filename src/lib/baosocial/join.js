/**
 * Join — spec §6 (burner join) + join link management.
 *
 * The join module owns everything related to discovering a room and
 * executing the burner dance: creating/parsing join links, the two-phase
 * cap-pow admission dance, decrypting the welcomer wrap, and producing
 * a JoinedRoom session ready for use.
 *
 * Single-link join: `…/chat/join#<fragment>`, fragment = base64url JSON
 *   { "k": <invite secret hex>, "room": <roomId> }
 * The entire burner dance (generate burner → ephemeral request → poll wrap →
 * discard → generate throwaway author key) happens inside joinRoom(). No
 * human steps, no application API (design rule 8).
 */
import { JOIN_REQUEST, KEY_WRAP } from './kinds.js';
import { systemClock, defaultRng, generateSecretKey, getPublicKey, bytesToHex, hexToBytes, deriveEpochKeys, signEvent, privacyTimestamp, privacyPolicyFor, padJsonToBucket, encryptDm, decryptDm, verifyEvent, } from './crypto.js';
import { base64url } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildAgentJoinProof } from './nipOa.js';
import { solvePow } from './welcomer-core.js';
// ─── Invite transport hardening (checksum · split format · normalization) ──
/**
 * joinLinkChecksum — `cs` = sha256(canonical JSON of the fragment's identity
 * fields)[:16 hex]. Canonical = keys sorted ascending (k < r < room < w),
 * absent fields omitted, no whitespace. Deliberately NARROW: it pins exactly
 * the fields whose corruption is silent and fatal (hex keys, room id). The
 * relay URL is excluded by design — a mangled relay fails visibly at connect
 * time, and including it would let a link re-tagged for a different relay
 * be dismissed as "corrupted" rather than flagged as retargeted.
 */
export function joinLinkChecksum(parts) {
    // ABSENT ≠ EMPTY: open-policy rooms carry no invite secret (fragment has
    // no `k` at all) — both mint-side and verify-side must OMIT the key, not
    // coerce to ''. Canonical = sorted keys, only truthy values.
    const src = {};
    if (parts.inviteSecret)
        src.k = parts.inviteSecret;
    if (parts.routingId)
        src.r = parts.routingId;
    if (parts.roomId)
        src.room = parts.roomId;
    if (parts.welcomerPub)
        src.w = parts.welcomerPub;
    const canonical = JSON.stringify(Object.fromEntries(Object.keys(src).sort().map((k) => [k, src[k]])));
    return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(0, 16);
}
/**
 * fragmentDiagnostics — what the joiner reports when a link fails to parse,
 * so the ISSUER can compare against the original (chars + sha256 prefix).
 * Fingerprints only — never leaks the secret itself.
 */
export function fragmentDiagnostics(input) {
    const text = String(input ?? '');
    return {
        chars: text.length,
        lines: text.trim() ? text.trim().split('\n').length : 0,
        sha256: bytesToHex(sha256(new TextEncoder().encode(text))).slice(0, 12),
    };
}
/** Long-label → fragment-key map for the split-line format. */
const SPLIT_FIELD_KEYS = [
    ['room', 'roomId'],
    ['relay', 'relay'],
    ['welcomer', 'welcomerPub'],
    ['routing', 'routingId'],
    ['secret', 'inviteSecret'],
    ['history', 'history'],
    ['lid', 'linkId'],
    ['audience', 'audience'],
    ['label', 'label'],
    ['shield', 'shield'],
    ['maxuses', 'maxUses'],
    ['expiresat', 'expiresAt'],
    ['relayclass', 'relayClass'],
];
/**
 * splitJoinLines — one short labeled line per field. Short lines survive
 * chat layers that mangle ~900-char opaque blobs; each line self-validates
 * (length + charset); per-field transcription errors localize to one line
 * and are caught against `cs` before any network I/O.
 *
 * The advisory `do` recipe is intentionally DROPPED: it is issuer display
 * text, not admission material, and long prose is exactly what the split
 * format exists to avoid.
 */
export function splitJoinLines(parts) {
    const rows = [];
    for (const [label, key] of SPLIT_FIELD_KEYS) {
        const value = parts[key];
        if (value !== undefined)
            rows.push([label, String(value)]);
    }
    rows.push(['cs', parts.checksum ?? joinLinkChecksum(parts)]);
    const width = Math.max(...rows.map(([l]) => l.length));
    return rows.map(([l, v]) => `${l.padEnd(width)}=${v}`);
}
/**
 * parseSplitJoinLines — tolerant inverse of splitJoinLines. Accepts:
 * aligned or unaligned labels, any case, spaces around '=', blank and
 * `#` comment lines, trailing human annotations like `   (64 hex)`.
 */
export function parseSplitJoinLines(text) {
    const got = new Map();
    for (const rawLine of String(text ?? '').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq <= 0)
            continue; // stray prose between fields — ignored, not fatal
        const key = line.slice(0, eq).trim().toLowerCase();
        // Strip trailing annotations the sender may have kept: "…5500   (64 hex)"
        const value = line.slice(eq + 1).trim().replace(/\s+\([^)]*\)\s*$/, '').trim();
        if (key && value)
            got.set(key, value);
    }
    const lookup = (...names) => {
        for (const n of names) {
            const v = got.get(n);
            if (v !== undefined)
                return v;
        }
        return undefined;
    };
    const inviteSecret = lookup('secret', 'k');
    const roomId = lookup('room');
    if (!roomId) {
        throw new Error('split invite needs at least a `room=` line (got: ' + [...got.keys()].join(', ') + ')');
    }
    const parts = { roomId, ...(inviteSecret ? { inviteSecret } : {}) }; // open rooms carry no secret
    const relay = lookup('relay');
    if (relay)
        parts.relay = relay;
    const welcomerPub = lookup('welcomer', 'w');
    if (welcomerPub)
        parts.welcomerPub = welcomerPub;
    const routingId = lookup('routing', 'r');
    if (routingId)
        parts.routingId = routingId;
    const history = lookup('history');
    if (history === 'full' || history === 'fresh')
        parts.history = history;
    const linkId = lookup('lid');
    if (linkId)
        parts.linkId = linkId;
    const audience = lookup('audience');
    if (audience === 'human' || audience === 'agent')
        parts.audience = audience;
    const label = lookup('label');
    if (label)
        parts.label = label.slice(0, 80);
    const shield = lookup('shield');
    if (shield)
        parts.shield = shield;
    const maxUses = Number(lookup('maxuses'));
    if (Number.isSafeInteger(maxUses) && maxUses >= 1)
        parts.maxUses = maxUses;
    const expiresAt = Number(lookup('expiresat'));
    if (Number.isSafeInteger(expiresAt) && expiresAt >= 0)
        parts.expiresAt = expiresAt;
    const relayClass = lookup('relayclass');
    if (relayClass === 'public' || relayClass === 'private')
        parts.relayClass = relayClass;
    const checksum = lookup('cs', 'checksum');
    if (checksum)
        parts.checksum = checksum; // verified downstream at parse time
    parts.v = 2;
    return parts;
}
/**
 * partsToJoinLink — rebuild a fat-fragment link from parsed parts (used to
 * turn verified split lines back into something joinRoom consumes, and by
 * `invite --one-line`). A supplied checksum is verified before rebuilding;
 * absent checksums are stamped over the final values. Host is cosmetic —
 * parseJoinLink reads only the fragment.
 */
export function partsToJoinLink(parts, host = 'bao.chat') {
    // A split invite's checksum came from the issuer. Verify it before
    // rebuilding; silently replacing it would turn transport corruption into
    // a newly valid but unusable (or attacker-modified) capability.
    const actualChecksum = joinLinkChecksum(parts);
    if (parts.checksum !== undefined && parts.checksum !== actualChecksum) {
        throw new Error(`CHECKSUM MISMATCH — expected cs=${parts.checksum}, got cs=${actualChecksum}; request a fresh invite`);
    }
    return createJoinLink(host, parts.inviteSecret, parts.roomId, {
        ...(parts.relay ? { relay: parts.relay } : {}),
        ...(parts.welcomerPub ? { welcomerPub: parts.welcomerPub } : {}),
        ...(parts.routingId ? { routingId: parts.routingId } : {}),
        ...(parts.linkId ? { linkId: parts.linkId } : {}),
        ...(parts.audience ? { audience: parts.audience } : {}),
        ...(parts.label ? { label: parts.label } : {}),
        ...(parts.shield ? { shield: parts.shield } : {}),
        ...(parts.history ? { history: parts.history } : {}),
        ...(parts.maxUses !== undefined ? { maxUses: parts.maxUses } : {}),
        ...(parts.expiresAt !== undefined ? { expiresAt: parts.expiresAt } : {}),
        ...(parts.relayClass ? { relayClass: parts.relayClass } : {}),
        v: 2,
        checksum: true,
    });
}
/**
 * normalizeJoinInput — accept EVERY transport shape one command should:
 *   1. a full https://…/chat/join#<frag> link (possibly pasted with prose
 *      around it — the URL is extracted),
 *   2. a bare base64url fragment (no scheme),
 *   3. split-format labeled lines (reconstructed + cs-verified HERE, before
 *      any network I/O).
 * Returns a full link string ready for parseJoinLink/joinFromLink.
 */
export function normalizeJoinInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text)
        throw new Error('join input empty');
    const urlMatch = text.match(/https?:\/\/\S*#\S+/);
    if (urlMatch)
        return urlMatch[0];
    if (text.includes('\n'))
        return partsToJoinLink(parseSplitJoinLines(text));
    if (text.includes('#'))
        return text;
    // Flattened split lines on ONE line ('room=x relay=y secret=z …'): needs
    // ≥2 recognized labels AND no scheme — a real link never matches both.
    const labelHits = ['room', 'secret', 'welcomer', 'routing', 'relay', 'history', 'cs']
        .filter((l) => new RegExp(`\\b${l}\\s*=\\s*\\S`, 'i').test(text)).length;
    if (labelHits >= 2 && !/^https?:/i.test(text)) {
        return partsToJoinLink(parseSplitJoinLines(text.replace(/\s+/g, '\n')));
    }
    if (/^[A-Za-z0-9_-]+$/.test(text))
        return `#${text}`; // bare fragment
    return text; // anything else → parseJoinLink's canonical error (e.g. 'no fragment')
}
/**
 * parseShortInviteRef — recognize the SMALL shapes harnesses actually pass
 * around without mangling: a bare short code (`abc123xyzz`), a fetchable
 * short-invite URL (`https://<host>/i/<code>`), or a short agent URL
 * (`https://<host>/agent/<room-id>`). Returns null for every shape
 * normalizeJoinInput already owns (fat links, fragments, split lines).
 *
 * Rationale: chat layers and harness link-sanitizers shred ~900-char
 * fragments (or strip `#…` outright), then agents get blamed for "rejecting"
 * the link. A 10-char code or short URL survives everything — and both
 * resolve through ONE server path (`GET <origin>/i/<id>?format=split`,
 * which accepts codes AND full room ids), so every app sharing this chat
 * exposes the identical resolving path with zero per-app work.
 */
export function parseShortInviteRef(raw) {
    const text = String(raw ?? '').trim();
    if (!text || text.includes('\n'))
        return null;
    // Server-ref URLs (no fragment — fetchable as-is). The trailing segment
    // is whatever roomByCode accepts server-side (HMAC code, legacy code, or
    // full room id), so /i/ and /agent/ collapse to ONE resolution path.
    const m = text.match(/^(https?:\/\/[^\s/#?]+)\/(?:i|agent)\/([^\s#?/]+)(?:[?#].*)?$/i);
    if (m)
        return { kind: 'server-ref', origin: m[1], code: m[2] };
    // Bare code: short opaque token. A minimal fat-fragment link CAN also be
    // this short, so try the fragment reading first — a real fragment wins.
    if (/^[A-Za-z0-9]{8,64}$/.test(text)) {
        try {
            const parsed = JSON.parse(new TextDecoder().decode(base64url.decode(text)));
            if (parsed && typeof parsed.room === 'string')
                return null; // genuine bare fragment — not a code
        }
        catch { /* not a fragment → falls through to code */ }
        return { kind: 'bare-code', code: text };
    }
    return null;
}
/**
 * resolveJoinInput — the UNIFIED agent-join entry point. Accepts everything
 * normalizeJoinInput does, PLUS the small harness-proof shapes:
 * short-invite URLs, agent short URLs, and bare codes (with --origin).
 * Server refs resolve via the deployment's own /i/ endpoint and return a
 * full fat-fragment link ready for parseJoinLink/joinFromLink — identical
 * admission material to a pasted fat link, so every harness and every app
 * sharing this chat joins through the same path.
 */
export async function resolveJoinInput(raw, opts = {}) {
    const ref = parseShortInviteRef(raw);
    if (!ref)
        return normalizeJoinInput(raw);
    let origin = ref.kind === 'server-ref' ? ref.origin : (opts.origin ?? opts.envOrigin);
    if (!origin) {
        throw new Error(`that looks like a short invite code (${ref.code.length} chars) but carries no host — ` +
            `re-run as: join "${ref.kind === 'bare-code' ? ref.code : raw}" --origin https://<chat-host> ` +
            `(or set BAO_CHAT_ORIGIN). Prefer piping: curl -fsSL <host>/i/<code> | join -`);
    }
    origin = origin.trim().replace(/\/+$/, ''); // harnesses paste trailing slashes
    if (!/^https?:\/\/[^\s/#?]+$/i.test(origin))
        throw new Error('join --origin must be an http(s) origin (e.g. https://chat.example)');
    const fetchFn = opts.fetchFn;
    if (!fetchFn)
        throw new Error(`join code resolution needs network fetch — pipe instead: curl -fsSL ${origin}/i/<code> | join -`);
    const url = `${origin}/i/${encodeURIComponent(ref.code)}?format=split`;
    let res;
    try {
        res = await fetchFn(url);
    }
    catch (err) {
        throw new Error(`join code lookup failed (${origin} unreachable: ${String(err?.message ?? err).slice(0, 120)}) — check the host and retry`);
    }
    if (!res || !res.ok) {
        throw new Error(`join code not recognized by ${origin} (http ${res?.status ?? '???'}) — ask the issuer for a fresh code or the full link`);
    }
    const body = await res.text();
    if (body.length > 32768)
        throw new Error('join code answer too large — refusing to parse');
    try {
        return partsToJoinLink(parseSplitJoinLines(body));
    }
    catch (err) {
        throw new Error(`join code answer unparseable: ${err.message}`);
    }
}
/** Compare relay endpoints without treating an insignificant trailing slash
 * as authority to redirect encrypted room traffic. */
export function sameRelayEndpoint(a, b) {
    try {
        const normalize = (raw) => {
            const u = new URL(raw);
            if (u.protocol !== 'ws:' && u.protocol !== 'wss:')
                throw new Error('relay must use ws(s)');
            u.hash = '';
            u.search = '';
            u.pathname = u.pathname.replace(/\/+$/, '') || '/';
            return u.href;
        };
        return normalize(a) === normalize(b);
    }
    catch {
        return false;
    }
}
/**
 * agentDoRecipe — the CANONICAL zero-repo bootstrap command for AI agents
 * (grammar v2 `do` payload). Any deploy host serves the bundled CLI at
 * /bao-agent.cjs, so an agent holding ONLY the link can go from nothing to
 * joined+greeted with one copy-pasteable recipe. 1B-model friendly:
 * execute exactly this; the only substitution is pasting the very URL that
 * carried the recipe into `join`.
 *
 * SELF-REFERENTIAL by design (restored in #61): the /agent#… URL holding
 * this recipe IS the join argument. We deliberately do NOT embed a second
 * /chat/join# URL here: two URLs in circulation means two credential sets
 * that can drift apart. The ONE exception is `opts.shortUrl` — a /i/<code>
 * pointer is not a second credential copy, it is a SERVER-RESOLVED alias
 * of the same room capability — and it lets the recipe PIP E via stdin so
 * nothing long is ever transcribed and key material stays out of argv and
 * shell history. `opts.bundleSha256` adds a hash check against the
 * deployment's /.well-known/bao-agent.json pin.
 */
export function agentDoRecipe(origin, opts = {}) {
    if (!/^https?:\/\//.test(origin))
        throw new Error('agentDoRecipe: origin must be http(s)');
    const lines = [`curl -fsSL ${origin}/bao-agent.cjs -o /tmp/bao-agent.cjs`];
    if (opts.bundleSha256) {
        lines.push(`echo "${opts.bundleSha256}  /tmp/bao-agent.cjs" | sha256sum -c - >/dev/null && echo driver-verified`);
    }
    if (opts.shortUrl) {
        // stdin join: the fetch IS the argument. No 900-char blob anywhere.
        lines.push(`curl -fsSL ${opts.shortUrl} | node /tmp/bao-agent.cjs join - --as agent`);
    }
    else {
        lines.push(`node /tmp/bao-agent.cjs join "<the full /agent#… URL that sent you here, #fragment included>" --as agent`);
    }
    lines.push(`node /tmp/bao-agent.cjs say "hello — joined via agent link" --as agent`);
    return lines.join(' && ');
}
export function createJoinLink(host, inviteSecret, roomId, opts = {}) {
    // Open-policy rooms pass NO inviteSecret (undefined → the `k` key is
    // omitted from the fragment); the checksum omits absent fields to match.
    const cs = opts.checksum ? joinLinkChecksum({ inviteSecret, roomId, welcomerPub: opts.welcomerPub, routingId: opts.routingId }) : undefined;
    const fragment = base64url.encode(new TextEncoder().encode(JSON.stringify({
        k: inviteSecret,
        room: roomId,
        ...(opts.relay ? { relay: opts.relay } : {}),
        ...(opts.welcomerPub ? { w: opts.welcomerPub } : {}),
        ...(opts.routingId ? { r: opts.routingId } : {}),
        ...(cs ? { cs } : {}),
        ...(opts.linkId ? { lid: opts.linkId } : {}),
        ...(opts.audience ? { aud: opts.audience } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.shield ? { sh: opts.shield } : {}),
        ...(opts.history ? { hist: opts.history } : {}),
        ...(opts.maxUses !== undefined ? { mu: opts.maxUses } : {}),
        ...(opts.expiresAt !== undefined ? { exp: opts.expiresAt } : {}),
        ...(opts.relayClass ? { rc: opts.relayClass } : {}),
        ...(() => {
            if (!opts.do && opts.v !== 2)
                return {};
            if (opts.do !== undefined) {
                if (typeof opts.do !== 'string' || opts.do.length === 0 || opts.do.length > 640)
                    throw new Error('join link: do must be 1–640 chars');
                if (/[\u0000-\u001f]/.test(opts.do))
                    throw new Error('join link: do must not contain control characters');
            }
            return { v: 2, ...(opts.do ? { do: opts.do } : {}) };
        })(),
    })));
    return `https://${host}/chat/join#${fragment}`;
}
/**
 * parseJoinLink — trust-anchor note (threat model, documented not silent).
 *
 * The fragment travels WITH the claimant, so it is exactly as trustworthy
 * as the channel that delivered it. Its `w` (welcomer pubkey) field is the
 * one field a hostile channel could swap to redirect admission traffic:
 * a man-in-the-middle who rewrites `w` receives the joiner's admission
 * request (burner pubkey, PoW solution) instead of the real welcomer.
 * Residual risk is BOUNDED and accepted for v1:
 *   - the invite secret `k` rides the same fragment, so an MITM who can
 *     rewrite `w` already holds k — swapping it grants no NEW secret;
 *   - scribe/governance signatures bind room content, so content integrity
 *     does not depend on `w`;
 *   - worst case = admission DoS / joiner-isolated-into-a-fake-room-with-
 *     no-real-members, detectable when the expected community never appears.
 * Rooms needing stronger anchoring should pin governance/welcomer keys
 * OUT of band (verified channel) rather than trusting link-carried keys.
 */
export function parseJoinLink(link) {
    const hashIndex = link.indexOf('#');
    if (hashIndex < 0)
        throw new Error('join link has no fragment (link truncated?)');
    const frag = link.slice(hashIndex + 1);
    // Decode-bomb guard (audit P6a): the fragment is attacker-controlled
    // base64 — refuse absurd sizes BEFORE decoding/parsing.
    if (frag.length > 8192)
        throw new Error('join link fragment too large');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(base64url.decode(frag)));
    }
    catch {
        throw new Error('join link fragment is malformed or was truncated in transit — request a re-paste inside a code block');
    }
    // Transport-integrity gate FIRST (before any field validation): when the
    // fragment carries `cs`, verify it against the RAW decoded values. A
    // single drifted character inside a 64-hex key still passes every regex
    // downstream — this is the check that turns silent corruption into an
    // instant, quotable error (expected vs actual).
    if (parsed.cs !== undefined) {
        if (typeof parsed.cs !== 'string' || !/^[0-9a-f]{16}$/.test(parsed.cs)) {
            throw new Error(`join link checksum field malformed (cs must be 16 hex chars, got ${JSON.stringify(parsed.cs)})`);
        }
        const expected = joinLinkChecksum({
            inviteSecret: typeof parsed.k === 'string' ? parsed.k : undefined,
            roomId: typeof parsed.room === 'string' ? parsed.room : undefined,
            welcomerPub: typeof parsed.w === 'string' ? parsed.w : undefined,
            routingId: typeof parsed.r === 'string' ? parsed.r : undefined,
        });
        if (parsed.cs !== expected) {
            throw new Error(`join link CHECKSUM MISMATCH — fragment corrupted in transit (expected cs=${expected}, got cs=${parsed.cs}); re-request the link`);
        }
    }
    if (parsed.k !== undefined && (typeof parsed.k !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.k))) {
        throw new Error('bad invite secret');
    }
    if (typeof parsed.room !== 'string' || parsed.room.length === 0)
        throw new Error('bad room id');
    const out = { ...(typeof parsed.k === 'string' ? { inviteSecret: parsed.k } : {}), roomId: parsed.room };
    if (typeof parsed.relay === 'string')
        out.relay = parsed.relay;
    if (typeof parsed.w === 'string' && /^[0-9a-f]{64}$/.test(parsed.w))
        out.welcomerPub = parsed.w;
    if (typeof parsed.r === 'string' && /^[0-9a-f]{64}$/.test(parsed.r))
        out.routingId = parsed.r;
    if (typeof parsed.lid === 'string')
        out.linkId = parsed.lid;
    if (parsed.aud === 'human' || parsed.aud === 'agent')
        out.audience = parsed.aud;
    if (typeof parsed.label === 'string')
        out.label = parsed.label.slice(0, 80);
    if (typeof parsed.sh === 'string' && /^[0-9a-f]{64}$/.test(parsed.sh))
        out.shield = parsed.sh;
    if (parsed.hist === 'full' || parsed.hist === 'fresh')
        out.history = parsed.hist;
    // Grammar v2 fields (ignored-on-v1 links by construction).
    if (parsed.v === 2)
        out.v = 2;
    if (typeof parsed.do === 'string' && parsed.do.length <= 640)
        out.do = parsed.do;
    if (typeof parsed.mu === 'number' && Number.isSafeInteger(parsed.mu) && parsed.mu >= 1)
        out.maxUses = parsed.mu;
    if (typeof parsed.exp === 'number' && Number.isSafeInteger(parsed.exp) && parsed.exp >= 0)
        out.expiresAt = parsed.exp;
    if (parsed.rc === 'public' || parsed.rc === 'private')
        out.relayClass = parsed.rc;
    if (out.checksum === undefined && typeof parsed.cs === 'string')
        out.checksum = parsed.cs; // already verified above
    return out;
}
/**
 * joinInputFromJson — machine-to-machine handoff shape (same host or file
 * transfer): either `{ "link": "https://…#…" }`, a raw fragment string, or
 * a field map using the same labels as the split format. Zero long opaque
 * strings through chat layers.
 */
export function joinInputFromJson(value) {
    if (typeof value === 'string')
        return normalizeJoinInput(value);
    if (value && typeof value === 'object') {
        const rec = value;
        if (typeof rec.link === 'string')
            return normalizeJoinInput(rec.link);
        const get = (...names) => {
            for (const n of names) {
                const v = rec[n];
                if (typeof v === 'string' && v.length > 0)
                    return v;
            }
            return undefined;
        };
        const secret = get('secret', 'k', 'inviteSecret');
        const room = get('room', 'roomId');
        if (!room) {
            throw new Error('join json needs {"link": …}, a raw fragment string, or at least {"room": …} (+ "k" for invite-policy rooms)');
        }
        const optional = [
            ['relay', get('relay')],
            ['welcomer', get('welcomer', 'w', 'welcomerPub')],
            ['routing', get('routing', 'r', 'routingId')],
            ['history', get('history', 'hist')],
            ['cs', get('cs', 'checksum')],
        ];
        return normalizeJoinInput(['room=' + room, ...(secret ? ['secret=' + secret] : []), ...optional.filter(([, v]) => v).map(([l, v]) => `${l}=${v}`)].join('\n'));
    }
    throw new Error('join json needs {"link": …}, a field map, or a raw fragment string');
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Full §6 burner join. The burner keypair never escapes this function —
 * it is generated, used, and discarded here.
 */
export async function joinRoom(conn, link, roomInfo, opts = {}) {
    if (opts.agentPub && !opts.agentSecretKey) {
        throw new Error('agent identity claim requires its nsec signer — refusing an unproven npub');
    }
    if (opts.agentSecretKey && !opts.agentPub) {
        throw new Error('agent nsec signer requires its npub');
    }
    if (opts.agentPub && opts.agentSecretKey && getPublicKey(opts.agentSecretKey) !== opts.agentPub.toLowerCase()) {
        throw new Error('agent npub does not match the supplied nsec signer');
    }
    const clock = opts.clock ?? systemClock;
    const rng = opts.rng ?? defaultRng;
    const sleep = opts.sleep ?? defaultSleep;
    const nowMs = opts.nowMs ?? (() => Date.now());
    const { inviteSecret, roomId, relayClass } = parseJoinLink(link);
    // Relay-class privacy policy: explicit JoinOptions.privacy wins, else the
    // link's `rc` fragment, else the vanilla-safe public default.
    const policy = privacyPolicyFor(opts.privacy ?? relayClass);
    // 1. One-time burner keypair.
    const burnerSecret = generateSecretKey();
    const burnerPub = getPublicKey(burnerSecret);
    const primaryWelcomer = [roomInfo.welcomerPub].flat()[0];
    // 2. Join request. cap-pow rooms are two-phase (§5.2): first request asks
    // for a challenge (wantChallenge), the welcomer publishes it wrapped to
    // the burner, we solve and re-request with the proof.
    let challenge = roomInfo.challenge ?? null;
    const linkParts = parseJoinLink(link);
    // Agent join proof: when the caller holds the agent key, bind the claimed
    // durable identity to this room + burner (welcomer verifies via nipOa).
    const agentProof = opts.agentSecretKey && opts.agentPub
        ? await buildAgentJoinProof(opts.agentSecretKey, roomId, burnerPub)
        : undefined;
    const buildRequest = async (attempt) => ({
        join: true,
        roomId,
        invite: inviteSecret,
        ...(opts.agentPub ? { agent: opts.agentPub } : {}),
        ...(opts.agentAuth ? { agentAuth: opts.agentAuth } : {}),
        ...(agentProof ? { agentProof } : {}),
        ...(opts.proofs ? { proofs: opts.proofs } : {}),
        ...(linkParts.linkId ? { lid: linkParts.linkId } : {}),
        ...(linkParts.history ? { history: linkParts.history } : {}),
        wantChallenge: roomInfo.policy === 'cap-pow' && !challenge ? true : undefined,
        challenge,
        // JOIN-06: solvePow is async (yields to the event loop so a hostile
        // high-difficulty challenge cannot freeze the joiner). It MUST be
        // awaited here — an unawaited call stringifies the Promise into the
        // encrypted payload ("[object Promise]") and every welcomer rejects it.
        pow: challenge ? await solvePow(challenge, burnerPub) : null,
        // Republish-freshness (inside the ENCRYPTED payload — no wire change):
        // without it, rapid republishes share the jittered created_at second →
        // identical event id → relays drop every copy after the first as a
        // duplicate. If copy #1 landed before the room's welcomer subscribed
        // (hot-reload window), EVERY retry was invisible and joins hung for the
        // full timeout — the real-world "join takes minutes" disaster.
        ...(attempt > 1 ? { rn: attempt } : {}),
    });
    let publishAttempt = 0;
    const publishRequest = async () => {
        publishAttempt += 1;
        const joinEvent = signEvent({
            kind: JOIN_REQUEST,
            created_at: privacyTimestamp(clock, rng, policy),
            tags: [
                ['r', roomInfo.routingId],
                ['p', primaryWelcomer],
                ['-'],
            ],
            content: encryptDm(padJsonToBucket(JSON.stringify(await buildRequest(publishAttempt))), burnerSecret, primaryWelcomer, rng),
        }, burnerSecret);
        await conn.publish(joinEvent);
    };
    await publishRequest();
    // 3. Poll #p:[burner] for wraps, REPUBLISHING the join request with
    // jittered retries until a welcomer answers (spec §5.2 liveness: the
    // request is ephemeral — if every welcomer was offline or not yet
    // provisioned, it is lost; retrying is the protocol's answer).
    const timeoutMs = opts.joinTimeoutMs ?? 30_000;
    const republishMs = opts.republishIntervalMs ?? 1_200; // fast retry: a request may land before the welcomer hot-reloads a fresh room
    const deadline = nowMs() + timeoutMs;
    let lastPublish = nowMs();
    let wrap;
    while (nowMs() < deadline) {
        const wraps = await conn.query({ kinds: [KEY_WRAP], '#p': [burnerPub] }, 5_000);
        // Latest wrap wins; NIP-01 tie-break: equal created_at → LOWEST id.
        const welcomers = new Set([roomInfo.welcomerPub].flat().map((k) => k.toLowerCase()));
        const candidates = wraps
            .filter((w) => welcomers.has(w.pubkey.toLowerCase()) && verifyEvent(w))
            .sort((a, b) => b.created_at - a.created_at || (a.id > b.id ? 1 : -1));
        // Inspect candidates: a challenge wrap answers phase 1, a key wrap ends the join.
        for (const candidate of candidates) {
            let payload;
            try {
                payload = JSON.parse(decryptDm(candidate.content, burnerSecret, candidate.pubkey));
            }
            catch {
                continue; // forged/undecryptable — skip, never abort the join
            }
            if (payload.challenge && !payload.encKey) {
                // Phase 1 answer: solve (clamped — a hostile welcomer can't hang us) and re-request.
                const c = payload.challenge;
                if (typeof c.difficulty !== 'number' || c.difficulty < 0 || c.difficulty > 28) {
                    throw new Error(`welcomer demanded unreasonable PoW difficulty ${c.difficulty}`);
                }
                challenge = c;
                await publishRequest();
                lastPublish = nowMs();
                continue;
            }
            if (payload.encKey) {
                wrap = candidate;
                break;
            }
        }
        if (wrap)
            break;
        if (nowMs() - lastPublish >= republishMs) {
            await publishRequest(); // idempotent
            lastPublish = nowMs();
        }
        // Jittered poll cadence (±40%) — frustrates timing correlation (§6).
        const jitter = (opts.pollIntervalMs ?? 350) * (0.6 + 0.8 * ((rng(1)[0] ?? 128) / 255));
        await sleep(jitter);
    }
    if (!wrap)
        throw new Error('join timed out waiting for welcomer wrap');
    // 4. Decrypt the wrap, then DISCARD the burner (it never leaves this scope).
    const payload = JSON.parse(decryptDm(wrap.content, burnerSecret, wrap.pubkey));
    if (payload.roomId !== roomId)
        throw new Error('wrap room mismatch');
    if (!payload.governance || !/^[0-9a-f]{64}$/.test(payload.governance)) {
        throw new Error('wrap missing room governance key'); // fail-closed
    }
    // P2 (§8 join-forward): when the wrap carries the current epoch chain
    // key, derive the encKey from it — the client can ratchet forward from
    // here but never backwards. P1 wraps carry only encKey (static key).
    const chainKey = typeof payload.chainKey === 'string' && /^[0-9a-f]{64}$/.test(payload.chainKey)
        ? hexToBytes(payload.chainKey)
        : undefined;
    const encKey = chainKey ? deriveEpochKeys(chainKey, payload.epoch).encKey : hexToBytes(payload.encKey);
    // 5. Generate the per-room author key (P1: throwaway; P2: stream key
    // certified in-room by the device persona, attestation.ts).
    return {
        roomId,
        epoch: payload.epoch,
        encKey,
        routingId: payload.routingId,
        scribes: payload.scribes,
        governance: payload.governance,
        authorSecretKey: generateSecretKey(),
        shieldPub: payload.shield,
        ...(chainKey ? { chainKey } : {}),
        retiredAuthorSecretKeys: [],
        privacy: policy,
    };
}
// ─── Self-contained join (agent fast path) ─────────────────────────────────
/**
 * One-call join from a fat-fragment link (relay + welcomer + routing all in
 * the link): parse → connect → burner join → fresh session connection. The
 * 5-second agent path; no web host, no discovery calls.
 */
export async function joinFromLink(link, opts = {}) {
    const { RoomSession } = await import('./session.js');
    const { WsRelayConn } = await import('./wsConn.js');
    const parts = parseJoinLink(link);
    if (!parts.relay)
        throw new Error('join link carries no relay — not self-contained (use joinRoom with explicit roomInfo)');
    if (!parts.welcomerPub || !parts.routingId) {
        throw new Error('join link missing welcomer/routing fields (w/r) — the fragment was truncated, mangled by a chat layer, '
            + 'or is a stale inner link. Fix: re-run join with the FULL original /agent#… URL you received, #fragment included.');
    }
    const makeConn = opts.connFactory ?? ((url) => new WsRelayConn(url));
    // A caller override used to permit an invite for relay A to be joined and
    // subsequently posted through relay B. That is an exfiltration primitive,
    // not a liveness feature. Keep the option for API compatibility but only
    // accept the same endpoint.
    if (opts.relay !== undefined && !sameRelayEndpoint(opts.relay, parts.relay)) {
        throw new Error('relay override does not match the invite relay — refusing cross-relay room traffic');
    }
    const relayUrl = parts.relay;
    const joinConn = makeConn(relayUrl);
    // REL-01: the join connection MUST be closed even on the common failure
    // path (join timeout, wrap mismatch, PoW rejection). Without try/finally a
    // WsRelayConn leaks its socket + reconnect timer + any live subs on every
    // failed join — a CLI retry loop leaks one connection per attempt.
    let joined;
    try {
        joined = await joinRoom(joinConn, link, {
            welcomerPub: parts.welcomerPub,
            routingId: parts.routingId,
        }, opts);
    }
    finally {
        joinConn.close(); // §6: never continue on the join connection
    }
    const conn = makeConn(relayUrl);
    return { conn, session: new RoomSession(conn, joined), joined };
}
