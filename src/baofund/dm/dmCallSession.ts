/**
 * dmCallSession - the framework-free DM call state machine (ADR-dm-calls §3-4).
 *
 * One instance per signed-in identity. It owns the call lifecycle:
 *
 *   idle -> outgoing (ringing)  -> in-call -> idle
 *   idle -> incoming (ringing)  -> in-call -> idle
 *
 * Signaling rides the DM lane (`buildDmWrap` payloads, see dmCallLane.ts).
 * The session NEVER logs payload content and NEVER touches the text-DM store
 * for signals. All sends are best-effort EXCEPT the offer and the accept: a
 * failed offer aborts the call (no ringing that never left), a failed accept
 * aborts the answer (the caller's own 30 s timeout is the fallback).
 *
 * Multi-device (ADR §4): accept/decline/end are ALSO wrapped to the sender's
 * own pubkey (`p = me`), so the sender's other devices cancel their ring UI.
 * Self-copies this device published itself are recognised by wrap id and
 * ignored (the relay loops them back); copies from another device cancel the
 * local session quietly (the acting device owns the log entry).
 *
 * Callee authority: incoming offers are evaluated in the ADR's exact order
 * (`evaluateIncomingOffer` in dmCallGuard.ts). A refused offer produces NO
 * response at all (indistinguishable from offline). `busy` is sent only when
 * the offer passed every policy gate and this device is already in a call.
 *
 * Ring timeout is 30 s on both sides. On the callee side the timeout is a
 * 'missed' log entry; with the opt-in `missedNotice` setting it also sends a
 * plain text DM ("Missed call") - documented as weakening the
 * allowed-timeout/silent-drop indistinguishability. A call answered and ended
 * in under 5 s counts as an explicit decline (cool-down escalation); an
 * answered call of >= 5 s resets the counter.
 *
 * Media (ADR phase 4): when a `mediaJoin` dep is provided, an answered call
 * passes through the 'connecting' phase while the SFU token is minted for
 * the derived call room and the E2EE media stack joins (see dmCallMedia.ts).
 * A media failure ENDS the call (fail closed - no silent half-joined state).
 * The client watchdog ends the call on a 3rd participant, a local encryption
 * failure, or the max-duration bound. Without `mediaJoin` the session keeps
 * the signaling-only behavior (used by tests and headless contexts).
 */

import {
  deriveDmCallSecrets,
  newDmCallEphemeral,
  newDmCallOffer,
  type DmCallOfferKeys,
  type DmCallSecrets,
} from '@/baofund/community/dmCallKeys.js';
import { isCallSignalExpired, newCallId, parseCallSignal, type DmCallSignal } from '@/baofund/community/dmSignaling.js';
import { IDENTITY_HEX } from '../lib/activeIdentity';
import {
  buildDmCallAcceptPayload,
  buildDmCallOfferPayload,
  buildDmCallPayload,
  readDmCallExtras,
  type DmCallEnvelopeExtras,
} from './dmCallLane';
import {
  DM_CALL_ANSWER_DECLINE_SEC,
  DM_CALL_RING_TIMEOUT_SEC,
  checkOutgoingAllowance,
  evaluateIncomingOffer,
  recordDecline,
  recordIncomingOffer,
  recordOutgoingOffer,
  resetDeclines,
  type DmCallGuardState,
} from './dmCallGuard';
import type { DmCallMediaHandle, DmCallMediaJoin } from './dmCallMedia';
import { DM_CALL_MEDIA_MAX_DURATION_SEC, DM_CALL_MEDIA_MAX_PARTICIPANTS } from './dmCallMedia';
import type { DmCallLogEntry, DmCallPolicy } from './dmCallStore';

export type DmCallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'in-call';

export type DmCallRole = 'caller' | 'callee';

/** Media state for the UI: off = signaling only, connecting = SFU join in
 *  flight, live = E2EE media connected. */
export type DmCallMediaState = 'off' | 'connecting' | 'live';

