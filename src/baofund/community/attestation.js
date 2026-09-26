/**
 * Attestation chain — spec §2 (key hierarchy), §10 (identity), rule 4.
 *
 * P2 key hierarchy:
 *
 *   Main key (extension / bunker / cold)      → signs ONE persona attestation
 *    └─ Device persona (local, per device)    → signs stream-key sub-attestations
 *        └─ Room stream key (per room/device) → authors ALL room traffic
 *
 * Design constraints (spec §2):
 *   - The main key may live behind a browser extension — certification goes
 *     through the minimal `MainSigner` interface; the nsec is NEVER required.
 *   - Sub-attestations are carried INSIDE the room (envelope payloads,
 *     encrypted to the room content key) — NEVER relay-published (rule 2:
 *     nothing persistent is addressed to a durable key; rule: there is no
 *     public-directory mode).
 *   - Revocation is scoped (one stream key / one persona / the whole tree)
 *     and folds latest-state-wins in (created_at, id) lexicographic order —
 *     arrival order never matters (rule 4). Revocation authority: the
 *     granting key or an ancestor of it in the chain. Equal created_at
 *     tie-break: event id (LOWEST id wins, matching NIP-01 replacement
 *     semantics).
 *
 * Wire form: attestations and revocations are signed Nostr events. They are
 * verified with standard id/signature semantics. Kind is the room-governance
 * state carrier kind (REDACTION_LIST, 31146) with purpose tags — the kind
 * number is load-bearing ONLY for signature verification; these events are
 * never sent to a relay.
 */
import { systemClock, bytesToHex, hexToBytes, signEvent, verifyEvent, getPublicKey, findTag, } from './crypto.js';
import { REDACTION_LIST } from './kinds.js';
/** Kind used for attestation/revocation events. In-room carriage only —
 *  reuses the governance state carrier kind; never published to a relay. */
export const ATTESTATION_CARRIER_KIND = REDACTION_LIST;
// ─── Purposes (d-tag values) ───────────────────────────────────────────────
/** Main key certifies a device persona (ONE per device, ever). */
export const PURPOSE_PERSONA = 'bao-attest:persona';
/** Persona certifies a per-room stream key. */
export const PURPOSE_STREAM = 'bao-attest:stream';
/** Revocation of a persona or stream attestation (scoped). */
export const PURPOSE_REVOKE = 'bao-attest:revoke';
export function localSigner(secretKey) {
    return { publicKey: getPublicKey(secretKey), secretKey };
}
function dTag(...parts) {
    return parts.join(':');
}
/** Default attestation lifetime: 30 days (re-published per epoch in-room). */
export const DEFAULT_ATTESTATION_TTL_SEC = 30 * 24 * 3600;
// ─── Certification ─────────────────────────────────────────────────────────
/**
 * Main key certifies a device persona. ONE signature per device, ever.
 * Works with an extension signer (async) or a local keypair (sync wrapper).
 */
export async function certifyPersona(main, personaPub, opts = {}) {
    const clock = opts.clock ?? systemClock;
    if (!/^[0-9a-f]{64}$/.test(personaPub))
        throw new Error('invalid persona pubkey');
    const mainPub = await main.getPublicKey();
    const expiry = opts.expiry ?? clock.nowSec() + DEFAULT_ATTESTATION_TTL_SEC;
    const template = {
        kind: ATTESTATION_CARRIER_KIND,
        created_at: clock.nowSec(),
        tags: [
            ['d', dTag(PURPOSE_PERSONA, personaPub)],
            ['p', personaPub],
            ['purpose', 'persona'],
            ['expiration', String(expiry)],
        ],
        content: '',
    };
    const event = await main.signEvent(template);
    return { event, mainPub, personaPub, expiry };
}
/** Sync convenience for tests/agents holding the main keypair locally.
 *  Implemented directly — NOT via the async interface (a promise .then
 *  never resolves inside a synchronous call). */
