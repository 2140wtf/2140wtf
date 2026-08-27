/**
 * Disclosure dial + custody tiers — spec §10.
 *
 * Disclosure is per user, per room, ONE-WAY (you can reveal more, never
 * less — UI must say so). All disclosure state travels INSIDE the room,
 * encrypted to the room content key: the relay never sees which stream key
 * belongs to which persona/main key.
 *
 *   verified       main npub (+ optional NIP-05) shown to members — the
 *                  badge is cryptographic (a signature by the main key),
 *                  unforgeable.
 *   named-persona  a display name bound to the device persona (default).
 *   full-pseudonym nothing beyond the stream key (chain admins-only).
 *
 * Custody is a CLIENT policy, not a protocol constraint (spec §10):
 *   strict  persona per device, one main-key signature, re-wraps.
 *   synced  passphrase-encrypted key-bundle export/import (this module).
 *   bunker  NIP-46 remote signing — interface passthrough only (the
 *           bunker satisfies MainSigner; this module adds nothing).
 */
import { systemClock, defaultRng, bytesToHex, hexToBytes, utf8ToBytes, signEvent, verifyEvent, getPublicKey, encryptToRoomKey, decryptWithRoomKey, } from './crypto.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { REDACTION_LIST } from './kinds.js';
const DISCLOSURE_PURPOSE = 'bao-disclosure';
function disclosureTags(c) {
    const tags = [
        ['d', `${DISCLOSURE_PURPOSE}:${c.roomId}:${c.streamPub}`],
        ['purpose', 'disclosure'],
        ['room', c.roomId],
        ['p', c.streamPub],
        ['level', c.level],
    ];
    if (c.name)
        tags.push(['name', c.name]);
    if (c.mainPub)
        tags.push(['main', c.mainPub]);
    if (c.nip05)
        tags.push(['nip05', c.nip05]);
    return tags;
}
/**
 * Build a disclosure claim. For 'verified', pass a MainSigner (extension —
 * the badge signature proves main-key control without the nsec).
 */
export async function buildDisclosureClaim(streamSecretKey, roomId, level, opts = {}) {
    const clock = opts.clock ?? systemClock;
    const streamPub = getPublicKey(streamSecretKey);
    if (level === 'verified' && !opts.main)
        throw new Error("level 'verified' requires a main-key signer (the badge is cryptographic)");
    const base = {
        level,
        streamPub,
        roomId,
        ...(opts.name ? { name: opts.name.slice(0, 40) } : {}),
        ...(level === 'verified' && opts.nip05 ? { nip05: opts.nip05 } : {}),
    };
    let mainPub;
    let mainEvent;
    if (level === 'verified' && opts.main) {
        mainPub = await opts.main.getPublicKey();
        const tags = disclosureTags({ ...base, mainPub });
        mainEvent = await opts.main.signEvent({
            kind: REDACTION_LIST,
            created_at: clock.nowSec(),
            tags: [...tags, ['badge', 'main']],
            content: '',
        });
    }
    const tags = disclosureTags({ ...base, ...(mainPub ? { mainPub } : {}) });
    const event = signEvent({ kind: REDACTION_LIST, created_at: clock.nowSec(), tags, content: '' }, streamSecretKey);
    return { ...base, ...(mainPub ? { mainPub } : {}), event, ...(mainEvent ? { mainEvent } : {}) };
}
export function disclosurePayload(claim) {
    return { type: 'disclosure', claim: { event: claim.event, ...(claim.mainEvent ? { mainEvent: claim.mainEvent } : {}) } };
}
function tagValue(event, name) {
    return event.tags.find((t) => t[0] === name)?.[1];
}
/** Tolerant parse + full verification of a disclosure payload. Returns
 *  null for foreign payloads; throws are converted to null (a malformed
 *  claim is ignored at render, never fatal). */