export interface DmCallSessionSnapshot {
  phase: DmCallPhase;
  /** Counterparty pubkey while a call state is active. */
  peer: string | null;
  callId: string | null;
  /** Ring start (or connect time) in unix seconds. */
  since: number | null;
  /** Answer time (null while ringing). */
  answeredAt: number | null;
  role: DmCallRole | null;
  error: string | null;
  /** Media state (phase 4; 'off' in signaling-only contexts). */
  media: DmCallMediaState;
  /** Microphone mute state while media is live (calls join muted). */
  muted: boolean;
  /** Total participants incl. this client while media is live. */
  participantCount: number;
}

const IDLE_SNAPSHOT: DmCallSessionSnapshot = {
  phase: 'idle',
  peer: null,
  callId: null,
  since: null,
  answeredAt: null,
  role: null,
  error: null,
  media: 'off',
  muted: true,
  participantCount: 0,
};

interface ActiveState {
  phase: 'outgoing' | 'incoming' | 'connecting' | 'in-call';
  role: DmCallRole;
  peer: string;
  callId: string;
  rn: string;
  since: number;
  answeredAt: number | null;
}

export interface DmCallSessionDeps {
  /** Own identity pubkey (lowercase 64-hex). */
  me: string;
  now: () => number;
  /** Publish one lane payload to `peer`; resolves with the wrap id. */
  send: (peer: string, payload: unknown) => Promise<string>;
  /** Current per-identity policy (re-read at evaluation time). */
  getPolicy: () => DmCallPolicy;
  isBlocked: (peer: string) => boolean;
  addBlock: (peer: string) => void;
  /** Follows oracle for whoMayRing follows/mutuals. Fail-closed default when
   *  the host app has no follows graph: `{followed:false, mutual:false}`. */
  follows: (peer: string) => { followed: boolean; mutual: boolean };
  /** Budget/cool-down state persistence (dmCallGuard). */
  loadGuard: () => DmCallGuardState;
  saveGuard: (state: DmCallGuardState) => void;
  /** Local call log append (dmCallStore). */
  appendLog: (entry: DmCallLogEntry) => void;
  /** Inbound wrap-id dedupe (persisted). */
  seenHas: (wrapId: string) => boolean;
  seenAdd: (wrapId: string) => void;
  /** Opt-in missed-call notice (plain text DM). */
  sendNotice: (peer: string, text: string) => Promise<void>;
  /** Phase-4 media seam: mint the SFU token for the derived call room and
   *  join the E2EE media stack (dmCallMedia.ts). Absent = signaling-only. */
  mediaJoin?: DmCallMediaJoin;
  /** Timer seam (tests inject; defaults to globalThis). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class DmCallSession {
  private active: ActiveState | null = null;
  private error: string | null = null;
  private offering: DmCallOfferKeys | null = null;
  private incoming: { callerEpk: string; nonce: string } | null = null;
  private secrets: DmCallSecrets | null = null;
  private ringTimer: unknown = null;
  private media: DmCallMediaHandle | null = null;
  private mediaTimer: unknown = null;
  private mediaUnsubscribers: Array<() => void> = [];
  private muted = true;
  private participantCount = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: DmCallSessionSnapshot = IDLE_SNAPSHOT;
  private readonly ownCopyIds = new Set<string>();

  constructor(private readonly deps: DmCallSessionDeps) {}

  // ─── Snapshot / subscription (useSyncExternalStore) ───────────────────────

  getSnapshot = (): DmCallSessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(): void {
    const a = this.active;
    const media: DmCallMediaState =
      a && a.phase === 'connecting' ? 'connecting' : a && this.media && a.phase === 'in-call' ? 'live' : 'off';
    this.snapshot = a
      ? {
          phase: a.phase,
          peer: a.peer,
          callId: a.callId,
          since: a.since,
          answeredAt: a.answeredAt,
          role: a.role,
          error: this.error,
          media,
          muted: this.muted,
          participantCount: this.participantCount,
        }
      : { ...IDLE_SNAPSHOT, error: this.error };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a broken listener must never break the session */
      }
    }
  }

  /** Derived per-call secrets once connected (the phase-4 media seam).
   *  Never expose to logs; intentionally not part of the UI snapshot. */
  getCallSecrets(): DmCallSecrets | null {
    return this.secrets;
  }

  clearError(): void {
    if (this.error === null) return;
    this.error = null;
    this.publish();
  }

  private setError(message: string): void {
    this.error = message;
  }

  // ─── Timers ───────────────────────────────────────────────────────────────

  private startRingTimer(onTimeout: () => void): void {
    const setTimer = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.clearRingTimer();
    this.ringTimer = setTimer(onTimeout, DM_CALL_RING_TIMEOUT_SEC * 1000);
  }

  private clearRingTimer(): void {
    if (this.ringTimer === null) return;
    const clearTimer = this.deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    clearTimer(this.ringTimer);
    this.ringTimer = null;
  }

  /** Media watchdog timer (max call duration). */
  private startMediaTimer(onTimeout: () => void): void {
    const setTimer = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.clearMediaTimer();
    this.mediaTimer = setTimer(onTimeout, DM_CALL_MEDIA_MAX_DURATION_SEC * 1000);
  }

  private clearMediaTimer(): void {
    if (this.mediaTimer === null) return;
    const clearTimer = this.deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    clearTimer(this.mediaTimer);
    this.mediaTimer = null;
  }

  // ─── Signals out (best effort except offer/accept) ────────────────────────

  private signalPayload(op: 'decline' | 'busy' | 'end', callId: string, rn: string): Record<string, unknown> {
    return buildDmCallPayload({ op, callId, rn, nowSec: this.deps.now });
  }

  /** Self-copy of accept/decline/end (p = own pubkey): other devices cancel.
   *  The wrap id of the copy is remembered so the relay's loopback delivery
   *  is ignored by this device. */
  private sendSelfCopy(payload: Record<string, unknown>): void {
    void this.deps
      .send(this.deps.me, payload)
      .then((wrapId) => {
        this.ownCopyIds.add(wrapId);
        if (this.ownCopyIds.size > 100) {
          const oldest = this.ownCopyIds.values().next().value;
          if (oldest !== undefined) this.ownCopyIds.delete(oldest);
        }
      })
      .catch(() => {
        /* self-copy is device sync - a failure never fails the call */
      });
  }

  private finishQuietly(): void {
    this.clearRingTimer();
    this.clearMediaTimer();
    for (const unsubscribe of this.mediaUnsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        /* a broken listener must never break teardown */
      }
    }
    const media = this.media;
    this.media = null;
    if (media) void media.leave().catch(() => undefined);
    this.active = null;
    this.offering = null;
    this.incoming = null;
    this.secrets = null;
    this.muted = true;
    this.participantCount = 0;
  }

  // ─── Caller actions ───────────────────────────────────────────────────────

  /**
   * Place a call. Caller-side checks are hygiene only (own opt-in, own block
   * list, own outgoing pair budget); the callee's policy stays unreadable.
   * Returns false (with `error` set) when the call never left the device.
   */
  async start(peerPub: string): Promise<boolean> {
    this.error = null;
    if (this.active) {
      this.setError('You are already in a call.');
      this.publish();
      return false;
    }
    const peer = typeof peerPub === 'string' && IDENTITY_HEX.test(peerPub) ? peerPub.toLowerCase() : null;
    if (!peer || peer === this.deps.me) {
      this.setError('That is not a valid pubkey.');
      this.publish();
      return false;
    }
    const policy = this.deps.getPolicy();
    if (!policy.callsEnabled) {
      this.setError('Calls in DMs are off. Turn them on in Settings first.');
      this.publish();
      return false;
    }
    if (this.deps.isBlocked(peer)) {
      this.setError('This person is on your block list.');
      this.publish();
      return false;
    }
    const now = this.deps.now();
    const guard = this.deps.loadGuard();
    const allowance = checkOutgoingAllowance(guard, peer, now);
    if (!allowance.ok) {
      this.setError('Too many call attempts to this person - try again later.');
      this.publish();
      return false;
    }
    const callId = newCallId();
    const keys = newDmCallOffer();
    const payload = buildDmCallOfferPayload('offer', callId, keys, { rn: callId, nowSec: this.deps.now });
    try {
      await this.deps.send(peer, payload);
    } catch {
      this.setError('Could not reach the relay - the call was not placed.');
      this.publish();
      return false;
    }
    recordOutgoingOffer(guard, peer, now);
    this.deps.saveGuard(guard);
    this.offering = keys;
    this.active = { phase: 'outgoing', role: 'caller', peer, callId, rn: callId, since: now, answeredAt: null };
    this.startRingTimer(() => this.onOutgoingTimeout());
    this.publish();
    return true;
  }

  /** Ring timeout (caller side): the offer is abandoned locally; the callee's
   *  own 30 s timer (or the signal expiry) cleans up any late ring. */
  private onOutgoingTimeout(): void {
    const a = this.active;
    if (!a || a.phase !== 'outgoing') return;
    this.deps.appendLog({ peer: a.peer, direction: 'out', outcome: 'missed', at: this.deps.now() });
    this.finishQuietly();
    this.publish();
  }

  /** Caller hangs up while ringing: tell the callee (best effort) and log. */
  cancel(): void {
    const a = this.active;
    if (!a || a.phase !== 'outgoing') return;
    const payload = this.signalPayload('end', a.callId, a.rn);
    void this.deps.send(a.peer, payload).catch(() => undefined);
    this.sendSelfCopy(payload);
    this.deps.appendLog({ peer: a.peer, direction: 'out', outcome: 'cancelled', at: this.deps.now() });
    this.finishQuietly();
    this.publish();
  }

  // ─── Callee actions ───────────────────────────────────────────────────────

  /** Answer the ringing call: derive the per-call secrets from our fresh
   *  ephemeral + the caller's offer epk, send accept (+ self-copy), connect. */
  async accept(): Promise<boolean> {
    const a = this.active;
    const incoming = this.incoming;
    if (!a || a.phase !== 'incoming' || !incoming) return false;
    this.error = null;
    const ephemeral = newDmCallEphemeral();
    let secrets: DmCallSecrets;
    try {
      secrets = deriveDmCallSecrets({
        secret: ephemeral.secret,
        peerPubHex: incoming.callerEpk,
        callNonceHex: incoming.nonce,
      });
    } catch {
      // A malformed caller epk can never secure a call: explicit decline,
      // never a half-joined session.
      this.decline('securing the call failed');
      return false;
    }
    const payload = buildDmCallAcceptPayload(a.callId, incoming.nonce, ephemeral, { rn: a.rn, nowSec: this.deps.now });
    try {
      await this.deps.send(a.peer, payload);
    } catch {
      this.setError('Could not answer - the relay is unreachable.');
      this.deps.appendLog({ peer: a.peer, direction: 'in', outcome: 'missed', at: this.deps.now() });
      this.finishQuietly();
      this.publish();
      return false;
    }
    this.sendSelfCopy(payload);
    this.clearRingTimer();
    this.secrets = secrets;
    this.offering = null;
    this.incoming = null;
    a.answeredAt = this.deps.now();
    a.phase = this.deps.mediaJoin ? 'connecting' : 'in-call';
    this.publish();
    if (this.deps.mediaJoin) {
      await this.joinMedia(a, secrets);
    }
    return this.active === a && a.phase === 'in-call';
  }

  /**
   * Phase 4: mint the SFU token for the derived call room and join the E2EE
   * media stack. Fail closed: a broker/SFU failure ends the call (signal +
   * log) instead of leaving a silent half-joined state. If the call ended
   * while the join was in flight, the fresh media handle is left immediately.
   */
  private async joinMedia(a: ActiveState, secrets: DmCallSecrets): Promise<void> {
    const join = this.deps.mediaJoin;
    if (!join) return;
    let media: DmCallMediaHandle;
    try {
      media = await join({ secrets, peer: a.peer });
    } catch {
      if (this.active !== a) return;
      // The call never reached media: end it, log it as cancelled (not an
      // answered call - the <5 s decline rule does not apply to a failed
      // connect) and surface the reason.
      const payload = this.signalPayload('end', a.callId, a.rn);
      void this.deps.send(a.peer, payload).catch(() => undefined);
      this.sendSelfCopy(payload);
      this.deps.appendLog({ peer: a.peer, direction: a.role === 'callee' ? 'in' : 'out', outcome: 'cancelled', at: this.deps.now() });
      this.setError('Could not connect the call media.');
      this.finishQuietly();
      this.publish();
      return;
    }
    if (this.active !== a) {
      // The call ended while connecting - never leave an orphaned session.
      void media.leave().catch(() => undefined);
      return;
    }
    this.media = media;
    this.muted = media.isMuted();
    this.participantCount = media.participantCount();
    a.phase = 'in-call';
    this.startMediaTimer(() => {
      if (this.active === a) this.endForError(a, 'Call ended at the maximum call duration.');
    });
    this.mediaUnsubscribers.push(
      media.onParticipants((count) => {
        if (this.active !== a) return;
        this.participantCount = count;
        if (count > DM_CALL_MEDIA_MAX_PARTICIPANTS) {
          // Client-side watchdog (ADR §3): a 3rd participant ends the call.
          // An honest client cannot kick; ending is the enforceable action,
          // and E2EE already makes the 3rd participant undecodable.
          this.endForError(a, 'A third participant joined - the call was ended.');
          return;
        }
        this.publish();
      }),
      media.onEncryptionError(() => {
        if (this.active === a) this.endForError(a, 'Encryption failed - the call was ended.');
      }),
    );
    this.publish();
  }

  /** End an active call because of a watchdog/media failure: signal the peer
   *  (best effort + self-copy), apply the answered-call log and cool-down
   *  rules, surface the reason, and tear the media down. */
  private endForError(a: ActiveState, message: string): void {
    if (this.active !== a) return;
    const payload = this.signalPayload('end', a.callId, a.rn);
    void this.deps.send(a.peer, payload).catch(() => undefined);
    this.sendSelfCopy(payload);
    const now = this.deps.now();
    const duration = a.answeredAt !== null ? Math.max(0, now - a.answeredAt) : 0;
    if (a.role === 'callee') {
      const guard = this.deps.loadGuard();
      if (duration < DM_CALL_ANSWER_DECLINE_SEC) recordDecline(guard, a.peer, now);
      else resetDeclines(guard, a.peer);
      this.deps.saveGuard(guard);
    }
    this.deps.appendLog({
      peer: a.peer,
      direction: a.role === 'callee' ? 'in' : 'out',
      outcome: 'answered',
      at: now,
      durationSec: duration,
    });
    this.setError(message);
    this.finishQuietly();
    this.publish();
  }

  /** Mute/unmute the live media. Returns the new muted state (silent no-op
   *  while media is not live). */
  async toggleMute(): Promise<boolean> {
    const media = this.media;
    if (!media || !this.active || this.active.phase !== 'in-call') return this.muted;
    const next = !this.muted;
    try {
      await media.setMuted(next);
      this.muted = next;
    } catch {
      this.setError('Microphone change failed.');
    }
    this.publish();
    return this.muted;
  }

  /** Decline the ringing call: signal + self-copy + cool-down record + log. */
  private decline(reason: string | null = null): void {
    const a = this.active;
    if (!a || a.phase !== 'incoming') return;
    const payload = this.signalPayload('decline', a.callId, a.rn);
    void this.deps.send(a.peer, payload).catch(() => undefined);
    this.sendSelfCopy(payload);
    const now = this.deps.now();
    const guard = this.deps.loadGuard();
    recordDecline(guard, a.peer, now);
    this.deps.saveGuard(guard);
    this.deps.appendLog({ peer: a.peer, direction: 'in', outcome: 'declined', at: now });
    if (reason) this.setError(reason);
    this.finishQuietly();
    this.publish();
  }

  /** UI decline (no error copy). */
  declineIncoming(): void {
    this.error = null;
    this.decline();
  }

  /** Decline + block the caller for future rings. */
  blockAndDecline(): void {
    const a = this.active;
    if (!a || a.phase !== 'incoming') return;
    this.deps.addBlock(a.peer);
    this.error = null;
    this.decline();
  }

  /** Ring timeout (callee side): local missed log + opt-in notice. */
  private onIncomingTimeout(): void {
    const a = this.active;
    if (!a || a.phase !== 'incoming') return;
    const now = this.deps.now();
    this.deps.appendLog({ peer: a.peer, direction: 'in', outcome: 'missed', at: now });
    if (this.deps.getPolicy().missedNotice) {
      void this.deps.sendNotice(a.peer, 'Missed call').catch(() => undefined);
    }
    this.finishQuietly();
    this.publish();
  }

  /** Hang up a connected call: 5 s rule applies on the callee side. */
  hangup(): void {
    const a = this.active;
    if (!a || (a.phase !== 'in-call' && a.phase !== 'connecting')) return;
    const payload = this.signalPayload('end', a.callId, a.rn);
    void this.deps.send(a.peer, payload).catch(() => undefined);
    this.sendSelfCopy(payload);
    const now = this.deps.now();
    const duration = a.answeredAt !== null ? Math.max(0, now - a.answeredAt) : 0;
    if (a.role === 'callee') {
      const guard = this.deps.loadGuard();
      if (duration < DM_CALL_ANSWER_DECLINE_SEC) recordDecline(guard, a.peer, now);
      else resetDeclines(guard, a.peer);
      this.deps.saveGuard(guard);
    }
    this.deps.appendLog({
      peer: a.peer,
      direction: a.role === 'callee' ? 'in' : 'out',
      outcome: 'answered',
      at: now,
      durationSec: duration,
    });
    this.finishQuietly();
    this.publish();
  }

  // ─── Inbound lane handling ────────────────────────────────────────────────

  /**
   * One raw lane payload from the DM transport. Deduped by wrap id (relay
   * replays are idempotent), parsed strictly, dropped when expired, and
   * never throws.
   */
  handleLanePayload(payload: unknown, envelope: { wrapId: string; from: string }): void {
    try {
      if (!IDENTITY_HEX.test(envelope.wrapId) || !IDENTITY_HEX.test(envelope.from)) return;
      if (this.deps.seenHas(envelope.wrapId)) return;
      this.deps.seenAdd(envelope.wrapId);
      const signal = parseCallSignal(payload);
      if (!signal) return;
      if (isCallSignalExpired(signal, { nowSec: this.deps.now })) return;
      if (this.ownCopyIds.has(envelope.wrapId)) return; // our own self-copy looped back
      const from = envelope.from.toLowerCase();
      if (from === this.deps.me) {
        this.handleSelfCopy(signal);
        return;
      }
      const extras = readDmCallExtras(payload);
      switch (signal.op) {
        case 'offer':
          this.handleOffer(signal, from, extras);
          break;
        case 'accept':
          this.handleAccept(signal, from, extras);
          break;
        case 'decline':
          this.handleDecline(signal, from);
          break;
        case 'busy':
          this.handleBusy(signal, from);
          break;
        case 'end':
          this.handleEnd(signal, from);
          break;
      }
    } catch {
      /* hostile lane content is ignored, never rendered */
    }
  }

  /** Offer from a peer: the callee evaluation + ring/busy/silent-drop. */
  private handleOffer(signal: DmCallSignal, from: string, extras: DmCallEnvelopeExtras): void {
    if (extras.epk === null || extras.nonce === null) return; // unsecurable: silent drop
    const now = this.deps.now();
    const guard = this.deps.loadGuard();
    const verdict = evaluateIncomingOffer({
      policy: this.deps.getPolicy(),
      blocked: this.deps.isBlocked(from),
      follows: this.deps.follows(from),
      guard,
      caller: from,
      at: now,
      inCall: this.active !== null,
    });
    if (verdict === 'drop') return; // SILENT: no response, no log
    recordIncomingOffer(guard, from, now, verdict === 'ring');
    this.deps.saveGuard(guard);
    if (verdict === 'busy') {
      const payload = this.signalPayload('busy', signal.callId, signal.rn);
      void this.deps.send(from, payload).catch(() => undefined);
      return;
    }
    this.incoming = { callerEpk: extras.epk, nonce: extras.nonce };
    this.active = {
      phase: 'incoming',
      role: 'callee',
      peer: from,
      callId: signal.callId,
      rn: signal.rn,
      since: now,
      answeredAt: null,
    };
    this.startRingTimer(() => this.onIncomingTimeout());
    this.publish();
  }

  /** Accept for our outgoing offer: derive the matching secrets + connect. */
  private handleAccept(signal: DmCallSignal, from: string, extras: DmCallEnvelopeExtras): void {
    const a = this.active;
    const offering = this.offering;
    if (!a || a.phase !== 'outgoing' || !offering || a.callId !== signal.callId || a.peer !== from) return;
    if (extras.epk === null) {
      this.failOutgoing('The call could not be secured.');
      return;
    }
    let secrets: DmCallSecrets;
    try {
      secrets = deriveDmCallSecrets({
        secret: offering.ephemeral.secret,
        peerPubHex: extras.epk,
        callNonceHex: offering.callNonceHex,
      });
    } catch {
      this.failOutgoing('The call could not be secured.');
      return;
    }
    this.clearRingTimer();
    this.secrets = secrets;
    this.offering = null;
    a.answeredAt = this.deps.now();
    a.phase = this.deps.mediaJoin ? 'connecting' : 'in-call';
    this.publish();
    if (this.deps.mediaJoin) {
      void this.joinMedia(a, secrets);
    }
  }

  /** A broken accept (malformed epk) aborts the call; tell the peer. */
  private failOutgoing(message: string): void {
    const a = this.active;
    if (!a) return;
    this.setError(message);
    const payload = this.signalPayload('end', a.callId, a.rn);
    void this.deps.send(a.peer, payload).catch(() => undefined);
    this.deps.appendLog({ peer: a.peer, direction: 'out', outcome: 'cancelled', at: this.deps.now() });
    this.finishQuietly();
    this.publish();
  }

  private handleDecline(signal: DmCallSignal, from: string): void {
    const a = this.active;
    if (!a || a.phase !== 'outgoing' || a.callId !== signal.callId || a.peer !== from) return;
    this.deps.appendLog({ peer: from, direction: 'out', outcome: 'declined', at: this.deps.now() });
    this.finishQuietly();
    this.publish();
  }

  private handleBusy(signal: DmCallSignal, from: string): void {
    const a = this.active;
    if (!a || a.phase !== 'outgoing' || a.callId !== signal.callId || a.peer !== from) return;
    this.deps.appendLog({ peer: from, direction: 'out', outcome: 'busy', at: this.deps.now() });
    this.finishQuietly();
    this.publish();
  }

  private handleEnd(signal: DmCallSignal, from: string): void {
    const a = this.active;
    if (!a || a.callId !== signal.callId || a.peer !== from) return;
    const now = this.deps.now();
    if (a.phase === 'outgoing' || a.phase === 'incoming') {
      this.deps.appendLog({ peer: from, direction: a.role === 'callee' ? 'in' : 'out', outcome: 'missed', at: now });
      this.finishQuietly();
      this.publish();
      return;
    }
    const duration = a.answeredAt !== null ? Math.max(0, now - a.answeredAt) : 0;
    if (a.role === 'callee') {
      const guard = this.deps.loadGuard();
      if (duration < DM_CALL_ANSWER_DECLINE_SEC) recordDecline(guard, from, now);
      else resetDeclines(guard, from);
      this.deps.saveGuard(guard);
    }
    this.deps.appendLog({ peer: from, direction: a.role === 'callee' ? 'in' : 'out', outcome: 'answered', at: now, durationSec: duration });
    this.finishQuietly();
    this.publish();
  }

  /** A self-copy from ANOTHER device of ours: cancel the local ring/session
   *  quietly - the acting device owns the log entry (ADR §4 multi-device). */
  private handleSelfCopy(signal: DmCallSignal): void {
    const a = this.active;
    if (!a || a.callId !== signal.callId) return;
    if (signal.op === 'accept') {
      if (a.phase === 'incoming') {
        this.finishQuietly();
        this.publish();
      }
      return;
    }
    if (signal.op === 'decline') {
      if (a.phase === 'incoming') {
        this.finishQuietly();
        this.publish();
      }
      return;
    }
    if (signal.op === 'end') {
      this.finishQuietly();
      this.publish();
    }
  }

  /** Teardown (identity switch / unmount): quiet, no signals. */
  stop(): void {
    this.finishQuietly();
    this.error = null;
    this.publish();
  }
}
