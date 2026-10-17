/**
 * DmPanel - minimal text-DM surface (conversation list + thread + composer).
 *
 * The panel is self-contained; the launcher/overlay chrome lives in
 * `DmEntry`. Entry points (fund app ₿AO tab, BAO chat entry) are placed by
 * the surfaces that own them - the canonical ChatPanel contract is not
 * touched.
 *
 * Guest / no-local-key states render the app's standard sign-in affordance
 * (`#bao-signin` scroll or the surface's `onSignIn`) instead of a dead
 * composer. Text only - call signaling is a later ADR phase.
 */

import React from 'react';
import { nip19 } from 'nostr-tools';
import { IDENTITY_HEX } from '../lib/activeIdentity';
import { errorMessage } from '../lib/errors';
import { useDm, type DmController } from './useDm';
import { useDmCallsOptional } from './useDmCalls';
import type { DmCallLogEntry } from './dmCallStore';

export interface DmPanelProps {
  /** Close the panel (overlay mode). */
  onClose?: () => void;
  /** Surfaces without an in-page #bao-signin block provide their own
   *  sign-in trigger (the ChatPanel convention). */
  onSignIn?: () => void;
}

/** Accept a 64-hex pubkey or an npub1… identifier; anything else is null. */
export function parsePeerInput(input: string): string | null {
  const value = input.trim();
  if (IDENTITY_HEX.test(value)) return value.toLowerCase();
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub' && IDENTITY_HEX.test(decoded.data)) return decoded.data.toLowerCase();
  } catch {
    /* not a valid npub */
  }
  return null;
}

function shortPeer(peer: string): string {
  return `${peer.slice(0, 10)}…`;
}

function formatTime(sec: number): string {
  try {
    return new Date(sec * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDuration(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
}

/** One local call-log line (no content, only outcomes - ADR §4). */
function formatCallEntry(entry: DmCallLogEntry): string {
  const direction = entry.direction === 'out' ? 'Outgoing' : 'Incoming';
  const outcome =
    entry.outcome === 'answered'
      ? `Call · ${formatDuration(entry.durationSec ?? 0)}`
      : entry.outcome === 'declined'
        ? 'Declined'
        : entry.outcome === 'busy'
          ? 'Busy'
          : entry.outcome === 'cancelled'
            ? 'Cancelled'
            : 'Missed';
  return `${direction} · ${outcome} · ${formatTime(entry.at)}`;
}

/** Composer for one thread - keyed by peer so a thread switch discards the
 *  draft and any send error (no cross-thread leakage). */
function ThreadComposer({ peer, dm }: { peer: string; dm: DmController }): React.ReactElement {
  const [draft, setDraft] = React.useState('');
  const [sendError, setSendError] = React.useState<string | null>(null);

  const submitDraft = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!draft.trim()) return;
      setSendError(null);
      try {
        await dm.send(peer, draft);
        setDraft('');
      } catch (e) {
        setSendError(errorMessage(e));
      }
    },
    [dm, draft, peer],
  );

  return (
    <>
      <form onSubmit={submitDraft} className="flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={dm.maxTextLength}
          placeholder="Type an encrypted message…"
          className="flex-1 rounded border bg-transparent px-2 py-1 text-xs"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
          data-testid="dm-composer"
        />
        <button
          type="submit"
          disabled={dm.sending || !draft.trim()}
          className="rounded border px-2 py-1 text-xs font-bold disabled:opacity-50"
          style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
          data-testid="dm-send"
        >
          Send
        </button>
      </form>
      {(sendError || dm.error) && (
        <p className="mt-2 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="dm-error">
          {sendError ?? dm.error}
        </p>
      )}
    </>
  );
}