export function parseDisclosurePayload(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const p = payload;
    if (p.type !== 'disclosure')
        return null;
    const raw = p.claim;
    if (!raw || typeof raw !== 'object' || !raw.event)
        return null;
    try {
        const event = raw.event;
        if (!verifyEvent(event))
            return null;
        if (tagValue(event, 'purpose') !== 'disclosure')
            return null;
        const level = tagValue(event, 'level');
        if (level !== 'verified' && level !== 'named-persona' && level !== 'full-pseudonym')
            return null;
        const roomId = tagValue(event, 'room');
        const streamPub = tagValue(event, 'p');
        if (!roomId || !streamPub || streamPub !== event.pubkey)
            return null; // claim must be self-signed by the stream key
        if (tagValue(event, 'd') !== `${DISCLOSURE_PURPOSE}:${roomId}:${streamPub}`)
            return null;
        const name = tagValue(event, 'name');
        const mainPub = tagValue(event, 'main');
        const nip05 = tagValue(event, 'nip05');
        if (level === 'verified') {
            // The badge: a main-key signature over IDENTICAL binding fields.
            if (!mainPub || !/^[0-9a-f]{64}$/.test(mainPub))
                return null;
            const mainEvent = raw.mainEvent;
            if (!mainEvent || !verifyEvent(mainEvent))
                return null;
            if (mainEvent.pubkey !== mainPub)
                return null;
            for (const [tag, expected] of [
                ['purpose', 'disclosure'],
                ['room', roomId],
                ['p', streamPub],
                ['level', 'verified'],
                ['main', mainPub],
            ]) {
                if (tagValue(mainEvent, tag) !== expected)
                    return null;
            }
        }
        return {
            level,
            streamPub,
            roomId,
            ...(name ? { name } : {}),
            ...(mainPub ? { mainPub } : {}),
            ...(nip05 ? { nip05 } : {}),
            event,
            ...(raw.mainEvent ? { mainEvent: raw.mainEvent } : {}),
        };
    }
    catch {
        return null;
    }
}
/**
 * One-way dial enforcement (spec §10: disclosure is one-way per room):
 * given the member's PREVIOUS level, reject transitions that reveal less.
 * Ordering: full-pseudonym (0) < named-persona (1) < verified (2).
 */
export function disclosureTransitionAllowed(previous, next) {
    const rank = { 'full-pseudonym': 0, 'named-persona': 1, verified: 2 };
    return rank[next] >= rank[previous];
}
export const MIN_PASSPHRASE_LENGTH = 12;
/**
 * Passphrase  bundle key. NOTE (accepted risk): HKDF has NO work factor —
 * weak passphrases are brute-forceable at full hash speed. The 12-char
 * floor is the mitigation; clients SHOULD surface that in the UI. A
 * memory-hard KDF (scrypt/argon2) is a deliberate future upgrade once a
 * license-clean browser-safe implementation is adopted.
 */
function bundleKeyFromPassphrase(passphrase, salt) {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }
    return hkdf(sha256, utf8ToBytes(passphrase), salt, utf8ToBytes('bao/custody/bundle'), 32);
}
export function exportKeyBundle(bundle, passphrase, rng = defaultRng) {
    const salt = rng(16);
    const key = bundleKeyFromPassphrase(passphrase, salt);
    return { ciphertext: encryptToRoomKey(JSON.stringify(bundle), key, rng), salt: bytesToHex(salt) };
}
export function importKeyBundle(exported, passphrase) {
    const key = bundleKeyFromPassphrase(passphrase, hexToBytes(exported.salt));
    const raw = JSON.parse(decryptWithRoomKey(exported.ciphertext, key));
    if (raw.v !== 1)
        throw new Error(`unsupported bundle version: ${raw.v}`);
    if (typeof raw.personaSecretKey !== 'string' || !/^[0-9a-f]{64}$/.test(raw.personaSecretKey)) {
        throw new Error('bundle missing persona key');
    }
    if (typeof raw.streamKeys !== 'object' || raw.streamKeys === null)
        throw new Error('bundle missing streamKeys');
    if (typeof raw.chainKeys !== 'object' || raw.chainKeys === null)
        throw new Error('bundle missing chainKeys');
    return raw;
}
// Re-export for payload-doc coherence (spec §10 mentions QR transfer as an
// alternative transport — the bundle format above is transport-agnostic).
export { bytesToHex, hexToBytes, utf8ToBytes };