export function certifyPersonaLocal(mainSecretKey, personaPub, opts = {}) {
    const clock = opts.clock ?? systemClock;
    if (!/^[0-9a-f]{64}$/.test(personaPub))
        throw new Error('invalid persona pubkey');
    const mainPub = getPublicKey(mainSecretKey);
    const expiry = opts.expiry ?? clock.nowSec() + DEFAULT_ATTESTATION_TTL_SEC;
    const event = signEvent({
        kind: ATTESTATION_CARRIER_KIND,
        created_at: clock.nowSec(),
        tags: [
            ['d', dTag(PURPOSE_PERSONA, personaPub)],
            ['p', personaPub],
            ['purpose', 'persona'],
            ['expiration', String(expiry)],
        ],
        content: '',
    }, mainSecretKey);
    return { event, mainPub, personaPub, expiry };
}
/** Persona certifies a per-room stream key (local signature — personas are
 *  always local keys, so this is synchronous). `personaEventId` binds the
 *  cert to ONE persona attestation event (anti-re-rooting, spec rule 4):
 *  pass the event id of the persona attestation you hold. */
export function certifyStreamKey(personaSecretKey, streamPub, roomId, opts) {
    const clock = opts.clock ?? systemClock;
    if (!/^[0-9a-f]{64}$/.test(streamPub))
        throw new Error('invalid stream pubkey');
    if (typeof roomId !== 'string' || roomId.length === 0)
        throw new Error('missing roomId');
    if (!/^[0-9a-f]{64}$/.test(opts.personaEventId))
        throw new Error('invalid personaEventId');
    const personaPub = getPublicKey(personaSecretKey);
    const expiry = opts.expiry ?? clock.nowSec() + DEFAULT_ATTESTATION_TTL_SEC;
    const event = signEvent({
        kind: ATTESTATION_CARRIER_KIND,
        created_at: clock.nowSec(),
        tags: [
            ['d', dTag(PURPOSE_STREAM, roomId, streamPub)],
            ['p', streamPub],
            ['e', opts.personaEventId],
            ['purpose', 'stream'],
            ['room', roomId],
            ['expiration', String(expiry)],
        ],
        content: '',
    }, personaSecretKey);
    return { event, personaPub, streamPub, roomId, expiry, personaEventId: opts.personaEventId };
}
/**
 * Revoke an attestation. Authority: the granting key or an ancestor —
 * enforcement happens in foldAttestations (a revocation signed by an
 * unrelated key is ignored there).
 */
