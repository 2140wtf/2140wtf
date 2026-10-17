export declare const VOICE_PRESENCE_TYPE = "voice-presence";
export declare const VOICE_PRESENCE_OPS: readonly ["joined", "left", "heartbeat"];
export type VoicePresenceOp = (typeof VOICE_PRESENCE_OPS)[number];
export interface VoicePresence {
    v: 1;
    type: typeof VOICE_PRESENCE_TYPE;
    op: VoicePresenceOp;
    identity: string;
    ms: number;
    hand?: boolean;
    muted?: boolean;
    publishing?: boolean;
}
export interface VoicePresenceInput {
    op: VoicePresenceOp;
    identity: string;
    /** Defaults to Date.now(); pass explicitly in tests. */
    ms?: number;
    hand?: boolean;
    muted?: boolean;
    publishing?: boolean;
}
/** Build a voice-presence payload (encrypted in-envelope). Strict on input. */
export declare function buildVoicePresence(input: VoicePresenceInput): Record<string, unknown>;
/** Parse a voice-presence payload, or null when the payload is not one. */
export declare function parseVoicePresence(payload: unknown): VoicePresence | null;
