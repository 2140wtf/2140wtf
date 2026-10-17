/**
 * voiceToken — broker client for the blind voice broker
 * (ADR-voice-invisible-rooms v10.2). Browser-safe: no Node built-ins.
 *
 * Builds the kind-27235 grant bound to the EXACT request URL and method,
 * signs it with the room's derived voice signer, and exchanges it for a
 * short-lived LiveKit token. Fail closed: malformed responses throw.
 */
import { type Event } from 'nostr-tools';
export interface VoiceTokenGrant {
    token: string;
    /** LiveKit websocket URL. */
    url: string;
    /** Broker-issued opaque identity (lowercase hex, >=16 bytes). */
    identity: string;
}
export declare class VoiceTokenError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export declare function voiceBrokerPath(voiceRoom: string): string;
/** The binding grant event (exported for tests / broker parity checks). */
export declare function buildVoiceGrantEvent(input: {
    voiceSignerSecret: Uint8Array;
    url: string;
    method: string;
    createdAt: number;
}): Event;
export interface RequestVoiceTokenOptions {
    /** Broker origin, e.g. `https://voice.example` (no path). */
    brokerOrigin: string;
    voiceRoom: string;
    voiceSignerSecret: Uint8Array;
    fetchImpl?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
}
export declare function requestVoiceToken(options: RequestVoiceTokenOptions): Promise<VoiceTokenGrant>;
