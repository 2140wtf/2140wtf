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
import { bytesToHex } from './crypto.js';
import type { Rng } from './crypto.js';
export interface VoiceSealResult {
    generation: number;
    sealed: string;
    sealerPub: string;
}
/** The room's per-room welcomer pubkey (the seal target and the SFU-independent
 *  identity the API stores as `sealerPub`). */
export declare function voiceSealerPubkey(master: Uint8Array, roomId: string): string;
/**
 * Seal a hex voice root to the room's welcomer key. The sealed string is
 * NIP-44 ciphertext of `{roomId, generation, root}` so decryption verifies
 * what it claims (room + generation binding).
 */
export declare function sealVoiceRootForRoom(master: Uint8Array, roomId: string, rootHex: string, generation?: number, rng?: Rng): VoiceSealResult;
/**
 * Unseal a root previously sealed by `sealVoiceRootForRoom`. Returns the hex
 * root, or null on any failure (wrong room/key, generation mismatch, stale
 * format, malformed JSON) — callers must treat null as "voice capability
 * unavailable" and fail closed.
 */
export declare function unsealVoiceRootForRoom(master: Uint8Array, roomId: string, sealed: string, expectedGeneration: number): string | null;
/** Convenience for tests/admin tooling: the raw bytes of a hex root. */
export declare function rootHexToBytes(rootHex: string): Uint8Array;
export { bytesToHex };