export function DmPanel({ onClose, onSignIn }: DmPanelProps): React.ReactElement {
  const dm = useDm();
  const calls = useDmCallsOptional();
  const [newPeerInput, setNewPeerInput] = React.useState('');
  const [newPeerError, setNewPeerError] = React.useState<string | null>(null);

  const active = dm.threads.find((t) => t.peer === dm.activePeer) ?? null;

  // Call surface for the ACTIVE thread only: a status chip while a call with
  // this peer rings/connects, and the last few local call-log lines. The
  // ring CONTROLS (accept/decline/block/cancel) live in the global ring
  // banner so they also appear while this panel is closed.
  const callStatus =
    calls && calls.phase !== 'idle' && calls.peer === dm.activePeer
      ? calls.phase === 'incoming'
        ? 'Ringing you…'
        : calls.phase === 'outgoing'
          ? 'Ringing…'
          : calls.phase === 'connecting'
            ? 'Connecting…'
            : 'In call'
      : null;
  const callHistory = dm.activePeer
    ? (calls?.log ?? []).filter((entry) => entry.peer === dm.activePeer).slice(-3)
    : [];

  const signIn = React.useCallback(() => {
    if (onSignIn) onSignIn();
    else document.getElementById('bao-signin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [onSignIn]);

  const startConversation = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const peer = parsePeerInput(newPeerInput);
      if (!peer) {
        setNewPeerError('Enter a 64-hex pubkey or an npub1… identifier.');
        return;
      }
      setNewPeerError(null);
      setNewPeerInput('');
      dm.selectThread(peer);
    },
    [newPeerInput, dm],
  );

  return (
    <div
      className="mx-auto w-full max-w-3xl border p-3"
      style={{ background: 'var(--np-paper)', borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
      data-testid="dm-panel"
    >
      <div className="mb-3 flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--np-rule)' }}>
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
          Direct messages
        </span>
        <span className="flex items-center gap-2">
          {dm.access === 'ready' && (
            <span className="text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }} data-testid="dm-connection">
              {dm.connection === 'live' ? 'encrypted · relay connected' : dm.connection === 'stopped' ? '' : `relay ${dm.connection}…`}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
              data-testid="dm-close"
            >
              Close
            </button>
          )}
        </span>
      </div>

      {dm.access === 'signed-out' && (
        <div className="py-6 text-center" data-testid="dm-signin-prompt">
          <p className="mb-3 text-sm" style={{ color: 'var(--np-muted)' }}>
            Sign in to send and receive private, encrypted direct messages.
          </p>
          <button
            type="button"
            onClick={signIn}
            className="rounded px-3 py-1.5 text-xs font-bold"
            style={{ background: 'var(--np-accent)', color: 'var(--np-on-accent)', border: '1px solid var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
            data-testid="dm-signin"
          >
            Sign in
          </button>
        </div>
      )}

      {dm.access === 'no-local-key' && (
        <div className="py-6 text-center" data-testid="dm-no-key">
          <p className="mb-2 text-sm" style={{ color: 'var(--np-ink)' }}>
            Direct messages are not available for this sign-in method.
          </p>
          <p className="text-xs" style={{ color: 'var(--np-muted)' }}>
            {dm.accessDetail ?? 'Encrypted DMs need a seed-phrase identity this browser can hold.'} To use DMs, sign out and sign in with your seed phrase (or unlock your seed session).
          </p>
        </div>
      )}

      {dm.access === 'ready' && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          {/* Conversations */}
          <div className="border-r pr-2" style={{ borderColor: 'var(--np-rule)' }}>
            <form onSubmit={startConversation} className="mb-2">
              <label className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                New message
              </label>
              <input
                value={newPeerInput}
                onChange={(e) => setNewPeerInput(e.target.value)}
                placeholder="npub1… or 64-hex"
                className="mb-1 w-full rounded border bg-transparent px-2 py-1 text-xs"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)' }}
                data-testid="dm-new-peer"
              />
              <button
                type="submit"
                className="w-full rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
                style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
                data-testid="dm-new-peer-open"
              >
                Open
              </button>
              {newPeerError && (
                <p className="mt-1 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="dm-new-peer-error">
                  {newPeerError}
                </p>
              )}
            </form>
            {dm.threads.length === 0 ? (
              <p className="text-[10px]" style={{ color: 'var(--np-muted)' }} data-testid="dm-empty">
                No conversations yet.
              </p>
            ) : (
              <div className="space-y-1" data-testid="dm-conversations">
                {dm.threads.map((thread) => {
                  const last = thread.messages[thread.messages.length - 1];
                  return (
                    <button
                      key={thread.peer}
                      type="button"
                      onClick={() => dm.selectThread(thread.peer)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                        dm.activePeer === thread.peer ? 'bg-[var(--np-accent)]/10' : 'hover:bg-black/5'
                      }`}
                      data-testid={`dm-conversation-${thread.peer}`}
                    >
                      <span className="flex-1 truncate" style={{ fontFamily: 'var(--np-font-mono)' }} title={thread.peer}>
                        {shortPeer(thread.peer)}
                      </span>
                      {thread.unread > 0 && (
                        <span className="rounded-full px-1.5 text-[10px] font-bold" style={{ background: 'var(--np-danger, #b3261e)', color: '#fff' }} data-testid={`dm-unread-${thread.peer}`}>
                          {thread.unread}
                        </span>
                      )}
                      <span className="hidden truncate text-[10px] sm:inline" style={{ color: 'var(--np-muted)', maxWidth: 60 }}>
                        {last.direction === 'out' ? 'You: ' : ''}
                        {last.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Thread + composer */}
          <div className="flex min-h-[280px] flex-col">
            {!dm.activePeer ? (
              <p className="m-auto text-xs" style={{ color: 'var(--np-muted)' }}>
                Select a conversation or open a new one by pubkey.
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2 border-b pb-1" style={{ borderColor: 'var(--np-rule)' }}>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }} title={dm.activePeer}>
                    {shortPeer(dm.activePeer)}
                  </span>
                  <span className="flex items-center gap-2">
                    {callStatus && (
                      <span className="text-[10px]" style={{ color: 'var(--np-accent-2)', fontFamily: 'var(--np-font-mono)' }} data-testid="dm-call-status">
                        {callStatus}
                      </span>
                    )}
                    {calls?.access === 'ready' && (
                      <button
                        type="button"
                        onClick={() => void calls.startCall(dm.activePeer as string)}
                        className="rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                        style={{ borderColor: 'var(--np-rule)', color: 'var(--np-ink)', fontFamily: 'var(--np-font-mono)' }}
                        data-testid="dm-call"
                        title="Start an encrypted DM call (both sides must enable calls)"
                      >
                        Call
                      </button>
                    )}
                  </span>
                </div>
                {calls && calls.error && (
                  <p className="mb-1 text-[10px]" style={{ color: 'var(--np-error, #b91c1c)' }} data-testid="dm-call-error">
                    {calls.error}{' '}
                    <button type="button" onClick={calls.clearError} className="underline" style={{ color: 'var(--np-muted)' }}>
                      dismiss
                    </button>
                  </p>
                )}
                {callHistory.length > 0 && (
                  <div className="mb-1 space-y-0.5" data-testid="dm-call-log">
                    {callHistory.map((entry, index) => (
                      <p key={`${entry.at}-${index}`} className="text-[10px]" style={{ color: 'var(--np-muted)', fontFamily: 'var(--np-font-mono)' }}>
                        {formatCallEntry(entry)}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mb-2 flex-1 space-y-2 overflow-y-auto" style={{ maxHeight: 320 }} data-testid="dm-thread">
                  {(active?.messages ?? []).length === 0 ? (
                    <p className="text-[10px]" style={{ color: 'var(--np-muted)' }}>
                      No messages yet - write the first one.
                    </p>
                  ) : (
                    active?.messages.map((message) => (
                      <div key={message.id} className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[85%] rounded border px-2 py-1 text-xs"
                          style={{ borderColor: 'var(--np-rule)', background: message.direction === 'out' ? 'color-mix(in srgb, var(--np-accent) 10%, transparent)' : 'transparent' }}
                          data-testid={`dm-message-${message.direction}`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.text}</p>
                          <p className="mt-0.5 text-right text-[9px]" style={{ color: 'var(--np-muted)' }}>
                            {message.direction === 'out' ? 'You · ' : ''}
                            {formatTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <ThreadComposer key={dm.activePeer} peer={dm.activePeer} dm={dm} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
