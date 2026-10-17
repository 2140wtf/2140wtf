// dmCallSession: the ADR §3-4 behavior matrix end to end - ring flows,
// timeout, <5 s decline rule, silent drop vs busy honesty, budgets and
// cool-downs through the real session, multi-device self-copies (including
// the own-copy relay loopback), replay/expiry dedupe, and the offer/accept
// key handshake (epk/nonce extras + identical derived secrets).

import { describe, expect, it } from 'vitest';
import { deriveDmCallSecrets, newDmCallEphemeral, newDmCallOffer } from '@/baofund/community/dmCallKeys.js';
import { parseCallSignal } from '@/baofund/community/dmSignaling.js';
import { DmCallSession } from './dmCallSession';
import { buildDmCallAcceptPayload, buildDmCallOfferPayload, buildDmCallPayload, readDmCallExtras } from './dmCallLane';
import { DM_CALL_MEDIA_MAX_DURATION_SEC } from './dmCallMedia';
import {
  DM_CALL_RING_TIMEOUT_SEC,
  declineCooldownRemaining,
  defaultDmCallGuardState,
  type DmCallGuardState,
} from './dmCallGuard';
import { DEFAULT_DM_CALL_POLICY, type DmCallLogEntry, type DmCallPolicy } from './dmCallStore';

const ME = 'aa'.repeat(32);
const CALLER = '11'.repeat(32);
const OTHER = '22'.repeat(32);
const START = 1_700_000_000;

interface SentSignal {
  peer: string;
  payload: Record<string, unknown>;
  wrapId: string;
}

interface HarnessOptions {
  policy?: Partial<DmCallPolicy>;
  blocked?: string[];
  follows?: { followed: boolean; mutual: boolean };
  guard?: DmCallGuardState;
  /** Phase 4: attach a fake media stack; 'fail' = join rejects. */
  media?: 'live' | 'fail' | 'deferred';
  /** Extra cap for the participant watchdog test (default 2 clients). */
}

/** Fake DmCallMediaHandle with controllable watchdog events. */
class FakeMedia {
  private count = 2;
  private muted = true;
  leftCount = 0;
  readonly setMutedCalls: boolean[] = [];
  private readonly participantListeners = new Set<(count: number) => void>();
  private readonly encryptionListeners = new Set<() => void>();

  participantCount = (): number => this.count;
  async setMuted(muted: boolean): Promise<void> {
    this.setMutedCalls.push(muted);
    this.muted = muted;
  }
  isMuted = (): boolean => this.muted;
  async leave(): Promise<void> {
    this.leftCount += 1;
  }
  onParticipants = (listener: (count: number) => void): (() => void) => {
    this.participantListeners.add(listener);
    return () => this.participantListeners.delete(listener);
  };
  onEncryptionError = (listener: () => void): (() => void) => {
    this.encryptionListeners.add(listener);
    return () => this.encryptionListeners.delete(listener);
  };
  fireParticipants(count: number): void {
    this.count = count;
    for (const listener of [...this.participantListeners]) listener(count);
  }
  fireEncryptionError(): void {
    for (const listener of [...this.encryptionListeners]) listener();
  }
}

