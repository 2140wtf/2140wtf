/**
 * dmCallGuard - callee-side ring policy evaluation + abuse budgets
 * (ADR-dm-calls §4), persisted per identity under
 * `baofund:dmcall:guard:<pubkey-lowercase>`.
 *
 * On decrypting a `call-offer` the CALLEE evaluates, in the ADR's exact
 * order: block -> callsEnabled -> whoMayRing -> cool-down -> budgets. A
 * refused ring is a SILENT DROP: no response, no ring, no log - the caller
 * cannot distinguish "offline" from "refused". `call-busy` is emitted ONLY
 * when the offer WOULD have rung (all checks passed) and the callee is
 * already in a call (busy honesty).
 *
 * Budgets (all rolling windows, "simple persisted counters" per the task):
 *   - per-pair 3 offers/h (burst 1: a caller holds at most one outstanding
 *     offer to a pair - the session enforces single-call state). This is the
 *     caller-side HYGIENE budget (`checkOutgoingAllowance`): the ADR puts it
 *     on the caller's own budget line, and with a 1:1 lane the callee-side
 *     per-caller budget (10/h) would otherwise make the alert budget
 *     unreachable (3 < 5 < 10 on the same receipt stream);
 *   - per-caller 10 offers/h + 40/day (callee-side, all offers);
 *   - callee alert budget 5 rings/h per caller (callee-side; rings only -
 *     busy answers never consume it; excess rings are dropped silently,
 *     never shown as busy).
 *
 * Cool-down escalation after explicit declines (2m -> 10m -> 1h -> 24h cap):
 * a call answered and ended in under 5 s counts as a decline; any answered
 * call of >= 5 s resets the counter. The callee is the authority, so the
 * callee records its own declines and enforces the window on inbound offers.
 *
 * The caller-side check is hygiene only (its own block list, its own
 * outgoing pair budget) - the callee's policy is unreadable by design.
 *
 * Storage invariants mirror dmCallStore: invalid pubkey reads and writes
 * NOTHING; corrupt slots degrade to the empty state; entries are bounded and
 * validated on load.
 */

import { IDENTITY_HEX } from '../lib/activeIdentity';
import type { DmCallPolicy } from './dmCallStore';
import type { DmStorageLike } from './dmStore';

export const DM_CALL_GUARD_BASE = 'baofund:dmcall:guard';
export const DM_CALL_GUARD_VERSION = 1;

/** Ring timeout: 30 s (ADR §4); both sides time the ring out locally. */
export const DM_CALL_RING_TIMEOUT_SEC = 30;
/** A call answered and ended in under this many seconds counts as a decline. */
export const DM_CALL_ANSWER_DECLINE_SEC = 5;
/** Escalating cool-down after consecutive explicit declines (cap 24 h). */
export const DM_CALL_COOLDOWN_SEC = [120, 600, 3600, 86_400] as const;
/** Per-pair outgoing/incoming budget per rolling hour. */
export const DM_CALL_PAIR_OFFERS_PER_HOUR = 3;
/** Per-caller incoming budget per rolling hour. */
export const DM_CALL_CALLER_OFFERS_PER_HOUR = 10;
/** Per-caller incoming budget per rolling day. */
export const DM_CALL_CALLER_OFFERS_PER_DAY = 40;
/** Callee alert budget: rings (audible alerts) per caller per rolling hour. */
export const DM_CALL_ALERTS_PER_HOUR = 5;

const HOUR = 3600;
const DAY = 86_400;

/** Bound on retained offer receipts (24 h of budget accounting). */
export const DM_CALL_GUARD_OFFERS_LIMIT = 200;
/** Bound on retained per-peer decline records. */
export const DM_CALL_GUARD_DECLINES_LIMIT = 100;

export interface DmCallOfferReceipt {
  /** The other party (lowercase 64-hex). */
  peer: string;
  at: number;
  /** Whether this offer actually rang (alert budget accounting). */
  alert: boolean;
}

export interface DmCallDeclineRecord {
  /** Consecutive declines (drives the cool-down rung). */
  count: number;
  /** Invoking `count` declines, offers are silently dropped until this time. */
  until: number;
  lastAt: number;
}

export interface DmCallGuardState {
  version: typeof DM_CALL_GUARD_VERSION;
  incoming: DmCallOfferReceipt[];
  outgoing: Array<{ peer: string; at: number }>;
  declines: Record<string, DmCallDeclineRecord>;
}

export function defaultDmCallGuardState(): DmCallGuardState {
  return { version: DM_CALL_GUARD_VERSION, incoming: [], outgoing: [], declines: {} };
}

export function dmCallGuardSlot(pubkey: unknown): string | null {
  return typeof pubkey === 'string' && IDENTITY_HEX.test(pubkey) ? `${DM_CALL_GUARD_BASE}:${pubkey.toLowerCase()}` : null;
}

