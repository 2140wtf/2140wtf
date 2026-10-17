// dmCallGuard: the ADR §4 evaluation matrix (silent drop order, busy honesty,
// budgets, cool-down escalation) plus the caller-side hygiene check. The
// evaluation is pure over the guard state + policy, so every branch is
// exercised with crafted state; storage round-trips are covered too.

import { describe, expect, it } from 'vitest';
import {
  DM_CALL_ALERTS_PER_HOUR,
  DM_CALL_ANSWER_DECLINE_SEC,
  DM_CALL_CALLER_OFFERS_PER_DAY,
  DM_CALL_CALLER_OFFERS_PER_HOUR,
  DM_CALL_COOLDOWN_SEC,
  DM_CALL_PAIR_OFFERS_PER_HOUR,
  DM_CALL_RING_TIMEOUT_SEC,
  checkOutgoingAllowance,
  countInWindow,
  declineCooldownRemaining,
  defaultDmCallGuardState,
  evaluateIncomingOffer,
  loadDmCallGuard,
  recordDecline,
  recordIncomingOffer,
  recordOutgoingOffer,
  resetDeclines,
  sanitizeDmCallGuardState,
  saveDmCallGuard,
  type DmCallGuardState,
} from './dmCallGuard';
import { DEFAULT_DM_CALL_POLICY, type DmCallPolicy } from './dmCallStore';
import type { DmStorageLike } from './dmStore';

const ME = 'ab'.repeat(32);
const CALLER = '11'.repeat(32);

const AT = 1_700_000_000;

function policy(patch: Partial<DmCallPolicy> = {}): DmCallPolicy {
  return { ...DEFAULT_DM_CALL_POLICY, callsEnabled: true, whoMayRing: 'anyone', ...patch };
}

function evaluate(
  overrides: {
    policy?: DmCallPolicy;
    blocked?: boolean;
    follows?: { followed: boolean; mutual: boolean };
    guard?: DmCallGuardState;
    inCall?: boolean;
    at?: number;
  } = {},
) {
  return evaluateIncomingOffer({
    policy: overrides.policy ?? policy(),
    blocked: overrides.blocked ?? false,
    follows: overrides.follows ?? { followed: false, mutual: false },
    guard: overrides.guard ?? defaultDmCallGuardState(),
    caller: CALLER,
    at: overrides.at ?? AT,
    inCall: overrides.inCall ?? false,
  });
}

describe('dmCallGuard — constants match the ADR', () => {
  it('pins the ADR numbers', () => {
    expect(DM_CALL_RING_TIMEOUT_SEC).toBe(30);
    expect(DM_CALL_ANSWER_DECLINE_SEC).toBe(5);
    expect([...DM_CALL_COOLDOWN_SEC]).toEqual([120, 600, 3600, 86_400]);
    expect(DM_CALL_PAIR_OFFERS_PER_HOUR).toBe(3);
    expect(DM_CALL_CALLER_OFFERS_PER_HOUR).toBe(10);
    expect(DM_CALL_CALLER_OFFERS_PER_DAY).toBe(40);
    expect(DM_CALL_ALERTS_PER_HOUR).toBe(5);
  });
});

describe('dmCallGuard — evaluation order (block → callsEnabled → whoMayRing → cool-down → budgets)', () => {
  it('blocked rings are dropped even when every other gate would pass', () => {
    expect(evaluate({ blocked: true })).toBe('drop');
    // A blocked offer consumes no budget (it never reaches accounting).
    const guard = defaultDmCallGuardState();
    evaluate({ blocked: true, guard, policy: policy({ whoMayRing: 'anyone' }) });
    expect(guard.incoming).toHaveLength(0);
  });

  it('callsEnabled=false drops (opt-in, default off)', () => {
    expect(evaluate({ policy: policy({ callsEnabled: false }) })).toBe('drop');
    expect(evaluateIncomingOffer({
      policy: DEFAULT_DM_CALL_POLICY,
      blocked: false,
      follows: { followed: false, mutual: false },
      guard: defaultDmCallGuardState(),
      caller: CALLER,
      at: AT,
      inCall: false,
    })).toBe('drop');
  });

  it('whoMayRing matrix', () => {
    expect(evaluate({ policy: policy({ whoMayRing: 'nobody' }) })).toBe('drop');
    expect(evaluate({ policy: policy({ whoMayRing: 'follows' }) })).toBe('drop');
    expect(evaluate({ policy: policy({ whoMayRing: 'follows' }), follows: { followed: true, mutual: false } })).toBe('ring');
    expect(evaluate({ policy: policy({ whoMayRing: 'mutuals' }), follows: { followed: true, mutual: false } })).toBe('drop');
    expect(evaluate({ policy: policy({ whoMayRing: 'mutuals' }), follows: { followed: true, mutual: true } })).toBe('ring');
    expect(evaluate({ policy: policy({ whoMayRing: 'anyone' }) })).toBe('ring');
  });

  it('silent drop is indistinguishable from offline: a refused ring carries NO verdict to respond to', () => {
    // Every refusal returns 'drop' - the caller (the session) never sends a
    // response. 'busy' is the ONLY informational negative.
    for (const input of [
      { blocked: true },
      { policy: policy({ callsEnabled: false }) },
      { policy: policy({ whoMayRing: 'nobody' }) },
    ]) {
      expect(evaluate(input)).toBe('drop');
    }
  });
});

