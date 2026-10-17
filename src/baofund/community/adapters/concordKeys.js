/**
 * Concord key derivations - CORD-02 Appendix A (frozen), pinned
 * `concord-protocol/concord@b84554ea`.
 *
 * These derivations ADDRESS every Concord plane (`{"kinds":[1059],"authors":[pk]}`),
 * so a wrong byte re-addresses history: the layouts here are normative, not
 * implementation detail. Byte-exact rules:
 *
 *   hkdf(secret, label, id, epoch) =
 *     HKDF-SHA256(ikm = secret, salt = "" (zero length),
 *                 info = utf8(label) || 0x00 || id[32] || [epoch_be u64],
 *                 len = 32)
 *
 * `id` is raw 32 bytes (never hex); `epoch` is the only omittable field
 * (A.6). `scalar_normalize` retries by appending an incrementing counter
 * byte to `info` after the present fields.
 *
 * Coordinate labels (`concord/grant`, `concord/banlist`, …) yield the pk
 * only; callers use `concordCoordinate`. Raw labels (`concord/invite-key`)
 * return the un-normalized 32-byte key.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, utf8ToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { nip44 } from 'nostr-tools';
import { ProtocolError } from '../protocolError.js';
export const CONCORD_HKDF_LEN = 32;
export const CONCORD_ZERO_ID = new Uint8Array(32);
/** A.6 labels used by the adapter surfaces (extend only with the spec's table). */
export const CONCORD_LABEL = {
    channel: 'concord/channel',
    controlRead: 'concord/control',
    controlSigner: 'concord/control-signer',
    guestbook: 'concord/guestbook',
    voiceSigner: 'concord/voice-signer',
    voiceMedia: 'concord/voice-media',
    voiceSender: 'concord/voice-sender',
    inviteKey: 'concord/invite-key',
    grant: 'concord/grant',
    banlist: 'concord/banlist',
    pins: 'concord/pins',
    inviteLinks: 'concord/invite-links',
    dissolved: 'concord/dissolved',
};
/** Labels whose A.6 row marks an epoch (yes); others omit the 8 trailing bytes. */
const EPOCHED_LABELS = new Set([
    CONCORD_LABEL.channel,
    CONCORD_LABEL.controlRead,
    CONCORD_LABEL.controlSigner,
    CONCORD_LABEL.guestbook,
    CONCORD_LABEL.voiceSigner,
    CONCORD_LABEL.voiceMedia,
]);
function assertId32(field, value) {
    if (!(value instanceof Uint8Array) || value.length !== 32) {
        throw new ProtocolError('malformed', `${field} must be 32 raw bytes`);
    }
    return value;
}
function assertSecret(field, value) {
    if (!(value instanceof Uint8Array) || value.length === 0 || value.length > 64) {
        throw new ProtocolError('malformed', `${field} must be 1..64 raw bytes`);
    }
    return value;
}
function epochBytes(epoch) {
    if (!Number.isSafeInteger(epoch) || epoch < 0)
        throw new ProtocolError('malformed', 'epoch must be a non-negative safe integer');
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(epoch), false);
    return out;
}
function infoBytes(label, id, epoch, counter) {
    const labelBytes = utf8ToBytes(label);
    const parts = [labelBytes, new Uint8Array([0]), id];
    if (epoch !== undefined)
        parts.push(epochBytes(epoch));
    if (counter !== undefined)
        parts.push(new Uint8Array([counter]));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const info = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        info.set(part, offset);
        offset += part.length;
    }
    return info;
}
/** Raw A.1 HKDF output (no normalization) - e.g. `concord/invite-key`. */
export function concordRawKey(label, secret, id, epoch) {
    assertSecret('secret', secret);
    assertId32('id', id);
    if (epoch !== undefined && !EPOCHED_LABELS.has(label)) {
        // The spec omits the epoch for labels marked "-"; calling with one is a
        // caller bug, not a different universe.
        throw new ProtocolError('malformed', `label ${label} has no epoch field in A.6`);
    }
    if (epoch === undefined && EPOCHED_LABELS.has(label)) {
        throw new ProtocolError('malformed', `label ${label} requires an epoch`);
    }
    return hkdf(sha256, secret, new Uint8Array(0), infoBytes(label, id, epoch), CONCORD_HKDF_LEN);
}
/**
 * A.2/A.3 group key: seed → valid scalar (counter retry) → x-only pk +
 * NIP-44 self-ECDH conversation key.
 */
export function concordGroupKey(input) {
    assertSecret('secret', input.secret);
    const id = assertId32('id', input.id);
    if (EPOCHED_LABELS.has(input.label) && input.epoch === undefined) {
        throw new ProtocolError('malformed', `label ${input.label} requires an epoch`);
    }
    if (!EPOCHED_LABELS.has(input.label) && input.epoch !== undefined) {
        throw new ProtocolError('malformed', `label ${input.label} has no epoch field in A.6`);
    }
    let counter;
    // First attempt without a counter, then counters 0..255 (CORD-02 A.2/A.3).
    for (let attempt = 0; attempt <= 256; attempt += 1) {
        const seed = hkdf(sha256, input.secret, new Uint8Array(0), infoBytes(input.label, id, input.epoch, counter), CONCORD_HKDF_LEN);
        if (secp256k1.utils.isValidSecretKey(seed)) {
            const pk = bytesToHex(schnorr.getPublicKey(seed));
            return { sk: seed, pk, convKey: nip44.v2.utils.getConversationKey(seed, pk) };
        }
        counter = attempt;
    }
    throw new ProtocolError('unsupported_protocol', 'scalar_normalize exhausted its retry budget');
}
/** Coordinate labels yield the pk only (the on-wire address). */
export function concordCoordinate(label, secret, id, epoch) {
    return concordGroupKey({ label, secret, id, epoch }).pk;
}
/** CORD-05 §2: `bundle_key = hkdf(token, "concord/invite-key")` (raw 32 bytes). */
export function concordInviteKey(token) {
    if (!(token instanceof Uint8Array) || token.length !== 16) {
        throw new ProtocolError('malformed', 'invite token must be 16 raw bytes');
    }
    return concordRawKey(CONCORD_LABEL.inviteKey, token, CONCORD_ZERO_ID);
}
export function hexToConcordId(hex) {
    if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/.test(hex))
        throw new ProtocolError('malformed', 'id must be 64-char lowercase hex');
    return hexToBytes(hex);
}
export function sha256HexUtf8(value) {
    return bytesToHex(sha256(utf8ToBytes(value)));
}