function sanitizeReceipt(value: unknown): DmCallOfferReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.peer !== 'string' || !IDENTITY_HEX.test(r.peer)) return null;
  if (typeof r.at !== 'number' || !Number.isSafeInteger(r.at) || r.at <= 0) return null;
  return { peer: r.peer.toLowerCase(), at: r.at, alert: r.alert === true };
}

export function sanitizeDmCallGuardState(value: unknown): DmCallGuardState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== DM_CALL_GUARD_VERSION) return null;
  const state = defaultDmCallGuardState();
  if (Array.isArray(v.incoming)) {
    for (const item of v.incoming) {
      const receipt = sanitizeReceipt(item);
      if (receipt) state.incoming.push(receipt);
    }
    state.incoming = state.incoming.slice(-DM_CALL_GUARD_OFFERS_LIMIT);
  }
  if (Array.isArray(v.outgoing)) {
    for (const item of v.outgoing) {
      const receipt = sanitizeReceipt(item);
      if (receipt) state.outgoing.push({ peer: receipt.peer, at: receipt.at });
    }
    state.outgoing = state.outgoing.slice(-DM_CALL_GUARD_OFFERS_LIMIT);
  }
  if (v.declines && typeof v.declines === 'object' && !Array.isArray(v.declines)) {
    for (const [peer, raw] of Object.entries(v.declines as Record<string, unknown>)) {
      if (!IDENTITY_HEX.test(peer) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.count !== 'number' || !Number.isSafeInteger(r.count) || r.count < 1) continue;
      if (typeof r.until !== 'number' || !Number.isSafeInteger(r.until) || r.until < 0) continue;
      if (typeof r.lastAt !== 'number' || !Number.isSafeInteger(r.lastAt) || r.lastAt <= 0) continue;
      state.declines[peer.toLowerCase()] = { count: Math.min(r.count, DM_CALL_COOLDOWN_SEC.length), until: r.until, lastAt: r.lastAt };
      if (Object.keys(state.declines).length >= DM_CALL_GUARD_DECLINES_LIMIT) break;
    }
  }
  return state;
}

/** Read this identity's guard state. Invalid pubkey / corrupt slot -> the
 *  empty state. Never throws. */
export function loadDmCallGuard(pubkey: unknown, storage: DmStorageLike | null = defaultStorage()): DmCallGuardState {
  const key = dmCallGuardSlot(pubkey);
  if (!key || !storage) return defaultDmCallGuardState();
  try {
    const raw = storage.getItem(key);
    if (!raw) return defaultDmCallGuardState();
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeDmCallGuardState(parsed) ?? defaultDmCallGuardState();
  } catch {
    return defaultDmCallGuardState();
  }
}

/** Persist the guard state. Invalid pubkey -> the state is echoed back. */
export function saveDmCallGuard(
  pubkey: unknown,
  state: DmCallGuardState,
  storage: DmStorageLike | null = defaultStorage(),
): DmCallGuardState {
  const sanitized = sanitizeDmCallGuardState(state) ?? defaultDmCallGuardState();
  const key = dmCallGuardSlot(pubkey);
  if (!key || !storage) return sanitized;
  try {
    storage.setItem(key, JSON.stringify(sanitized));
  } catch {
    /* storage unavailable: nothing persisted */
  }
  return sanitized;
}

// ─── Pure accounting ────────────────────────────────────────────────────────

/** Count entries inside the rolling window `(at - windowSec, at]`. */
export function countInWindow(times: Array<{ at: number }>, at: number, windowSec: number): number {
  const floor = at - windowSec;
  let count = 0;
  for (const entry of times) {
    if (entry.at > floor && entry.at <= at) count += 1;
  }
  return count;
}

function countFrom(receipts: DmCallOfferReceipt[], peer: string, at: number, windowSec: number, alertsOnly = false): number {
  const floor = at - windowSec;
  let count = 0;
  for (const entry of receipts) {
    if (entry.peer !== peer) continue;
    if (alertsOnly && !entry.alert) continue;
    if (entry.at > floor && entry.at <= at) count += 1;
  }
  return count;
}

function pruneOffers(state: DmCallGuardState, at: number): void {
  const floor = at - DAY;
  state.incoming = state.incoming.filter((entry) => entry.at > floor).slice(-DM_CALL_GUARD_OFFERS_LIMIT);
  state.outgoing = state.outgoing.filter((entry) => entry.at > floor).slice(-DM_CALL_GUARD_OFFERS_LIMIT);
}

/** Record one inbound offer that passed the policy gates. `alert` is true
 *  only when the offer actually rang (busy responses never alert). */