function makeHarness(options: HarnessOptions = {}) {
  let now = START;
  let policy: DmCallPolicy = { ...DEFAULT_DM_CALL_POLICY, callsEnabled: true, whoMayRing: 'anyone', ...options.policy };
  let guard = options.guard ?? defaultDmCallGuardState();
  const sent: SentSignal[] = [];
  const notices: Array<{ peer: string; text: string }> = [];
  const logs: DmCallLogEntry[] = [];
  const seen = new Set<string>();
  const blocked = new Set(options.blocked ?? []);
  const timers: Array<{ fn: () => void; at: number; cancelled: boolean }> = [];
  let wrapCounter = 0;
  const nextWrapId = (): string => (++wrapCounter).toString(16).padStart(64, '0');
  const media = new FakeMedia();
  let resolveDeferredJoin: (() => void) | null = null;
  const seedInputs: Array<{ roomName: string; peer: string }> = [];
  const mediaJoin = options.media
    ? async (input: { secrets: { roomName: string }; peer: string }) => {
        seedInputs.push({ roomName: input.secrets.roomName, peer: input.peer });
        if (options.media === 'fail') throw new Error('sfu join failed');
        if (options.media === 'deferred') {
          await new Promise<void>((resolve) => {
            resolveDeferredJoin = resolve;
          });
        }
        return media;
      }
    : undefined;

  const session = new DmCallSession({
    me: ME,
    now: () => now,
    send: async (peer, payload) => {
      const wrapId = nextWrapId();
      sent.push({ peer, payload: payload as Record<string, unknown>, wrapId });
      return wrapId;
    },
    getPolicy: () => policy,
    isBlocked: (peer) => blocked.has(peer),
    addBlock: (peer) => {
      blocked.add(peer);
    },
    follows: () => options.follows ?? { followed: false, mutual: false },
    loadGuard: () => guard,
    saveGuard: (state) => {
      guard = state;
    },
    appendLog: (entry) => {
      logs.push(entry);
    },
    seenHas: (wrapId) => seen.has(wrapId),
    seenAdd: (wrapId) => {
      seen.add(wrapId);
    },
    sendNotice: async (peer, text) => {
      notices.push({ peer, text });
    },
    ...(mediaJoin ? { mediaJoin } : {}),
    setTimer: (fn, ms) => {
      const timer = { fn, at: now * 1000 + ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  });

  const advance = (sec: number): void => {
    now += sec;
    for (;;) {
      const due = timers.find((timer) => !timer.cancelled && timer.at <= now * 1000);
      if (!due) break;
      due.cancelled = true;
      due.fn();
    }
  };

  const deliver = (payload: unknown, from: string, wrapId?: string): string => {
    const id = wrapId ?? nextWrapId();
    session.handleLanePayload(payload, { wrapId: id, from });
    return id;
  };

  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const signals = (): SentSignal[] => sent;

  return {
    session,
    sent,
    signals,
    notices,
    logs,
    blocked,
    timers,
    advance,
    deliver,
    flush,
    now: () => now,
    getGuard: () => guard,
    media,
    seedInputs,
    releaseDeferredJoin: () => resolveDeferredJoin?.(),
    setPolicy: (patch: Partial<DmCallPolicy>) => {
      policy = { ...policy, ...patch };
    },
  };
}

interface OfferFixture {
  payload: Record<string, unknown>;
  callId: string;
  nonce: string;
  epk: string;
  /** Caller ephemeral secret - test-only, for cross-checking derivations. */
  secret: Uint8Array;
}

function offerPayload(
  opts: { callId?: string; epk?: string; nonce?: string; iat?: number; ttlSec?: number } = {},
): OfferFixture {
  const keys = newDmCallOffer();
  const callId = opts.callId ?? 'cd'.repeat(16);
  const payload = buildDmCallOfferPayload('offer', callId, keys, {
    rn: callId,
    ...(opts.iat !== undefined ? { nowSec: () => opts.iat as number } : { nowSec: () => START }),
  });
  if (opts.epk !== undefined) payload.epk = opts.epk;
  if (opts.nonce !== undefined) payload.nonce = opts.nonce;
  return { payload, callId, nonce: keys.callNonceHex, epk: keys.ephemeral.pubHex, secret: keys.ephemeral.secret };
}

describe('dmCallSession — incoming ring + evaluation', () => {
  it('rings for a policy-allowed offer and logs the 30 s timeout as missed', () => {
    const h = makeHarness();
    const { payload, callId } = offerPayload();
    h.deliver(payload, CALLER);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'incoming', peer: CALLER, callId, role: 'callee' });
    expect(h.timers).toHaveLength(1);
    h.advance(DM_CALL_RING_TIMEOUT_SEC);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'missed', at: START + 30 }]);
    expect(h.notices).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('ring timeout sends the opt-in missed notice only when enabled', () => {
    const h = makeHarness({ policy: { missedNotice: true } });
    h.deliver(offerPayload().payload, CALLER);
    h.advance(30);
    expect(h.notices).toEqual([{ peer: CALLER, text: 'Missed call' }]);
  });

  it('silent drop: blocked / calls-disabled / whoMayRing-refused offers get NO response, NO log, NO budget', () => {
    for (const options of [
      { blocked: [CALLER] },
      { policy: { callsEnabled: false } as Partial<DmCallPolicy> },
      { policy: { whoMayRing: 'nobody' } as Partial<DmCallPolicy> },
      { policy: { whoMayRing: 'follows' } as Partial<DmCallPolicy> },
    ]) {
      const h = makeHarness(options);
      h.deliver(offerPayload().payload, CALLER);
      expect(h.session.getSnapshot().phase).toBe('idle');
      expect(h.sent).toEqual([]);
      expect(h.logs).toEqual([]);
      expect(h.getGuard().incoming).toEqual([]);
      expect(h.timers).toEqual([]);
    }
  });

  it('follows / mutuals honor the oracle', () => {
    const followed = makeHarness({ policy: { whoMayRing: 'follows' }, follows: { followed: true, mutual: false } });
    followed.deliver(offerPayload().payload, CALLER);
    expect(followed.session.getSnapshot().phase).toBe('incoming');

    const mutual = makeHarness({ policy: { whoMayRing: 'mutuals' }, follows: { followed: true, mutual: true } });
    mutual.deliver(offerPayload().payload, CALLER);
    expect(mutual.session.getSnapshot().phase).toBe('incoming');

    const notMutual = makeHarness({ policy: { whoMayRing: 'mutuals' }, follows: { followed: true, mutual: false } });
    notMutual.deliver(offerPayload().payload, CALLER);
    expect(notMutual.session.getSnapshot().phase).toBe('idle');
  });

  it('busy honesty: a second offer while in a call gets call-busy; refused callers never learn busy', async () => {
    const h = makeHarness();
    h.deliver(offerPayload().payload, CALLER);
    await h.session.accept();
    expect(h.session.getSnapshot().phase).toBe('in-call');
    const before = h.sent.length;

    h.deliver(offerPayload().payload, OTHER);
    const busy = h.sent.slice(before).filter((s) => s.payload.op === 'busy');
    expect(busy).toHaveLength(1);
    expect(busy[0].peer).toBe(OTHER);
    // The busy offer counted as an offer but NOT as an alert.
    expect(h.getGuard().incoming.filter((r) => r.peer === OTHER)).toEqual([{ peer: OTHER, at: START, alert: false }]);
    // The callee is still in the ORIGINAL call.
    expect(h.session.getSnapshot().peer).toBe(CALLER);

    // A blocked caller while in a call: silent, no busy.
    const blockedHarness = makeHarness({ blocked: [OTHER] });
    blockedHarness.deliver(offerPayload().payload, CALLER);
    await blockedHarness.session.accept();
    const sentBefore = blockedHarness.sent.length;
    blockedHarness.deliver(offerPayload().payload, OTHER);
    expect(blockedHarness.sent.length).toBe(sentBefore);
  });

  it('budgets: the 6th real ring in an hour is dropped silently (alert budget 5/h)', () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i += 1) {
      h.deliver(offerPayload({ iat: h.now() }).payload, CALLER);
      expect(h.session.getSnapshot().phase).toBe('incoming');
      const callId = h.session.getSnapshot().callId as string;
      h.deliver(buildDmCallPayload({ op: 'end', callId, nowSec: h.now }), CALLER);
      h.advance(1);
    }
    expect(h.getGuard().incoming.filter((r) => r.peer === CALLER && r.alert)).toHaveLength(5);
    const sentBefore = h.sent.length;
    const logsBefore = h.logs.length;
    h.deliver(offerPayload({ iat: h.now() }).payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent.length).toBe(sentBefore);
    expect(h.logs.length).toBe(logsBefore);
  });

  it('budgets: the per-caller 10/h ceiling drops an 11th offer silently', () => {
    const guard = defaultDmCallGuardState();
    for (let i = 0; i < 10; i += 1) {
      guard.incoming.push({ peer: CALLER, at: START - 30 + i, alert: false });
    }
    const h = makeHarness({ guard });
    const sentBefore = h.sent.length;
    h.deliver(offerPayload({ iat: h.now() }).payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent.length).toBe(sentBefore);
    expect(h.logs).toEqual([]);
  });
});