describe('dmCallGuard — budgets', () => {
  it('the pair budget lives caller-side (3/h hygiene), so the callee budgets stay reachable', () => {
    // 3 outgoing offers spend the caller-side pair budget...
    const guard = defaultDmCallGuardState();
    for (let i = 0; i < 3; i += 1) recordOutgoingOffer(guard, CALLER, AT + i);
    expect(checkOutgoingAllowance(guard, CALLER, AT + 3)).toEqual({ ok: false, reason: 'pair' });
    // ...but the CALLEE-side evaluation still rings a 4th offer (its own
    // budgets are per-caller 10/h + alert 5/h).
    for (let i = 0; i < 3; i += 1) recordIncomingOffer(guard, CALLER, AT + i, true);
    expect(evaluate({ guard, at: AT + 3 })).toBe('ring');
  });

  it('per-caller 10 offers/h and 40/day ceilings', () => {
    const perHour = defaultDmCallGuardState();
    for (let i = 0; i < DM_CALL_CALLER_OFFERS_PER_HOUR; i += 1) {
      recordIncomingOffer(perHour, CALLER, AT - 10 + i, false);
    }
    expect(evaluate({ guard: perHour })).toBe('drop');
    // A different caller is unaffected.
    expect(evaluateIncomingOffer({
      policy: policy(),
      blocked: false,
      follows: { followed: false, mutual: false },
      guard: perHour,
      caller: '22'.repeat(32),
      at: AT,
      inCall: false,
    })).toBe('ring');

    const perDay = defaultDmCallGuardState();
    for (let i = 0; i < DM_CALL_CALLER_OFFERS_PER_DAY; i += 1) {
      recordIncomingOffer(perDay, CALLER, AT - 7200 + i, false);
    }
    expect(evaluate({ guard: perDay })).toBe('drop');
  });

  it('callee alert budget 5/h: excess rings are dropped silently (never busy)', () => {
    const guard = defaultDmCallGuardState();
    for (let i = 0; i < DM_CALL_ALERTS_PER_HOUR; i += 1) {
      recordIncomingOffer(guard, CALLER, AT - 5 + i, true);
    }
    expect(evaluate({ guard })).toBe('drop');
    // A sixth offer inside the hour cannot ring...
    expect(evaluate({ guard, at: AT })).toBe('drop');
    // ...and outside the hour it rings again.
    expect(evaluate({ guard, at: AT + 3601 })).toBe('ring');
    // Busy answers never consume the alert budget: quiet offers leave it
    // untouched, so the callee can still be reached once free.
    const quiet = defaultDmCallGuardState();
    for (let i = 0; i < DM_CALL_ALERTS_PER_HOUR + 3; i += 1) {
      recordIncomingOffer(quiet, CALLER, AT - 5 + i, false);
    }
    expect(evaluate({ guard: quiet, inCall: true })).toBe('busy');
  });

  it('windows are rolling and half-open at the floor', () => {
    expect(countInWindow([{ at: AT - 3600 }, { at: AT - 3599 }, { at: AT }], AT, 3600)).toBe(2);
  });
});

describe('dmCallGuard — busy honesty', () => {
  it('busy only when the offer would have rung and the callee is in a call', () => {
    expect(evaluate({ inCall: true })).toBe('busy');
    expect(evaluate({ inCall: true, blocked: true })).toBe('drop');
    expect(evaluate({ inCall: true, policy: policy({ callsEnabled: false }) })).toBe('drop');
    expect(evaluate({ inCall: true, policy: policy({ whoMayRing: 'nobody' }) })).toBe('drop');
    const guard = defaultDmCallGuardState();
    for (let i = 0; i < DM_CALL_ALERTS_PER_HOUR; i += 1) recordIncomingOffer(guard, CALLER, AT - 5 + i, true);
    expect(evaluate({ inCall: true, guard })).toBe('drop'); // budget-refused, not busy
  });
});

