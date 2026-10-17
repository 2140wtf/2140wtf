/**
 * voiceSealCore — per-room voice-root sealing for the welcomer
 * (ADR-voice-invisible-rooms v10.2 §1).
 *
 * The API generates a random 32-byte `voiceRoot` at mint and asks the
 * welcomer daemon to seal it to the room's PER-ROOM welcomer key
 * (`HKDF(master, 'bao/role/welcomer/<roomId>')`). The seal is NIP-44 to that
 * key's own pubkey (self-ECDH), so only the welcomer can decrypt it; the API
 * stores just the ciphertext + the sealer pubkey and discards the root.
 *
 * Generation is metadata (0 at mint, >0 per rekey): the sealed payload binds
 * it so a stale registry copy cannot silently re-arm an old root. Fail
 * closed — every invalid input throws on seal and returns null on unseal.
 */
import { bytesToHex, decryptDm, deriveRoomRoleKey, encryptDm, getPublicKey, } from './crypto.js';
const ROOM_ID_RE = /^[0-9a-f]{16}$/;
const ROOT_RE = /^[0-9a-f]{64}$/;
function assertRoomId(roomId) {
    if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) {
        throw new Error('roomId must be 16 lowercase hex chars');
    }
}
function assertGeneration(generation) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new Error('generation must be a non-negative safe integer');
    }
}
/** The room's per-room welcomer pubkey (the seal target and the SFU-independent
 *  identity the API stores as `sealerPub`). */
export function voiceSealerPubkey(master, roomId) {
    assertRoomId(roomId);
    if (!(master instanceof Uint8Array) || master.length !== 32)
        throw new Error('welcomer master must be 32 raw bytes');
    return getPublicKey(deriveRoomRoleKey(master, 'welcomer', roomId));
}
/**
 * Seal a hex voice root to the room's welcomer key. The sealed string is
 * NIP-44 ciphertext of `{roomId, generation, root}` so decryption verifies
 * what it claims (room + generation binding).
 */
export function sealVoiceRootForRoom(master, roomId, rootHex, generation = 0, rng) {
    assertRoomId(roomId);
    assertGeneration(generation);
    if (typeof rootHex !== 'string' || !ROOT_RE.test(rootHex)) {
        throw new Error('voiceRoot must be 64 lowercase hex chars');
    }
    const secret = deriveRoomRoleKey(master, 'welcomer', roomId);
    const sealerPub = getPublicKey(secret);
    const sealed = encryptDm(JSON.stringify({ roomId, generation, root: rootHex }), secret, sealerPub, rng);
    return { generation, sealed, sealerPub };
}
/**
 * Unseal a root previously sealed by `sealVoiceRootForRoom`. Returns the hex
 * root, or null on any failure (wrong room/key, generation mismatch, stale
 * format, malformed JSON) — callers must treat null as "voice capability
 * unavailable" and fail closed.
 */
export function unsealVoiceRootForRoom(master, roomId, sealed, expectedGeneration) {
    try {
        assertRoomId(roomId);
        assertGeneration(expectedGeneration);
        if (typeof sealed !== 'string' || sealed.length === 0)
            return null;
        const secret = deriveRoomRoleKey(master, 'welcomer', roomId);
        const plaintext = decryptDm(sealed, secret, getPublicKey(secret));
        const parsed = JSON.parse(plaintext);
        if (parsed.roomId !== roomId)
            return null;
        if (parsed.generation !== expectedGeneration)
            return null;
        if (typeof parsed.root !== 'string' || !ROOT_RE.test(parsed.root))
            return null;
        return parsed.root;
    }
    catch {
        return null;
    }
}
/** Convenience for tests/admin tooling: the raw bytes of a hex root. */
export function rootHexToBytes(rootHex) {
    if (!ROOT_RE.test(rootHex))
        throw new Error('voiceRoot must be 64 lowercase hex chars');
    return Uint8Array.from(Buffer.from(rootHex, 'hex'));
}
export { bytesToHex };