describe('dmCallSession — accept / decline / block (callee)', () => {
  it('accept derives byte-identical secrets on both sides and self-copies', async () => {
    const h = makeHarness();
    const offer = offerPayload();
    h.deliver(offer.payload, CALLER);
    const ok = await h.session.accept();
    expect(ok).toBe(true);
    await h.flush();
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'in-call', peer: CALLER, role: 'callee' });
    expect(h.session.getSnapshot().answeredAt).toBe(START);

    // accept went to the caller AND a self-copy went to us (multi-device).
    const acceptToCaller = h.sent.find((s) => s.peer === CALLER && s.payload.op === 'accept');
    const selfCopy = h.sent.find((s) => s.peer === ME && s.payload.op === 'accept');
    expect(acceptToCaller).toBeTruthy();
    expect(selfCopy).toBeTruthy();
    const acceptExtras = readDmCallExtras(acceptToCaller!.payload);
    expect(acceptExtras.nonce).toBe(offer.nonce);
    expect(acceptExtras.epk).toMatch(/^[0-9a-f]{64}$/);

    // The caller-side derivation with the offer keys matches ours.
    const theirView = deriveDmCallSecrets({
      secret: offer.secret,
      peerPubHex: acceptExtras.epk as string,
      callNonceHex: offer.nonce,
    });
    expect(theirView.id32Hex).toBe(h.session.getCallSecrets()?.id32Hex);
    expect(theirView.roomName).toBe(h.session.getCallSecrets()?.roomName);
    expect(Array.from(theirView.mediaKey)).toEqual(Array.from(h.session.getCallSecrets()!.mediaKey));
    // Ephemeral secret never rides the wire.
    expect(JSON.stringify(h.sent)).not.toContain('secret');
  });

  it('decline records the cool-down and future offers are silently dropped until it expires', async () => {
    const h = makeHarness();
    const offer = offerPayload();
    h.deliver(offer.payload, CALLER);
    h.session.declineIncoming();
    await h.flush();
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'declined', at: START }]);
    expect(h.sent.some((s) => s.payload.op === 'decline' && s.peer === CALLER)).toBe(true);
    expect(h.sent.some((s) => s.payload.op === 'decline' && s.peer === ME)).toBe(true);
    expect(declineCooldownRemaining(h.getGuard(), CALLER, START)).toBe(120);

    const sentBefore = h.sent.length;
    h.deliver(offerPayload().payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent.length).toBe(sentBefore);
    expect(h.logs).toHaveLength(1);

    // Past the cool-down a FRESH offer (its 60 s validity window) rings.
    h.advance(121);
    h.deliver(offerPayload({ iat: h.now() }).payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('incoming');
  });

  it('blockAndDecline adds the block AND declines; later rings stay silent', async () => {
    const h = makeHarness();
    h.deliver(offerPayload().payload, CALLER);
    h.session.blockAndDecline();
    await h.flush();
    expect(h.blocked.has(CALLER)).toBe(true);
    expect(h.logs[0]).toMatchObject({ outcome: 'declined' });
    const sentBefore = h.sent.length;
    // Even outside the cool-down (craft a fresh guard-free harness state),
    // the block keeps it silent.
    h.advance(86_401);
    h.deliver(offerPayload().payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent.length).toBe(sentBefore);
  });

  it('a malformed caller epk fails the accept closed (decline, never a half call)', async () => {
    const h = makeHarness();
    // epk present but not an x25519 point that can derive (all-zero => low order).
    h.deliver(offerPayload({ epk: '00'.repeat(32) }).payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('incoming');
    const ok = await h.session.accept();
    expect(ok).toBe(false);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent.some((s) => s.payload.op === 'decline')).toBe(true);
    expect(h.getGuard().declines[CALLER]?.count).toBe(1);
  });
});

