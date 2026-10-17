/**
 * DmCallRings - the ring surface for DM calls (ADR-dm-calls §3-4).
 *
 * One component, rendered in two places:
 *   - globally by `DmCallProvider` (fixed bottom banner) so a ring surfaces
 *     on EVERY tab, not only while the DM panel is open;
 *   - never duplicated inside DmPanel - the panel shows a status chip + the
 *     Call button + the local call log instead.
 *
 * States: incoming ring (Accept / Decline / Block), outgoing ring (Cancel),
 * connecting (the SFU token mint + E2EE join, phase 4), and the answered
 * session (mic mute/unmute + participant count + Hang up). Busy/declined/
 * missed appear in the local call log.
 *
 * Buttons are text+icon (never color-only), the container is a polite
 * alertdialog, and no keys or content are ever rendered or logged.
 */

import React from 'react';
import { Mic, MicOff, Phone, PhoneOff, ShieldOff, X } from 'lucide-react';
import type { DmCallsController } from './useDmCalls';

export interface DmCallRingsProps {
  calls: DmCallsController;
  /** 'overlay' is the fixed global banner; 'inline' fits inside a panel. */
  variant?: 'overlay' | 'inline';
}

function shortPeer(peer: string | null): string {
  return peer ? `${peer.slice(0, 10)}…` : '';
}

function formatElapsed(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function DmCallRings({ calls, variant = 'overlay' }: DmCallRingsProps): React.ReactElement | null {
  const { phase, since, answeredAt } = calls;

  // 1 s tick while a call state is active (elapsed counters stay honest).
  const [tick, setTick] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    if (phase === 'idle') return undefined;
    const timer = setInterval(() => setTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Idle with no error = nothing. Idle WITH an error keeps a compact banner
  // so a failed accept/answer is visible even after the ringing state ended.
  if (phase === 'idle' && !calls.error) return null;
  const ringing = phase === 'outgoing' || phase === 'incoming';
  const elapsed = ringing ? (since !== null ? tick - since : 0) : answeredAt !== null ? tick - answeredAt : 0;

  const wrapClass =
    variant === 'overlay'
      ? 'fixed inset-x-0 bottom-4 z-[90] mx-auto w-full max-w-md px-4'
      : 'mt-1 w-full';

  return (
    <div className={wrapClass} data-testid={`dmcall-${variant}`}>
      <div
        role="alertdialog"
        aria-label={phase === 'incoming' ? 'Incoming call' : phase === 'outgoing' ? 'Outgoing call' : 'Call in progress'}
        className="rounded border p-3 shadow-lg"
        style={{ background: 'var(--np-paper, #fff)', borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
      >
        {phase !== 'idle' && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-bold" style={{ fontFamily: 'var(--np-font-mono)' }}>
            <Phone size={13} />
            {phase === 'incoming' && (
              <span data-testid="dmcall-incoming-label">Incoming call from {shortPeer(calls.peer)}</span>
            )}
            {phase === 'outgoing' && (
              <span data-testid="dmcall-outgoing-label">Ringing {shortPeer(calls.peer)} · {formatElapsed(elapsed)}</span>
            )}
            {phase === 'connecting' && (
              <span data-testid="dmcall-connecting-label">Connecting to {shortPeer(calls.peer)}…</span>
            )}
            {phase === 'in-call' && (
              <span data-testid="dmcall-active-label">In call with {shortPeer(calls.peer)} · {formatElapsed(elapsed)}</span>
            )}
          </span>
          {phase === 'in-call' && calls.role === 'callee' && (
            <span className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
              Answered
            </span>
          )}
        </div>
        )}

        {phase === 'connecting' && (
          <p className="mb-2 text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }} data-testid="dmcall-media-note">
            Securing the call… (encrypted media, E2EE is mandatory).
          </p>
        )}
        {phase === 'in-call' && (
          <p className="mb-2 text-[10px] leading-relaxed" style={{ color: 'var(--np-muted)' }} data-testid="dmcall-media-note">
            {calls.media === 'live'
              ? `Encrypted voice · E2EE · ${calls.participantCount} in call`
              : 'Call connected (signaling only on this host).'}
          </p>
        )}

        {calls.error && (
          <p className="mb-2 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="dmcall-error">
            {calls.error}{' '}
            <button type="button" onClick={calls.clearError} className="underline" style={{ color: 'var(--np-muted)' }}>
              dismiss
            </button>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {phase === 'incoming' && (
            <>
              <button
                type="button"
                data-testid="dmcall-accept"
                onClick={() => void calls.accept()}
                className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs font-bold"
                style={{ background: 'var(--np-accent)', color: 'var(--np-on-accent)', border: '1px solid var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
              >
                <Phone size={12} />
                Accept
              </button>
              <button
                type="button"
                data-testid="dmcall-decline"
                onClick={calls.decline}
                className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs"
                style={{ border: '1px solid var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
              >
                <PhoneOff size={12} />
                Decline
              </button>
              <button
                type="button"
                data-testid="dmcall-block"
                onClick={calls.blockAndDecline}
                className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs"
                style={{ border: '1px solid var(--np-rule)', color: 'var(--np-danger, #b3261e)', fontFamily: 'var(--np-font-mono)' }}
                title="Decline and block this caller"
              >
                <ShieldOff size={12} />
                Block
              </button>
            </>
          )}
          {phase === 'outgoing' && (
            <button
              type="button"
              data-testid="dmcall-cancel"
              onClick={calls.cancel}
              className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs"
              style={{ border: '1px solid var(--np-rule)', color: 'var(--np-danger, #b3261e)', fontFamily: 'var(--np-font-mono)' }}
            >
              <X size={12} />
              Cancel
            </button>
          )}
          {phase === 'in-call' && calls.media === 'live' && (
            <button
              type="button"
              data-testid="dmcall-mute"
              aria-pressed={calls.muted}
              aria-label={calls.muted ? 'Unmute microphone' : 'Mute microphone'}
              onClick={() => void calls.toggleMute()}
              className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs"
              style={{
                border: '1px solid var(--np-rule)',
                color: calls.muted ? 'var(--np-muted)' : 'var(--np-accent)',
                fontFamily: 'var(--np-font-mono)',
              }}
            >
              {calls.muted ? <MicOff size={12} /> : <Mic size={12} />}
              {calls.muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          {(phase === 'in-call' || phase === 'connecting') && (
            <button
              type="button"
              data-testid="dmcall-hangup"
              onClick={calls.hangup}
              className="inline-flex items-center gap-1 rounded px-3 py-1 text-xs"
              style={{ border: '1px solid var(--np-rule)', color: 'var(--np-danger, #b3261e)', fontFamily: 'var(--np-font-mono)' }}
            >
              <PhoneOff size={12} />
              Hang up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