export function revokeAttestation(authoritySecretKey, targetId, scope, opts = {}) {
    const clock = opts.clock ?? systemClock;
    if (!/^[0-9a-f]{64}$/.test(targetId))
        throw new Error('invalid target event id');
    const authority = getPublicKey(authoritySecretKey);
    const event = signEvent({
        kind: ATTESTATION_CARRIER_KIND,
        created_at: clock.nowSec(),
        tags: [
            ['d', dTag(PURPOSE_REVOKE, targetId)],
            ['e', targetId],
            ['purpose', 'revoke'],
            ['scope', scope],
        ],
        content: '',
    }, authoritySecretKey);
    return { event, authority, targetId, scope };
}
// ─── Parsing (tolerant; throws on structural failure) ─────────────────────
export function parseAttestationEvent(event) {
    if (event.kind !== ATTESTATION_CARRIER_KIND)
        throw new Error(`unexpected kind ${event.kind}`);
    if (!verifyEvent(event))
        throw new Error('bad signature');
    const purpose = findTag(event, 'purpose');
    const d = findTag(event, 'd') ?? '';
    const target = findTag(event, 'p');
    if (!target || !/^[0-9a-f]{64}$/.test(target))
        throw new Error('missing/invalid p tag');
    const expiryStr = findTag(event, 'expiration');
    const expiry = expiryStr ? Number(expiryStr) : 0;
    if (!Number.isSafeInteger(expiry) || expiry < 0)
        throw new Error('invalid expiry');
    if (purpose === 'persona') {
        if (d !== dTag(PURPOSE_PERSONA, target))
            throw new Error('d-tag mismatch');
        return { event, mainPub: event.pubkey, personaPub: target, expiry };
    }
    if (purpose === 'stream') {
        const roomId = findTag(event, 'room');
        if (!roomId)
            throw new Error('missing room tag');
        if (d !== dTag(PURPOSE_STREAM, roomId, target))
            throw new Error('d-tag mismatch');
        const personaEventId = findTag(event, 'e');
        if (!personaEventId || !/^[0-9a-f]{64}$/.test(personaEventId))
            throw new Error('missing/invalid persona binding (e tag)');
        return { event, personaPub: event.pubkey, streamPub: target, roomId, expiry, personaEventId };
    }
    throw new Error(`unknown purpose: ${purpose}`);
}
export function parseRevocationEvent(event) {
    if (event.kind !== ATTESTATION_CARRIER_KIND)
        throw new Error(`unexpected kind ${event.kind}`);
    if (!verifyEvent(event))
        throw new Error('bad signature');
    if (findTag(event, 'purpose') !== 'revoke')
        throw new Error('not a revocation');
    const targetId = findTag(event, 'e');
    if (!targetId || !/^[0-9a-f]{64}$/.test(targetId))
        throw new Error('missing/invalid e tag');
    if (findTag(event, 'd') !== dTag(PURPOSE_REVOKE, targetId))
        throw new Error('d-tag mismatch');
    const scope = findTag(event, 'scope');
    if (scope !== 'stream' && scope !== 'persona' && scope !== 'tree')
        throw new Error('invalid scope');
    return { event, authority: event.pubkey, targetId, scope };
}
/** Rule 4 ordering: fold in (created_at, id) lexicographic order.
 *  Latest-state-wins. Equal created_at tie-break: LOWEST id sorts LAST,
 *  i.e. the lowest id WINS the tie and is treated as the latest state —
 *  this matches NIP-01 replacement semantics (lowest id is kept). */