describe('dmCallSession — outgoing', () => {
  it('start publishes an offer carrying epk + nonce and reaches in-call on accept', async () => {
    const h = makeHarness();
    expect(await h.session.start(CALLER)).toBe(true);
    const offer = h.sent.find((s) => s.payload.op === 'offer');
    expect(offer).toBeTruthy();
    expect(offer!.peer).toBe(CALLER);
    const extras = readDmCallExtras(offer!.payload);
    expect(extras.epk).toMatch(/^[0-9a-f]{64}$/);
    expect(extras.nonce).toMatch(/^[0-9a-f]{32}$/);
    // The strict parser drops the extras by design - the call layer reads
    // them from the RAW payload (documented contract).
    const parsed = parseCallSignal(offer!.payload);
    expect(parsed).toBeTruthy();
    expect(Object.keys(parsed as object).sort()).toEqual(['callId', 'exp', 'iat', 'op', 'rn', 't', 'v']);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'outgoing', peer: CALLER, role: 'caller' });

    // The callee answers with its own ephemeral; the caller derives secrets.
    const calleeEphemeral = newDmCallEphemeral();
    const accept = buildDmCallAcceptPayload(parsed!.callId, extras.nonce as string, calleeEphemeral, { rn: parsed!.rn, nowSec: h.now });
    h.deliver(accept, CALLER);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'in-call', peer: CALLER, role: 'caller' });
    expect(h.session.getCallSecrets()?.id32Hex).toHaveLength(64);
    // Both sides see the same room name (the broker voice_room).
    const calleeView = deriveDmCallSecrets({
      secret: calleeEphemeral.secret,
      peerPubHex: extras.epk as string,
      callNonceHex: extras.nonce as string,
    });
    expect(calleeView.roomName).toBe(h.session.getCallSecrets()?.roomName);
  });

  it('caller hygiene: no calls while disabled, blocked, self, already active, or budget spent', async () => {
    const disabled = makeHarness({ policy: { callsEnabled: false } });
    expect(await disabled.session.start(CALLER)).toBe(false);
    expect(disabled.session.getSnapshot().error).toContain('Settings');
    expect(disabled.sent).toEqual([]);

    const blockedHarness = makeHarness({ blocked: [CALLER] });
    expect(await blockedHarness.session.start(CALLER)).toBe(false);
    expect(blockedHarness.sent).toEqual([]);

    const selfCall = makeHarness();
    expect(await selfCall.session.start(ME)).toBe(false);

    const h = makeHarness();
    expect(await h.session.start(CALLER)).toBe(true);
    expect(await h.session.start(OTHER)).toBe(false); // already ringing
    expect(h.sent.filter((s) => s.payload.op === 'offer')).toHaveLength(1);

    // Three completed ring attempts spend the pair budget.
    const spent = makeHarness();
    for (let i = 0; i < 3; i += 1) {
      expect(await spent.session.start(CALLER)).toBe(true);
      spent.advance(DM_CALL_RING_TIMEOUT_SEC);
    }
    expect(spent.logs).toHaveLength(3);
    expect(await spent.session.start(CALLER)).toBe(false);
    expect(spent.session.getSnapshot().error).toContain('Too many call attempts');
  });

  it('caller ring timeout logs missed; cancel sends end + self-copy and logs cancelled', async () => {
    const timedOut = makeHarness();
    await timedOut.session.start(CALLER);
    timedOut.advance(30);
    expect(timedOut.session.getSnapshot().phase).toBe('idle');
    expect(timedOut.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'missed', at: START + 30 }]);

    const cancelled = makeHarness();
    await cancelled.session.start(CALLER);
    cancelled.session.cancel();
    await cancelled.flush();
    expect(cancelled.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'cancelled', at: START }]);
    expect(cancelled.sent.some((s) => s.peer === CALLER && s.payload.op === 'end')).toBe(true);
    expect(cancelled.sent.some((s) => s.peer === ME && s.payload.op === 'end')).toBe(true);
  });

  it('decline and busy responses for our offer log out and end the ring', async () => {
    const h = makeHarness();
    await h.session.start(CALLER);
    const callId = h.session.getSnapshot().callId as string;
    h.deliver(buildDmCallPayload({ op: 'decline', callId, nowSec: h.now }), CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'declined', at: START }]);

    const busy = makeHarness();
    await busy.session.start(CALLER);
    const busyCallId = busy.session.getSnapshot().callId as string;
    busy.deliver(buildDmCallPayload({ op: 'busy', callId: busyCallId, nowSec: busy.now }), CALLER);
    expect(busy.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'busy', at: START }]);
  });

  it('accept with a malformed epk aborts the call with an end and a local error', async () => {
    const h = makeHarness();
    await h.session.start(CALLER);
    const callId = h.session.getSnapshot().callId as string;
    h.deliver(buildDmCallPayload({ op: 'accept', callId, nowSec: h.now }), CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.session.getSnapshot().error).toContain('secured');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'cancelled', at: START }]);
    expect(h.sent.some((s) => s.payload.op === 'end' && s.peer === CALLER)).toBe(true);
  });

  it('signals for an unknown callId are ignored', async () => {
    const h = makeHarness();
    await h.session.start(CALLER);
    const snapshot = h.session.getSnapshot();
    h.deliver(buildDmCallPayload({ op: 'decline', callId: 'ff'.repeat(16), nowSec: h.now }), CALLER);
    h.deliver(buildDmCallPayload({ op: 'busy', callId: 'ff'.repeat(16), nowSec: h.now }), OTHER);
    expect(h.session.getSnapshot()).toMatchObject({ phase: snapshot.phase, callId: snapshot.callId });
    expect(h.logs).toEqual([]);
  });
});

