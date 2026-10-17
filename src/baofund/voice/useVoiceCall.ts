/**
 * useVoiceCall — React binding for the voice core (ADR-voice-invisible-rooms
 * v10.2). The framework-free core lives in `./call`; this hook owns state,
 * the presence hint count, and lifecycle. Every failure is fail-closed:
 * phase 'failed' plus a human-readable message, never a half-joined call.
 */
import * as React from 'react';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { VoicePresence } from '@/baofund/community/voicePresence.js';
import { prepareVoiceJoin, VoiceCall, type VoiceParticipant, type VoiceSdk } from './call';

const PRESENCE_STALE_MS = 90_000;
let defaultSdk: VoiceSdk | null = null;

export interface VoiceMaterial {
  voiceRoot: string;
  voiceGeneration: number;
}

export interface UseVoiceCallOptions {
  roomId: string;
  material: VoiceMaterial;
  /** Broker origin; falls back to VITE_VOICE_BROKER_URL. No default by design. */
  brokerOrigin?: string;
  postPresence: (roomId: string, payload: unknown) => Promise<boolean>;
  subscribePresence: (roomId: string, listener: (presence: VoicePresence) => void) => () => void;
  /** Test seam; defaults to the LiveKit adapter. */
  sdk?: VoiceSdk;
  heartbeatMs?: number;
}

export type VoiceCallPhase = 'idle' | 'connecting' | 'connected' | 'failed' | 'left';

export interface UseVoiceCallResult {
  phase: VoiceCallPhase;
  error: string | null;
  participants: VoiceParticipant[];
  muted: boolean;
  /** Fresh presence identities other than this client (call-activity hint). */
  presenceCount: number;
  join(): Promise<void>;
  toggleMute(): Promise<void>;
  leave(): Promise<void>;
}

export function useVoiceCall(options: UseVoiceCallOptions): UseVoiceCallResult {
  const { roomId, material, postPresence, subscribePresence, sdk, heartbeatMs } = options;
  const brokerOrigin = options.brokerOrigin ?? (import.meta.env as Record<string, string | undefined>).VITE_VOICE_BROKER_URL;
  const [phase, setPhase] = React.useState<VoiceCallPhase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [participants, setParticipants] = React.useState<VoiceParticipant[]>([]);
  const [muted, setMuted] = React.useState(true);
  const [presenceState, setPresenceState] = React.useState<{ roomId: string; count: number }>({ roomId, count: 0 });
  const callRef = React.useRef<VoiceCall | null>(null);
  const presenceSeenRef = React.useRef(new Map<string, number>());

  // Presence hint: who else is (freshly) in the call before we join. Fed by
  // the hook's SINGLE room subscription — no extra REQ, no extra socket.
  // The count is room-keyed so a room switch never shows a stale hint.
  React.useEffect(() => {
    presenceSeenRef.current.clear();
    return subscribePresence(roomId, (presence) => {
      const seen = presenceSeenRef.current;
      if (presence.op === 'left') {
        seen.delete(presence.identity);
      } else {
        seen.set(presence.identity, Date.now());
      }
      const cutoff = Date.now() - PRESENCE_STALE_MS;
      let fresh = 0;
      for (const [identity, at] of seen) {
        if (at < cutoff) seen.delete(identity);
        else fresh += 1;
      }
      setPresenceState({ roomId, count: fresh });
    });
  }, [roomId, subscribePresence]);
  const presenceCount = presenceState.roomId === roomId ? presenceState.count : 0;

  React.useEffect(
    () => () => {
      void callRef.current?.leave();
    },
    [],
  );

  const join = React.useCallback(async () => {
    if (callRef.current) return;
    if (!brokerOrigin) {
      setPhase('failed');
      setError('Voice is not configured on this host.');
      return;
    }
    setPhase('connecting');
    setError(null);
    try {
      const prepared = await prepareVoiceJoin({
        voiceRoot: hexToBytes(material.voiceRoot),
        roomId,
        voiceGeneration: material.voiceGeneration,
        brokerOrigin,
      });
      if (!prepared.ok) {
        setPhase('failed');
        setError(prepared.reason === 'bad_room_material' ? 'This room has no usable voice capability.' : 'Voice service is unavailable.');
        return;
      }
      // Lazy SDK import (ADR v10.2): livekit-client is loaded ONLY when
      // a voice-enabled room actually joins — never for text-only sessions.
      let activeSdk = sdk;
      if (!activeSdk) {
        const { LiveKitVoiceSdk } = await import('./livekitAdapter');
        defaultSdk ??= new LiveKitVoiceSdk();
        activeSdk = defaultSdk;
      }
      const call = await VoiceCall.join({
        prepared: prepared.prepared,
        sdk: activeSdk,
        roomSession: { post: (payload) => postPresence(roomId, payload) },
        ...(heartbeatMs ? { heartbeatMs } : {}),
        onState: (state) => setPhase(state === 'reconnecting' ? 'connected' : state),
        onParticipants: (next) => setParticipants(next),
      });
      callRef.current = call;
      setMuted(call.isMuted);
    } catch {
      setPhase('failed');
      setError('Could not join the call (E2EE required).');
    }
  }, [brokerOrigin, material.voiceRoot, material.voiceGeneration, roomId, sdk, heartbeatMs, postPresence]);

  const toggleMute = React.useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    try {
      await call.setMuted(!call.isMuted);
      setMuted(call.isMuted);
    } catch (err) {
      // A microphone-toggle failure is recoverable: the call stays connected
      // (you keep hearing everyone) so do NOT flip the phase to failed. Surface
      // the underlying reason (permission denied / no capture device / E2EE).
      setError(err instanceof Error ? err.message : 'Microphone change failed.');
    }
  }, []);

  const leave = React.useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    if (!call) return;
    await call.leave();
    setPhase('left');
    setParticipants([]);
  }, []);

  return { phase, error, participants, muted, presenceCount, join, toggleMute, leave };
}