function byRule4(a, b) {
    return a.created_at - b.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
/**
 * Verify a stream ← persona ← main chain against a set of revocations.
 *
 * Authority rule (spec rule 4): a revocation is honored only when signed by
 *   - 'stream' scope: the stream's granting persona, the persona's granting
 *     main key, or the stream key itself (self-revocation).
 *   - 'persona' scope: the persona's granting main key or the persona
 *     itself. Revoking a persona cascades to ALL its stream keys.
 *   - 'tree' scope: the main key only. Revokes everything rooted at it.
 *
 * Latest-state-wins (rule 4): a grant is revoked iff an authoritative
 * revocation targeting it is NEWER than the grant in (created_at, id)
 * order (ties favor the revocation — it sorts later when ids differ, and
 * an identical event cannot be both). An older revocation is superseded
 * by the later grant (re-grant-after-revoke: latest wins). Arrival order
 * never matters — the fold is a pure function of the event set.
 *
 * Time checks (expiry) are evaluated at `nowSec` — pass a fixed value in
 * tests/vector verification for determinism.
 */
export function foldChain(persona, stream, revocations, opts = {}) {
    // Structural chain checks (order-independent).
    if (stream.personaPub !== persona.personaPub)
        return { valid: false, reason: 'stream certified by a different persona' };
    // Anti-re-rooting: the stream cert is bound to ONE persona attestation
    // event — a foreign main re-certifying the same personaPub yields a
    // different event id and can never satisfy this binding.
    if (stream.personaEventId !== persona.event.id)
        return { valid: false, reason: 'stream bound to a different persona attestation' };
    const now = opts.nowSec ?? systemClock.nowSec();
    if (persona.expiry !== 0 && persona.expiry <= now)
        return { valid: false, reason: 'persona attestation expired' };
    if (stream.expiry !== 0 && stream.expiry <= now)
        return { valid: false, reason: 'stream attestation expired' };
    const chain = { persona, stream };
    const mainPub = persona.mainPub;
    const personaPub = persona.personaPub;
    const streamPub = stream.streamPub;
    const kills = (rev) => {
        // Revocation must be authoritative for this chain.
        const authoritative = rev.scope === 'tree'
            ? rev.authority === mainPub
            : rev.scope === 'persona'
                ? rev.authority === mainPub || rev.authority === personaPub
                : rev.authority === personaPub || rev.authority === mainPub || rev.authority === streamPub;
        if (!authoritative)
            return null;
        // 'tree' by the root poisons EVERYTHING rooted at mainPub — no targetId
        // match required (sibling personas die too). Latest-state-wins still
        // applies per grant: a tree-revoke older than a re-grant is superseded.
        if (rev.scope === 'tree') {
            if (byRule4(rev.event, persona.event) >= 0)
                return 'persona';
            if (byRule4(rev.event, stream.event) >= 0)
                return 'stream';
            return null;
        }
        if (rev.targetId === stream.event.id && byRule4(rev.event, stream.event) >= 0)
            return 'stream';
        if (rev.targetId === persona.event.id && rev.scope === 'persona' && byRule4(rev.event, persona.event) >= 0) {
            return 'persona';
        }
        return null;
    };
    for (const rev of revocations) {
        const hit = kills(rev);
        if (hit)
            return { valid: false, reason: `${hit} revoked (${rev.scope}) by ${rev.authority.slice(0, 12)}…` };
    }
    return { valid: true, chain };
}
/**
 * Verify a room-bound chain end-to-end: signatures already checked at
 * parse; here we bind the stream attestation to the expected room.
 */
export function verifyChain(persona, stream, roomId, revocations = [], opts = {}) {
    if (stream.roomId !== roomId)
        return { valid: false, reason: 'stream attestation is for a different room' };
    return foldChain(persona, stream, revocations, opts);
}
/**
 * Select the current chain state from an unordered event soup (rule 4,
 * pure function of the event set): given MULTIPLE candidate persona and
 * stream attestations for the same (personaPub, streamPub, roomId), the
 * latest stream attestation + latest persona attestation for its persona
 * win, then foldChain decides — re-grant-after-revoke falls out of the
 * per-grant latest-state-wins comparison inside foldChain.
 */
export function foldAttestationSets(personas, streams, revocations, opts) {
    const streamCand = streams
        .filter((s) => s.streamPub === opts.streamPub && s.roomId === opts.roomId && s.personaPub === opts.personaPub)
        .sort((a, b) => byRule4(b.event, a.event))[0];
    if (!streamCand)
        return { valid: false, reason: 'no attestation chain for this stream key' };
    // Anti-re-rooting: only the persona attestation the stream cert is BOUND
    // to can root this chain. A later foreign re-certification of the same
    // personaPub is ignored — it can never satisfy the binding.
    const personaCand = personas
        .filter((p) => p.personaPub === opts.personaPub && p.event.id === streamCand.personaEventId)
        .sort((a, b) => byRule4(b.event, a.event))[0];
    if (!personaCand)
        return { valid: false, reason: 'no bound persona attestation for this chain' };
    return foldChain(personaCand, streamCand, revocations, { nowSec: opts.nowSec });
}
export function attestationPayload(chain) {
    return { type: 'attestation', chain: { persona: chain.persona.event, stream: chain.stream.event } };
}
export function revocationPayload(rev) {
    return { type: 'attestation-revoke', revocation: rev.event };
}
/** Tolerant parse of an in-room attestation payload. Returns null for
 *  foreign payloads (rooms carry app-level content of any shape). */
export function parseAttestationPayload(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const p = payload;
    if (p.type !== 'attestation')
        return null;
    const chain = p.chain;
    if (!chain || typeof chain !== 'object')
        return null;
    try {
        const persona = parseAttestationEvent(chain.persona);
        const stream = parseAttestationEvent(chain.stream);
        if (!('mainPub' in persona) || !('roomId' in stream))
            return null;
        return { chain: { persona: persona, stream: stream } };
    }
    catch {
        return null;
    }
}
/** Tolerant parse of an in-room revocation payload. */
export function parseRevocationPayload(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const p = payload;
    if (p.type !== 'attestation-revoke')
        return null;
    try {
        return parseRevocationEvent(p.revocation);
    }
    catch {
        return null;
    }
}
export { bytesToHex, hexToBytes };