describe('dmCallSession — answered calls, end, and the <5 s rule', () => {
  async function connectedCallee() {
    const h = makeHarness();
    h.deliver(offerPayload().payload, CALLER);
    await h.session.accept();
    return h;
  }

  it('callee: peer end under 5 s counts as a decline; >= 5 s resets', async () => {
    const quick = await connectedCallee();
    quick.advance(2);
    quick.deliver(buildDmCallPayload({ op: 'end', callId: quick.session.getSnapshot().callId as string, nowSec: quick.now }), CALLER);
    expect(quick.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'answered', at: START + 2, durationSec: 2 }]);
    expect(quick.getGuard().declines[CALLER]?.count).toBe(1);

    const long = await connectedCallee();
    long.getGuard().declines[CALLER] = { count: 2, until: START + 600, lastAt: START };
    long.advance(6);
    long.deliver(buildDmCallPayload({ op: 'end', callId: long.session.getSnapshot().callId as string, nowSec: long.now }), CALLER);
    expect(long.logs[0]).toMatchObject({ outcome: 'answered', durationSec: 6 });
    expect(long.getGuard().declines[CALLER]).toBeUndefined();
  });

  it('callee hangup applies the same rule and signals end + self-copy', async () => {
    const h = await connectedCallee();
    h.advance(1);
    h.session.hangup();
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.logs[0]).toMatchObject({ direction: 'in', outcome: 'answered', durationSec: 1 });
    expect(h.getGuard().declines[CALLER]?.count).toBe(1);
    expect(h.sent.some((s) => s.peer === CALLER && s.payload.op === 'end')).toBe(true);
  });

  it('caller hangup logs the answered call with duration and never touches the callee cool-down', async () => {
    const h = makeHarness();
    await h.session.start(CALLER);
    const offer = h.sent.find((s) => s.payload.op === 'offer')!;
    const extras = readDmCallExtras(offer.payload);
    const calleeEphemeral = newDmCallEphemeral();
    const callId = h.session.getSnapshot().callId as string;
    h.deliver(buildDmCallAcceptPayload(callId, extras.nonce as string, calleeEphemeral, { rn: callId, nowSec: h.now }), CALLER);
    h.advance(42);
    h.session.hangup();
    await h.flush();
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'answered', at: START + 42, durationSec: 42 }]);
    expect(h.getGuard().declines[CALLER]).toBeUndefined();
  });

  it('an end while ringing logs missed on the matching side', async () => {
    const callee = makeHarness();
    callee.deliver(offerPayload().payload, CALLER);
    const callId = callee.session.getSnapshot().callId as string;
    callee.deliver(buildDmCallPayload({ op: 'end', callId, nowSec: callee.now }), CALLER);
    expect(callee.session.getSnapshot().phase).toBe('idle');
    expect(callee.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'missed', at: START }]);

    const caller = makeHarness();
    await caller.session.start(CALLER);
    const outCallId = caller.session.getSnapshot().callId as string;
    caller.deliver(buildDmCallPayload({ op: 'end', callId: outCallId, nowSec: caller.now }), CALLER);
    expect(caller.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'missed', at: START }]);
  });
});

