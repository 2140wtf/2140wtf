import { type VoiceKeys } from './voiceKeys.js';
import { type VoiceTokenGrant } from './voiceToken.js';
export interface VoiceSdkJoinOptions {
    url: string;
    token: string;
    /** E2EE is never optional. */
    e2ee: true;
    identity: string;
    /** Room-wide media root used by the adapter to install per-sender keys. */
    voiceMediaKey: Uint8Array;
}
export interface VoiceParticipant {
    identity: string;
    speaking: boolean;
    muted: boolean;
}
export interface VoiceSdkRoom {
    setMicrophoneEnabled(enabled: boolean): Promise<void>;
    leave(): Promise<void>;
    participants(): VoiceParticipant[];
    onParticipantsChanged?(listener: () => void): () => void;
    /** Fired when frame encryption stops working mid-call (local failure). */
    onEncryptionError?(listener: () => void): () => void;
}
export interface VoiceSdk {
    join(options: VoiceSdkJoinOptions): Promise<VoiceSdkRoom>;
}
/** The minimum of RoomSession this module needs (posting presence). */
export interface VoiceRoomSessionLike {
    post(payload: unknown): Promise<unknown>;
}
export type VoiceCallState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'left';
export declare class VoiceCallError extends Error {
    readonly reason: string;
    constructor(message: string, reason: string);
}
export interface PrepareVoiceJoinInput {
    voiceRoot: Uint8Array;
    roomId: string;
    voiceGeneration: number;
    brokerOrigin: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
}
export interface PreparedVoiceJoin {
    keys: VoiceKeys;
    grant: VoiceTokenGrant;
}
export type PrepareVoiceJoinResult = {
    ok: true;
    prepared: PreparedVoiceJoin;
} | {
    ok: false;
    reason: 'bad_room_material' | 'broker_unavailable';
};
/**
 * Preflight seam (ADR-voice-invisible-rooms v10.2): derives the room keys and
 * fetches the broker token without touching an SFU, so a client can refuse to
 * join (and unit tests can force the failure path) before any media is created.
 */
export declare function prepareVoiceJoin(input: PrepareVoiceJoinInput): Promise<PrepareVoiceJoinResult>;
export interface JoinVoiceCallInput {
    prepared: PreparedVoiceJoin;
    sdk: VoiceSdk;
    roomSession: VoiceRoomSessionLike;
    heartbeatMs?: number;
    onState?: (state: VoiceCallState) => void;
    onParticipants?: (participants: VoiceParticipant[]) => void;
}
export declare class VoiceCall {
    private readonly room;
    private readonly input;
    private state;
    private muted;
    private heartbeatTimer;
    private readonly unsubscribers;
    private leavePromise;
    private constructor();
    static join(input: JoinVoiceCallInput): Promise<VoiceCall>;
    get currentState(): VoiceCallState;
    get isMuted(): boolean;
    get participants(): VoiceParticipant[];
    setMuted(muted: boolean): Promise<void>;
    leave(): Promise<void>;
    private fail;
    private stopHeartbeat;
    private setState;
    private postPresence;
}
