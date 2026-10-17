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
import { BaseKeyProvider, Room, RoomEvent, Track, } from 'livekit-client';
import { deriveSenderKey } from './voiceKeys.js';
/** Per-sender key provider: one frame key per SFU identity. */
export class VoiceSenderKeyProvider extends BaseKeyProvider {
    constructor() {
        super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keySize: 256 });
    }
    /** CryptoKey import seam (overridden in tests). */
    async importSenderKey(senderKey) {
        // Copy into a plain ArrayBuffer: WebCrypto's BufferSource does not accept
        // the SharedArrayBuffer-shaped generic Uint8Array typings.
        const raw = new Uint8Array(senderKey).buffer;
        return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);
    }
    async setSenderKey(identity, voiceMediaKey) {
        const senderKey = deriveSenderKey(voiceMediaKey, identity);
        const cryptoKey = await this.importSenderKey(senderKey);
        this.onSetEncryptionKey(cryptoKey, identity);
    }
}
function createVoiceE2EEWorker() {
    return new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
}
class LiveKitVoiceRoom {
    constructor(room, setupUnsubscribers) {
        this.room = room;
        this.setupUnsubscribers = setupUnsubscribers;
        this.unsubscribers = [...setupUnsubscribers];
    }
    async setMicrophoneEnabled(enabled) {
        await this.room.localParticipant.setMicrophoneEnabled(enabled);
    }
    async leave() {
        for (const unsubscribe of this.unsubscribers.splice(0))
            unsubscribe();
        await this.room.disconnect();
    }
    participants() {
        const speaking = new Set(this.room.activeSpeakers.map((participant) => participant.identity));
        const all = [
            this.room.localParticipant,
            ...this.room.remoteParticipants.values(),
        ];
        return all.map((participant) => ({
            identity: participant.identity,
            speaking: speaking.has(participant.identity) || Boolean(participant.isSpeaking),
            muted: !participant.isMicrophoneEnabled,
        }));
    }
    onParticipantsChanged(listener) {
        const events = [
            RoomEvent.ParticipantConnected,
            RoomEvent.ParticipantDisconnected,
            RoomEvent.ActiveSpeakersChanged,
            RoomEvent.TrackMuted,
            RoomEvent.TrackUnmuted,
        ];
        const bound = events.map((event) => {
            const handler = () => listener();
            this.room.on(event, handler);
            return { event, handler };
        });
        const unsubscribe = () => {
            for (const { event, handler } of bound)
                this.room.off(event, handler);
        };
        this.unsubscribers.push(unsubscribe);
        return unsubscribe;
    }
    onEncryptionError(listener) {
        // Local failures are fatal (the controller leaves the call); remote key
        // problems must not tear down a healthy local call.
        const onEncryptionErrorEvent = (_error, participant) => {
            const isLocal = participant === undefined || participant === this.room.localParticipant;
            if (isLocal)
                listener();
        };
        const onEncryptionStatus = (isEncrypted, participant) => {
            const isLocal = participant === undefined || participant === this.room.localParticipant;
            if (isLocal && !isEncrypted)
                listener();
        };
        this.room.on(RoomEvent.EncryptionError, onEncryptionErrorEvent);
        this.room.on(RoomEvent.ParticipantEncryptionStatusChanged, onEncryptionStatus);
        const unsubscribe = () => {
            this.room.off(RoomEvent.EncryptionError, onEncryptionErrorEvent);
            this.room.off(RoomEvent.ParticipantEncryptionStatusChanged, onEncryptionStatus);
        };
        this.unsubscribers.push(unsubscribe);
        return unsubscribe;
    }
}
export class LiveKitVoiceSdk {
    constructor(options = {}) {
        this.options = options;
    }
    async join(options) {
        const provider = new VoiceSenderKeyProvider();
        const worker = (this.options.createWorker ?? createVoiceE2EEWorker)();
        const room = new Room({
            // livekit-client types the worker as a DOM `Worker`; this package
            // compiles with Node typings (structural shim above), while consumers
            // with DOM typings (bao.markets tsc gate) enforce the real interface.
            // The cast keeps BOTH compilers happy; the object is a real worker.
            e2ee: { keyProvider: provider, worker: worker },
            adaptiveStream: true,
            dynacast: true,
        });
        await room.connect(options.url, options.token);
        // Playback (browser): attach every subscribed remote AUDIO track to a
        // hidden element and remove it on unsubscribe/leave. Without this the
        // call is silent in browsers. The join click doubles as the autoplay
        // gesture, so startAudio normally succeeds immediately; a strict browser
        // defers playback until the next interaction (the element stays armed).
        const audioElements = new Set();
        const onTrackSubscribed = (...args) => {
            const track = args[0];
            if (!track || track.kind !== Track.Kind.Audio)
                return;
            const el = track.attach();
            el.style.display = 'none';
            audioElements.add(el);
            if (typeof document !== 'undefined' && document.body)
                document.body.appendChild(el);
        };
        const onTrackUnsubscribed = (...args) => {
            const track = args[0];
            for (const el of track?.detach?.() ?? []) {
                audioElements.delete(el);
                el.remove();
            }
        };
        room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
        room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
        const startAudio = room.startAudio;
        if (typeof startAudio === 'function')
            void startAudio.call(room).catch(() => { });
        // Install sender keys for every identity currently in the room, then for
        // every identity that joins later. The media key is room-wide, so every
        // member can derive every sender's key locally (no in-band key exchange).
        // Identities that are not canonical broker hex are skipped: their tracks
        // stay undecodable by design (honest-client behavior, not a throw).
        const canonicalIdentity = /^(?:[0-9a-f]{2}){16,}$/;
        const install = async (identity) => {
            if (!canonicalIdentity.test(identity))
                return;
            await provider.setSenderKey(identity, options.voiceMediaKey);
        };
        await install(room.localParticipant.identity);
        for (const participant of room.remoteParticipants.values())
            await install(participant.identity);
        const onParticipantConnected = (participant) => {
            void install(participant.identity);
        };
        room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
        // Field report 2026-10-14: "no decoded audio while RTP flows both ways",
        // and every receiver counter (jitterBufferEmittedCount, totalAudioEnergy,
        // totalSamplesDuration) read 0 — an E2EE key/decrypt mismatch, not mute.
        // That cannot be narrowed without the encryption + receiver state, so log
        // it once shortly after connect. Pure diagnostics: it never mutates the
        // call and swallows every error.
        const collectVoiceDiagnostics = async () => {
            try {
                const localParticipant = room.localParticipant;
                const remote = [];
                for (const participant of room.remoteParticipants.values()) {
                    const encrypted = participant.isEncrypted;
                    const audioTracks = [];
                    for (const pub of participant.trackPublications.values()) {
                        const track = pub.track;
                        if (!track || track.kind !== Track.Kind.Audio)
                            continue;
                        let stats = null;
                        try {
                            const report = await (track.getReceiverStats?.() ?? track.getRTCStatsReport?.());
                            stats = report?.toJSON ? report.toJSON() : report ?? null;
                        }
                        catch {
                            stats = 'stats_unavailable';
                        }
                        audioTracks.push({ subscribed: pub.isSubscribed, muted: pub.isMuted, stats });
                    }
                    remote.push({ identity: participant.identity, isEncrypted: encrypted, audioTracks });
                }
                console.info('[voice-diag]', {
                    canPlaybackAudio: room.canPlaybackAudio,
                    localIsEncrypted: localParticipant.isEncrypted,
                    remote,
                });
            }
            catch {
                /* diagnostics must never affect a call */
            }
        };
        setTimeout(() => void collectVoiceDiagnostics(), 4000);
        return new LiveKitVoiceRoom(room, [
            () => room.off(RoomEvent.ParticipantConnected, onParticipantConnected),
            () => {
                room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
                room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
                for (const el of audioElements) {
                    audioElements.delete(el);
                    el.remove();
                }
            },
        ]);
    }
}