describe('dmCallSession — multi-device self-copies + dedupe', () => {
  it('an accept self-copy from another device cancels this device’s ring quietly', () => {
    const h = makeHarness();
    const offer = offerPayload();
    h.deliver(offer.payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('incoming');
    // Another device of OURS answered.
    const accept = buildDmCallAcceptPayload(offer.callId, offer.nonce, newDmCallEphemeral(), { rn: offer.callId, nowSec: h.now });
    h.deliver(accept, ME);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.logs).toEqual([]); // the answering device owns the log
  });

  it('a decline self-copy cancels the ring; an end self-copy ends an in-call quietly', async () => {
    const declineHarness = makeHarness();
    const offer = offerPayload();
    declineHarness.deliver(offer.payload, CALLER);
    declineHarness.deliver(buildDmCallPayload({ op: 'decline', callId: offer.callId, nowSec: declineHarness.now }), ME);
    expect(declineHarness.session.getSnapshot().phase).toBe('idle');
    expect(declineHarness.logs).toEqual([]);

    const endHarness = makeHarness();
    endHarness.deliver(offerPayload().payload, CALLER);
    await endHarness.session.accept();
    const callId = endHarness.session.getSnapshot().callId as string;
    endHarness.deliver(buildDmCallPayload({ op: 'end', callId, nowSec: endHarness.now }), ME);
    expect(endHarness.session.getSnapshot().phase).toBe('idle');
    expect(endHarness.logs).toEqual([]);
  });

  it('the device’s OWN self-copy looped back by the relay is ignored (in-call survives)', async () => {
    const h = makeHarness();
    h.deliver(offerPayload().payload, CALLER);
    await h.session.accept();
    await h.flush();
    const selfCopy = h.sent.find((s) => s.peer === ME && s.payload.op === 'accept');
    expect(selfCopy).toBeTruthy();
    // Relay loops the self-copy back to us.
    h.deliver(selfCopy!.payload, ME, selfCopy!.wrapId);
    expect(h.session.getSnapshot().phase).toBe('in-call');

    // Same for our own end self-copy while connected.
    h.session.hangup();
    await h.flush();
    const endCopy = h.sent.find((s) => s.peer === ME && s.payload.op === 'end');
    expect(endCopy).toBeTruthy();
    h.deliver(endCopy!.payload, ME, endCopy!.wrapId);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.logs).toHaveLength(1); // the hangup log, not a second one
  });

  it('relay replays are idempotent (dedupe by wrap id) and expired signals are dropped', () => {
    const h = makeHarness();
    const { payload } = offerPayload();
    const wrapId = h.deliver(payload, CALLER);
    expect(h.session.getSnapshot().phase).toBe('incoming');
    h.deliver(payload, CALLER, wrapId); // replay
    expect(h.timers).toHaveLength(1); // still one ring timer

    // Expired: iat 10 min ago, TTL 60 s -> exp long past.
    const expired = buildDmCallPayload({
      op: 'offer',
      callId: 'ef'.repeat(16),
      iat: START - 600,
      epk: offerPayload().epk,
      nonce: offerPayload().nonce,
    });
    h.deliver(expired, OTHER);
    expect(h.session.getSnapshot().peer).toBe(CALLER); // unchanged
  });
});

