/**
 * voiceLivekit — LiveKit adapter for the shared voice call controller
 * (ADR-voice-invisible-rooms v10.2). NOT exported from the package root:
 * `livekit-client` is an OPTIONAL peer, so only apps that enable voice load
 * this module (deep import `@bao/community/dist/voiceLivekit.js`).
 *
 * - E2EE is MANDATORY: a per-sender key provider (`sharedKey:false`,
 *   `keySize:256`) whose keys are installed for every SFU identity from the
 *   room-wide `voiceMediaKey` (sender_key = HKDF(media, "concord/voice-sender",
 *   sha256(identity))).
 * - Fail closed: a LOCAL encryption failure fires `onEncryptionError` so the
 *   controller tears the call down; remote key problems are tolerated.
 * - Audio-only profile, joins muted (the controller mutes right after join).
 */
import { BaseKeyProvider } from 'livekit-client';
import type { VoiceSdk, VoiceSdkJoinOptions, VoiceSdkRoom } from './voiceCall.js';
export interface LiveKitVoiceSdkOptions {
    /** Injectable for tests; defaults to the bundled E2EE worker. */
    createWorker?: () => VoiceE2EEWorker;
}
/**
 * The library compiles with Node typings (no DOM lib). This module is
 * browser-only, so its two browser globals are typed structurally here.
 */
export type VoiceE2EEWorker = {
    postMessage: (message: unknown, transfer?: unknown[]) => void;
    terminate: () => void;
};
export type VoiceImportedCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
/**
 * Playback surface (structural — this module compiles with Node typings and
 * no DOM lib). livekit-client does NOT auto-attach remote tracks: without an
 * attach() call every browser member hears SILENCE (found live 2026-10-13 —
 * only Node clients with their own audio sinks ever heard the calls).
 */
export type VoiceAudioElement = {
    style: {
        display: string;
    };
    remove: () => void;
};
export type VoiceAudioTrackLike = {
    kind: string;
    attach: () => VoiceAudioElement;
    detach: () => VoiceAudioElement[];
};
/** Per-sender key provider: one frame key per SFU identity. */
export declare class VoiceSenderKeyProvider extends BaseKeyProvider {
    constructor();
    /** CryptoKey import seam (overridden in tests). */
    protected importSenderKey(senderKey: Uint8Array): Promise<VoiceImportedCryptoKey>;
    setSenderKey(identity: string, voiceMediaKey: Uint8Array): Promise<void>;
}
export declare class LiveKitVoiceSdk implements VoiceSdk {
    private readonly options;
    constructor(options?: LiveKitVoiceSdkOptions);
    join(options: VoiceSdkJoinOptions): Promise<VoiceSdkRoom>;
}
