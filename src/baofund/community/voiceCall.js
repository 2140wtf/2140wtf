/**
 * voiceCall — SDK-agnostic voice call controller (ADR-voice-invisible-rooms
 * v10.2). The LiveKit adapter is injected, E2EE is MANDATORY (`e2ee: true`),
 * the call joins MUTED, and presence is posted through the room session with
 * the `voice-presence` payload. Fail closed everywhere: a join, mute, or
 * encryption failure tears the call down and reports `failed`.
 */
import { buildVoicePresence } from './voicePresence.js';
import { deriveVoiceKeys } from './voiceKeys.js';
import { requestVoiceToken } from './voiceToken.js';
export class VoiceCallError extends Error {
    constructor(message, reason) {
        super(message);
        this.reason = reason;
        this.name = 'VoiceCallError';
    }
}
/**
 * Preflight seam (ADR-voice-invisible-rooms v10.2): derives the room keys and
 * fetches the broker token without touching an SFU, so a client can refuse to
 * join (and unit tests can force the failure path) before any media is created.
 */
export async function prepareVoiceJoin(input) {
    let keys;
    try {
        keys = deriveVoiceKeys({ voiceRoot: input.voiceRoot, roomId: input.roomId, voiceGeneration: input.voiceGeneration });
    }
    catch {
        return { ok: false, reason: 'bad_room_material' };
    }
    try {
        const grant = await requestVoiceToken({
            brokerOrigin: input.brokerOrigin,
            voiceRoom: keys.voiceRoom,
            voiceSignerSecret: keys.voiceSignerSecret,
            ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
            ...(input.now ? { now: input.now } : {}),
        });
        return { ok: true, prepared: { keys, grant } };
    }
    catch {
        return { ok: false, reason: 'broker_unavailable' };
    }
}
export class VoiceCall {
    constructor(room, input) {
        this.room = room;
        this.input = input;
        this.state = 'connecting';
        this.muted = true;
        this.heartbeatTimer = null;
        this.unsubscribers = [];
        this.leavePromise = null;
    }
    static async join(input) {
        let room = null;
        try {
            room = await input.sdk.join({
                url: input.prepared.grant.url,
                token: input.prepared.grant.token,
                e2ee: true,
                identity: input.prepared.grant.identity,
                voiceMediaKey: input.prepared.keys.voiceMediaKey,
            });
            // Join MUTED: the mic track is not published until an explicit unmute.
            await room.setMicrophoneEnabled(false);
        }
        catch {
            try {
                if (room)
                    await room.leave();
            }
            catch {
                /* best effort */
            }
            throw new VoiceCallError('voice join failed (E2EE required)', 'join_failed');
        }
        const call = new VoiceCall(room, input);
        call.setState('connected');
        await call.postPresence({ op: 'joined', muted: true, publishing: false });
        const heartbeatMs = input.heartbeatMs ?? 30_000;
        call.heartbeatTimer = setInterval(() => {
            void call.postPresence({ op: 'heartbeat', muted: call.muted, publishing: !call.muted });
        }, heartbeatMs);
        if (room.onEncryptionError) {
            call.unsubscribers.push(room.onEncryptionError(() => void call.fail()));
        }
        if (room.onParticipantsChanged) {
            call.unsubscribers.push(room.onParticipantsChanged(() => input.onParticipants?.(room.participants())));
        }
        input.onParticipants?.(room.participants());
        return call;
    }
    get currentState() {
        return this.state;
    }
    get isMuted() {
        return this.muted;
    }
    get participants() {
        return this.room.participants();
    }
    async setMuted(muted) {
        try {
            await this.room.setMicrophoneEnabled(!muted);
            this.muted = muted;
        }
        catch (err) {
            // A mid-call microphone-toggle failure (mic permission denied, no capture
            // device, or an E2EE publish error) must NOT tear down a healthy call:
            // the user still hears everyone and can retry. Keep the call connected and
            // surface the underlying reason. (A JOIN-time initial mute failure still
            // fails closed on the way in — see join().)
            throw new VoiceCallError(`microphone change failed: ${err instanceof Error ? err.message : String(err)}`, 'mute_failed');
        }
    }
    async leave() {
        if (this.leavePromise)
            return this.leavePromise;
        this.leavePromise = (async () => {
            this.stopHeartbeat();
            for (const unsubscribe of this.unsubscribers.splice(0))
                unsubscribe();
            await this.postPresence({ op: 'left' });
            try {
                await this.room.leave();
            }
            catch {
                /* already gone */
            }
            this.setState('left');
        })();
        return this.leavePromise;
    }
    async fail() {
        if (this.state === 'failed' || this.state === 'left')
            return;
        this.setState('failed');
        this.stopHeartbeat();
        for (const unsubscribe of this.unsubscribers.splice(0))
            unsubscribe();
        await this.postPresence({ op: 'left' });
        try {
            await this.room.leave();
        }
        catch {
            /* already gone */
        }
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    setState(state) {
        this.state = state;
        this.input.onState?.(state);
    }
    async postPresence(fields) {
        const payload = buildVoicePresence({
            op: fields.op,
            identity: this.input.prepared.grant.identity,
            ...(fields.muted !== undefined ? { muted: fields.muted } : {}),
            ...(fields.publishing !== undefined ? { publishing: fields.publishing } : {}),
        });
        try {
            await this.input.roomSession.post(payload);
        }
        catch {
            // Presence is advisory: a relay failure must not tear down media.
        }
    }
}
