/**
 * voiceKeys — voice-room key derivation (ADR-voice-invisible-rooms v10.2).
 *
 * CORD-02 Appendix A shapes via the pinned authority in `adapters/concordKeys`.
 * One voice room per chat room per `voiceGeneration`: every member derives the
 * same `voice_room` from the wrap-delivered `voiceRoot`, and the generation
 * changes only on rekey (never tied to the ratcheting room epoch).
 *
 * Byte layout is pinned by independent HKDF reconstruction in the tests and by
 * `voice-keys.json` regression vectors; cross-implementation CORD conformance
 * remains the interop gate and is not claimed yet.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { CONCORD_LABEL, concordGroupKey, concordRawKey } from './adapters/concordKeys.js';
import { ProtocolError } from './protocolError.js';
/** BAO-local label (not in CORD-02 A.6; never part of a CORD claim). */
export const VOICE_CHANNEL_ID_LABEL = 'bao/voice-channel-id';
export function assertRoomId(roomId) {
    if (typeof roomId !== 'string' || !/^[0-9a-f]{16}$/.test(roomId)) {
        throw new ProtocolError('malformed', 'roomId must be 16 lowercase hex chars');
    }
}
export function assertVoiceRoot(voiceRoot) {
    if (!(voiceRoot instanceof Uint8Array) || voiceRoot.length !== 32) {
        throw new ProtocolError('malformed', 'voiceRoot must be 32 raw bytes');
    }
}
export function assertVoiceGeneration(voiceGeneration) {
    if (!Number.isSafeInteger(voiceGeneration) || voiceGeneration < 0) {
        throw new ProtocolError('malformed', 'voiceGeneration must be a non-negative safe integer');
    }
}
/** Broker-issued opaque identity: lowercase hex, at least 16 random bytes. */
export function assertVoiceIdentity(identity) {
    if (typeof identity !== 'string' || identity.length < 32 || identity.length % 2 !== 0 || !/^[0-9a-f]+$/.test(identity)) {
        throw new ProtocolError('malformed', 'identity must be lowercase hex of at least 16 bytes');
    }
}
export function serializeVoiceGeneration(voiceGeneration) {
    assertVoiceGeneration(voiceGeneration);
    return voiceGeneration.toString(16).padStart(16, '0');
}
export function parseVoiceGeneration(hex) {
    if (typeof hex !== 'string' || !/^[0-9a-f]{16}$/.test(hex)) {
        throw new ProtocolError('malformed', 'voiceGeneration must be 16 lowercase hex chars');
    }
    const value = BigInt(`0x${hex}`);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ProtocolError('malformed', 'voiceGeneration exceeds 2^53-1');
    }
    return Number(value);
}
/** `channelId32 = H(voiceRoot, "bao/voice-channel-id", sha256(utf8(roomId)))`. */
export function deriveVoiceChannelId(voiceRoot, roomId) {
    assertVoiceRoot(voiceRoot);
    assertRoomId(roomId);
    return concordRawKey(VOICE_CHANNEL_ID_LABEL, voiceRoot, sha256(utf8ToBytes(roomId)));
}
export function deriveVoiceKeys(input) {
    assertVoiceRoot(input.voiceRoot);
    assertRoomId(input.roomId);
    assertVoiceGeneration(input.voiceGeneration);
    const channelId = deriveVoiceChannelId(input.voiceRoot, input.roomId);
    const signer = concordGroupKey({
        label: CONCORD_LABEL.voiceSigner,
        secret: input.voiceRoot,
        id: channelId,
        epoch: input.voiceGeneration,
    });
    const voiceMediaKey = concordRawKey(CONCORD_LABEL.voiceMedia, input.voiceRoot, channelId, input.voiceGeneration);
    return { voiceRoom: signer.pk, voiceSignerSecret: signer.sk, voiceMediaKey, channelId };
}
/** Per-sender media key: `H(media, "concord/voice-sender", sha256(identity))`. */
export function deriveSenderKey(voiceMediaKey, identity) {
    if (!(voiceMediaKey instanceof Uint8Array) || voiceMediaKey.length !== 32) {
        throw new ProtocolError('malformed', 'voiceMediaKey must be 32 raw bytes');
    }
    assertVoiceIdentity(identity);
    return concordRawKey(CONCORD_LABEL.voiceSender, voiceMediaKey, sha256(utf8ToBytes(identity)));
}