describe('dmCallSession — hostile payloads', () => {
  it('offers without valid epk/nonce never ring', () => {
    const h = makeHarness();
    const keys = newDmCallOffer();
    const bare = buildDmCallPayload({ op: 'offer', callId: 'ab'.repeat(16), nowSec: h.now });
    h.deliver(bare, CALLER);
    const badEpk = buildDmCallPayload({ op: 'offer', callId: 'ab'.repeat(16), epk: 'junk', nonce: keys.callNonceHex, nowSec: h.now });
    h.deliver(badEpk, CALLER);
    const badNonce = buildDmCallPayload({ op: 'offer', callId: 'ab'.repeat(16), epk: keys.ephemeral.pubHex, nonce: 'JUNK', nowSec: h.now });
    h.deliver(badNonce, CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.sent).toEqual([]);
  });

  it('malformed / hostile payloads never throw', () => {
    const h = makeHarness();
    for (const hostile of [null, 'text', 42, {}, { v: 1, t: 'bao-call-v1' }, { v: 2, t: 'bao-call-v1', op: 'offer' }]) {
      h.deliver(hostile, CALLER);
    }
    expect(h.session.getSnapshot().phase).toBe('idle');
  });
});

describe('dmCallSession — phase 4 media + watchdog', () => {
  it('accept with media: connecting -> live, muted, participant count, mute toggle', async () => {
    const h = makeHarness({ media: 'deferred' });
    h.deliver(offerPayload().payload, CALLER);
    const accepting = h.session.accept();
    // The join is in flight: the session is honest about it.
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('connecting');
    expect(h.session.getSnapshot().media).toBe('connecting');
    h.releaseDeferredJoin();
    expect(await accepting).toBe(true);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'in-call', media: 'live', muted: true, participantCount: 2 });
    // The join input used the DERIVED room name (broker pubkey==room check).
    expect(h.seedInputs[0].roomName).toBe(h.session.getCallSecrets()?.roomName);
    expect(h.seedInputs[0].peer).toBe(CALLER);

    // Mute toggle reaches the media handle and the snapshot.
    expect(await h.session.toggleMute()).toBe(false);
    expect(h.media.setMutedCalls).toEqual([false]);
    expect(h.session.getSnapshot().muted).toBe(false);
    // Hang up tears the media down.
    h.session.hangup();
    await h.flush();
    expect(h.media.leftCount).toBe(1);
    expect(h.session.getSnapshot().phase).toBe('idle');
  });

  it('caller side joins media on accept and ends if the join fails', async () => {
    const h = makeHarness({ media: 'fail' });
    await h.session.start(CALLER);
    const offer = h.sent.find((s) => s.payload.op === 'offer')!;
    const extras = readDmCallExtras(offer.payload);
    const accept = buildDmCallAcceptPayload(h.session.getSnapshot().callId as string, extras.nonce as string, newDmCallEphemeral(), { rn: h.session.getSnapshot().callId as string, nowSec: h.now });
    h.deliver(accept, CALLER);
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.session.getSnapshot().error).toContain('media');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'out', outcome: 'cancelled', at: START }]);
    expect(h.sent.some((s) => s.peer === CALLER && s.payload.op === 'end')).toBe(true);
  });

  it('callee accept with a failing media join cancels the call (no answered log, no decline)', async () => {
    const h = makeHarness({ media: 'fail' });
    h.deliver(offerPayload().payload, CALLER);
    expect(await h.session.accept()).toBe(false);
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.session.getSnapshot().error).toContain('media');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'cancelled', at: START }]);
    expect(h.getGuard().declines[CALLER]).toBeUndefined();
    expect(h.sent.some((s) => s.peer === CALLER && s.payload.op === 'accept')).toBe(true);
    expect(h.sent.some((s) => s.peer === CALLER && s.payload.op === 'end')).toBe(true);
  });

  async function connectedWithMedia() {
    const h = makeHarness({ media: 'live' });
    h.deliver(offerPayload({ iat: START }).payload, CALLER);
    await h.session.accept();
    await h.flush();
    expect(h.session.getSnapshot().media).toBe('live');
    return h;
  }

  it('watchdog: a 3rd participant ends the call and logs the answered call', async () => {
    const h = await connectedWithMedia();
    h.advance(10);
    h.media.fireParticipants(3);
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.session.getSnapshot().error).toContain('third participant');
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'answered', at: START + 10, durationSec: 10 }]);
    expect(h.sent.some((s) => s.peer === CALLER && s.payload.op === 'end')).toBe(true);
    expect(h.media.leftCount).toBe(1);
    expect(h.getGuard().declines[CALLER]).toBeUndefined(); // >= 5 s answered call
  });

  it('watchdog: a local encryption failure ends the call (fail closed)', async () => {
    const h = await connectedWithMedia();
    h.advance(6);
    h.media.fireEncryptionError();
    await h.flush();
    expect(h.session.getSnapshot().error).toContain('Encryption failed');
    expect(h.media.leftCount).toBe(1);
    expect(h.logs[0]).toMatchObject({ outcome: 'answered', durationSec: 6 });
  });

  it('watchdog: the call auto-ends at the max duration', async () => {
    const h = await connectedWithMedia();
    h.advance(DM_CALL_MEDIA_MAX_DURATION_SEC);
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('idle');
    expect(h.session.getSnapshot().error).toContain('maximum call duration');
    expect(h.logs[0]).toMatchObject({ outcome: 'answered', durationSec: DM_CALL_MEDIA_MAX_DURATION_SEC });
    expect(h.media.leftCount).toBe(1);
  });

  it('peer end during connecting tears down the in-flight media without a zombie', async () => {
    const h = makeHarness({ media: 'deferred' });
    h.deliver(offerPayload().payload, CALLER);
    const accepting = h.session.accept();
    await h.flush();
    expect(h.session.getSnapshot().phase).toBe('connecting');
    h.deliver(buildDmCallPayload({ op: 'end', callId: h.session.getSnapshot().callId as string, nowSec: h.now }), CALLER);
    expect(h.session.getSnapshot().phase).toBe('idle');
    // Answered-then-ended < 5 s = a decline for the caller's cool-down.
    expect(h.logs).toEqual([{ peer: CALLER, direction: 'in', outcome: 'answered', at: START, durationSec: 0 }]);
    expect(h.getGuard().declines[CALLER]?.count).toBe(1);
    h.releaseDeferredJoin();
    await accepting;
    await h.flush();
    // The call had already ended: the fresh media session is left immediately.
    expect(h.media.leftCount).toBe(1);
    expect(h.session.getSnapshot().phase).toBe('idle');
  });
});
