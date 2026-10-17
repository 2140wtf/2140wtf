/** BAO-local label (not in CORD-02 A.6; never part of a CORD claim). */
export declare const VOICE_CHANNEL_ID_LABEL = "bao/voice-channel-id";
export interface VoiceKeys {
    /** x-only hex room name handed to the broker/SFU; never published. */
    voiceRoom: string;
    /** NIP-98 grant signing key for the broker. */
    voiceSignerSecret: Uint8Array;
    /** Raw 32-byte root for per-sender media keys. */
    voiceMediaKey: Uint8Array;
    /** 32-byte derived channel id (BAO-local mapping from `roomId`). */
    channelId: Uint8Array;
}
export declare function assertRoomId(roomId: string): void;
export declare function assertVoiceRoot(voiceRoot: Uint8Array): void;
export declare function assertVoiceGeneration(voiceGeneration: number): void;
/** Broker-issued opaque identity: lowercase hex, at least 16 random bytes. */
export declare function assertVoiceIdentity(identity: string): void;
export declare function serializeVoiceGeneration(voiceGeneration: number): string;
export declare function parseVoiceGeneration(hex: string): number;
/** `channelId32 = H(voiceRoot, "bao/voice-channel-id", sha256(utf8(roomId)))`. */
export declare function deriveVoiceChannelId(voiceRoot: Uint8Array, roomId: string): Uint8Array;
export declare function deriveVoiceKeys(input: {
    voiceRoot: Uint8Array;
    roomId: string;
    voiceGeneration: number;
}): VoiceKeys;
/** Per-sender media key: `H(media, "concord/voice-sender", sha256(identity))`. */
export declare function deriveSenderKey(voiceMediaKey: Uint8Array, identity: string): Uint8Array;