export function recordIncomingOffer(state: DmCallGuardState, peer: string, at: number, alert: boolean): DmCallGuardState {
  pruneOffers(state, at);
  state.incoming.push({ peer: peer.toLowerCase(), at, alert });
  return state;
}

/** Record one outbound offer (caller-side hygiene accounting). */
export function recordOutgoingOffer(state: DmCallGuardState, peer: string, at: number): DmCallGuardState {
  pruneOffers(state, at);
  state.outgoing.push({ peer: peer.toLowerCase(), at });
  return state;
}

/**
 * Record an explicit decline from THIS identity's callee side: increments the
 * consecutive-decline counter and sets the escalated cool-down window
 * (2m -> 10m -> 1h -> 24h cap). Returns the recorded window.
 */
export function recordDecline(state: DmCallGuardState, peer: string, at: number): { count: number; until: number } {
  const key = peer.toLowerCase();
  const previous = state.declines[key];
  const count = Math.min((previous?.count ?? 0) + 1, DM_CALL_COOLDOWN_SEC.length);
  const until = at + DM_CALL_COOLDOWN_SEC[count - 1];
  state.declines[key] = { count, until, lastAt: at };
  return { count, until };
}

/** An answered call (>= 5 s) resets the peer's decline counter. */
export function resetDeclines(state: DmCallGuardState, peer: string): void {
  delete state.declines[peer.toLowerCase()];
}

/** Seconds until the peer's cool-down expires (0 = no active cool-down). */
export function declineCooldownRemaining(state: DmCallGuardState, peer: string, at: number): number {
  const record = state.declines[peer.toLowerCase()];
  if (!record) return 0;
  return record.until > at ? record.until - at : 0;
}

// ─── Evaluation (ADR §4 exact order) ────────────────────────────────────────

export type DmCallOfferVerdict = 'ring' | 'busy' | 'drop';

export interface EvaluateOfferInput {
  policy: DmCallPolicy;
  /** Peer is on the callee's block list. */
  blocked: boolean;
  /** Follows oracle: `followed` = the callee follows the caller,
   *  `mutual` = the caller also follows the callee. Without an oracle this
   *  is `{followed: false, mutual: false}` and both settings fail CLOSED. */
  follows: { followed: boolean; mutual: boolean };
  guard: DmCallGuardState;
  caller: string;
  at: number;
  /** The callee is already in a call (ringing or connected). */
  inCall: boolean;
}

/**
 * The callee's verdict for one decrypted offer. Order is the ADR's:
 * block -> callsEnabled -> whoMayRing -> cool-down -> budgets -> busy/ring.
 * Everything that is not 'ring' and not 'busy' is a SILENT DROP. The
 * per-pair 3/h budget is the caller-side hygiene check (see the module
 * header); the callee-side budgets are per-caller 10/h + 40/day and the
 * 5/h alert budget.
 */
export function evaluateIncomingOffer(input: EvaluateOfferInput): DmCallOfferVerdict {
  const { policy, blocked, follows, guard, caller, at } = input;
  if (blocked) return 'drop';
  if (!policy.callsEnabled) return 'drop';
  if (policy.whoMayRing === 'nobody') return 'drop';
  if (policy.whoMayRing === 'follows' && !follows.followed) return 'drop';
  if (policy.whoMayRing === 'mutuals' && !(follows.followed && follows.mutual)) return 'drop';
  if (declineCooldownRemaining(guard, caller, at) > 0) return 'drop';
  if (countFrom(guard.incoming, caller, at, HOUR) >= DM_CALL_CALLER_OFFERS_PER_HOUR) return 'drop';
  if (countFrom(guard.incoming, caller, at, DAY) >= DM_CALL_CALLER_OFFERS_PER_DAY) return 'drop';
  if (countFrom(guard.incoming, caller, at, HOUR, true) >= DM_CALL_ALERTS_PER_HOUR) return 'drop';
  if (input.inCall) return 'busy';
  return 'ring';
}

export type DmCallOutgoingAllowance = { ok: true } | { ok: false; reason: 'pair' };

/**
 * Caller-side hygiene before sending an offer: at most 3 outgoing offers to
 * the same pair per rolling hour (the "burst 1" outstanding-offer rule is the
 * session's single-call state). The callee policy is unreadable; this check
 * only spares the pair from accidental spam.
 */
export function checkOutgoingAllowance(guard: DmCallGuardState, peer: string, at: number): DmCallOutgoingAllowance {
  if (countInWindow(guard.outgoing.filter((entry) => entry.peer === peer.toLowerCase()), at, HOUR) >= DM_CALL_PAIR_OFFERS_PER_HOUR) {
    return { ok: false, reason: 'pair' };
  }
  return { ok: true };
}

function defaultStorage(): DmStorageLike | null {
  try {
    return (globalThis as { localStorage?: DmStorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}
