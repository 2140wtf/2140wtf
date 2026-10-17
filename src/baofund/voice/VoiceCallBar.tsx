/**
 * VoiceCallBar — the in-chat voice call surface (ADR-voice-invisible-rooms
 * v10.2 §6). Mobile-first: a compact wrapping bar under the room title that
 * never displaces the text chat; text+icon states (never color-only); ARIA
 * labels + a polite live region; `M` toggles the mic while the bar has focus.
 * No captions in the pilot - stated in the accessible description.
 */
import * as React from 'react';
import { Lock, Mic, MicOff, Phone, PhoneOff, X } from 'lucide-react';
import type { VoicePresence } from '@/baofund/community/voicePresence.js';
import { useVoiceCall, type VoiceMaterial } from './useVoiceCall';
import type { VoiceSdk } from './call';

export interface VoiceCallBarProps {
  roomId: string;
  material: VoiceMaterial;
  postPresence: (roomId: string, payload: unknown) => Promise<boolean>;
  subscribePresence: (roomId: string, listener: (presence: VoicePresence) => void) => () => void;
  brokerOrigin?: string;
  /** Test seam; defaults to the LiveKit adapter. */
  sdk?: VoiceSdk;
  heartbeatMs?: number;
  /** Operator affordance (admins): remove a participant from the call. */
  canModerate?: boolean;
  onKickParticipant?: (identity: string) => void;
}

export function VoiceCallBar({
  roomId,
  material,
  postPresence,
  subscribePresence,
  brokerOrigin,
  sdk,
  heartbeatMs,
  canModerate = false,
  onKickParticipant,
}: VoiceCallBarProps): React.ReactElement {
  const call = useVoiceCall({
    roomId,
    material,
    postPresence,
    subscribePresence,
    ...(brokerOrigin ? { brokerOrigin } : {}),
    ...(sdk ? { sdk } : {}),
    ...(heartbeatMs ? { heartbeatMs } : {}),
  });
  const connected = call.phase === 'connected';

  return (
    <div
      role="group"
      aria-label="Voice call"
      data-testid="voice-call-bar"
      onKeyDown={(event) => {
        if (connected && (event.key === 'm' || event.key === 'M') && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          void call.toggleMute();
        }
      }}
      className="mt-1 flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-[11px]"
      style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
    >
      {!connected ? (
        <>
          <button
            type="button"
            data-testid="voice-join"
            onClick={() => void call.join()}
            disabled={call.phase === 'connecting'}
            aria-label={call.presenceCount > 0 ? `Join voice call, ${call.presenceCount} already in call` : 'Join voice call'}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5"
            style={{ border: '1px solid var(--np-rule)', color: 'var(--np-ink)' }}
            title="Join the room's private voice call (E2EE, you join muted)"
          >
            <Phone size={12} />
            {call.phase === 'connecting'
              ? 'Joining…'
              : call.presenceCount > 0
                ? `Join voice · ${call.presenceCount}`
                : 'Join voice'}
          </button>
          <span
            data-testid="voice-browser-note"
            className="text-[10px]"
            style={{ color: 'var(--np-muted)' }}
          >
            Needs microphone access. Brave&apos;s Shields can block voice — allow mic/call access for
            this site, or use Firefox.
          </span>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1" style={{ color: 'var(--np-accent-2)' }} aria-live="polite">
            <Lock size={11} />
            private · E2EE · {call.participants.length} in call
          </span>
          <button
            type="button"
            data-testid="voice-mute"
            aria-pressed={call.muted}
            aria-label={call.muted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
            onClick={() => void call.toggleMute()}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5"
            style={{ border: '1px solid var(--np-rule)', color: call.muted ? 'var(--np-muted)' : 'var(--np-accent)' }}
          >
            {call.muted ? <MicOff size={12} /> : <Mic size={12} />}
            {call.muted ? 'Muted' : 'Live'}
          </button>
          <button
            type="button"
            data-testid="voice-leave"
            aria-label="Leave voice call"
            onClick={() => void call.leave()}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5"
            style={{ border: '1px solid var(--np-rule)', color: 'var(--np-danger, #b3261e)' }}
          >
            <PhoneOff size={12} />
            Leave
          </button>
          <ul className="flex flex-wrap items-center gap-1" aria-label="Participants">
            {call.participants.map((participant) => (
              <li
                key={participant.identity}
                className="inline-flex items-center gap-1 rounded px-1"
                style={{
                  border: `1px solid ${participant.speaking ? 'var(--np-accent)' : 'var(--np-rule)'}`,
                  color: 'var(--np-muted)',
                }}
                title={participant.muted ? 'Microphone muted (self-reported)' : 'Microphone live'}
              >
                {participant.identity.slice(0, 6)}
                {participant.muted ? ' · muted' : ''}
                {canModerate && onKickParticipant && (
                  <button
                    type="button"
                    onClick={() => onKickParticipant(participant.identity)}
                    style={{ color: 'var(--np-danger, #b3261e)' }}
                    title="Remove from this call (room creator or BAO admin only)"
                    aria-label={`Remove ${participant.identity.slice(0, 6)} from the call`}
                  >
                    <X size={9} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <span className="sr-only">Captions or transcripts are not available in the pilot.</span>
        </>
      )}
      {call.error && (
        <span role="alert" className="text-[10px]" style={{ color: 'var(--np-danger, #b3261e)' }}>
          {call.error}{' '}
          <span style={{ color: 'var(--np-muted)' }}>
            If this persists on Brave or Chrome, allow microphone &amp; autoplay for this site, or use
            Firefox.
          </span>
        </span>
      )}
    </div>
  );
}