describe('dmCallGuard — cool-down escalation', () => {
  it('2m → 10m → 1h → 24h cap, and the remaining window is reported', () => {
    const guard = defaultDmCallGuardState();
    const first = recordDecline(guard, CALLER, AT);
    expect(first).toEqual({ count: 1, until: AT + 120 });
    const second = recordDecline(guard, CALLER, AT + 200);
    expect(second).toEqual({ count: 2, until: AT + 200 + 600 });
    const third = recordDecline(guard, CALLER, AT + 1_000);
    expect(third).toEqual({ count: 3, until: AT + 1_000 + 3_600 });
    const fourth = recordDecline(guard, CALLER, AT + 5_000);
    expect(fourth).toEqual({ count: 4, until: AT + 5_000 + 86_400 });
    const fifth = recordDecline(guard, CALLER, AT + 100_000);
    expect(fifth.count).toBe(4); // capped
    expect(declineCooldownRemaining(guard, CALLER, AT + 100_001)).toBe(86_400 - 1);
  });

  it('a cool-down drops offers silently (no busy, no response) and expires', () => {
    const guard = defaultDmCallGuardState();
    recordDecline(guard, CALLER, AT);
    expect(evaluate({ guard, at: AT + 60 })).toBe('drop');
    expect(evaluate({ guard, at: AT + 60, inCall: true })).toBe('drop'); // cool-down precedes busy
    expect(evaluate({ guard, at: AT + 121 })).toBe('ring');
  });

  it('an answered call (>= 5 s) resets the counter', () => {
    const guard = defaultDmCallGuardState();
    recordDecline(guard, CALLER, AT);
    resetDeclines(guard, CALLER);
    expect(declineCooldownRemaining(guard, CALLER, AT + 1)).toBe(0);
    expect(evaluate({ guard, at: AT + 1 })).toBe('ring');
  });
});

describe('dmCallGuard — caller-side hygiene', () => {
  it('allows at most 3 outgoing offers per pair per hour', () => {
    const guard = defaultDmCallGuardState();
    for (let i = 0; i < 3; i += 1) {
      expect(checkOutgoingAllowance(guard, CALLER, AT + i)).toEqual({ ok: true });
      recordOutgoingOffer(guard, CALLER, AT + i);
    }
    expect(checkOutgoingAllowance(guard, CALLER, AT + 4)).toEqual({ ok: false, reason: 'pair' });
    expect(checkOutgoingAllowance(guard, '22'.repeat(32), AT + 4)).toEqual({ ok: true });
    expect(checkOutgoingAllowance(guard, CALLER, AT + 3601)).toEqual({ ok: true });
  });
});

describe('dmCallGuard — storage', () => {
  function fakeStorage(): DmStorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }

  it('round-trips per identity; invalid pubkey reads/writes nothing; corruption degrades empty', () => {
    const storage = fakeStorage();
    const guard = loadDmCallGuard(ME, storage);
    recordIncomingOffer(guard, CALLER, AT, true);
    recordDecline(guard, CALLER, AT);
    recordOutgoingOffer(guard, CALLER, AT);
    saveDmCallGuard(ME, guard, storage);
    const loaded = loadDmCallGuard(ME, storage);
    expect(loaded.incoming).toHaveLength(1);
    expect(loaded.incoming[0]).toMatchObject({ peer: CALLER, at: AT, alert: true });
    expect(loaded.declines[CALLER]).toMatchObject({ count: 1, until: AT + 120 });
    expect(loaded.outgoing).toHaveLength(1);
    // Other identity: empty.
    expect(loadDmCallGuard('22'.repeat(32), storage)).toEqual(defaultDmCallGuardState());
    // Invalid pubkey: write is a no-op.
    const before = storage.map.size;
    saveDmCallGuard('junk', guard, storage);
    expect(storage.map.size).toBe(before);
    // Corruption.
    storage.setItem(`baofund:dmcall:guard:${ME}`, '{oops');
    expect(loadDmCallGuard(ME, storage)).toEqual(defaultDmCallGuardState());
    expect(sanitizeDmCallGuardState({ version: 9 })).toBeNull();
    expect(sanitizeDmCallGuardState(null)).toBeNull();
  });
});
