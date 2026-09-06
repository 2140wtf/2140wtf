import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { AuthSignQueue } from './authSignQueue';

/** Manually-resolved promise for controlling async ordering in tests. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = reject2;
    function reject2(e: unknown) {
      reject = rej;
      rej(e);
    }
  });
  return { promise, resolve: (v: T) => resolve(v), reject: (e: unknown) => reject(e) };
}

describe('AuthSignQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('C1: same-key callers collapse onto ONE fire invocation', async () => {
    const q = new AuthSignQueue<number>();
    let fires = 0;
    const gate = deferred<number>();
    const p1 = q.collapse('r\nc1', () => {
      fires += 1;
      return gate.promise;
    });
    const p2 = q.collapse('r\nc1', () => {
      fires += 1;
      return Promise.resolve(99);
    });
    const p3 = q.collapse('r\nc1', () => {
      fires += 1;
      return Promise.resolve(99);
    });
    expect(fires).toBe(1);
    gate.resolve(42);
    await Promise.all([p1, p2, p3]);
    expect(fires).toBe(1);
    await expect(p1).resolves.toBe(42);
    await expect(p2).resolves.toBe(42);
    await expect(p3).resolves.toBe(42);
  });

  it('C2: in-flight entry clears after settle — a later same-key call fires again', async () => {
    const q = new AuthSignQueue<string>();
    let fires = 0;
    const first = q.collapse('r\nc1', () => {
      fires += 1;
      return Promise.resolve('a');
    });
    await first;
    const second = q.collapse('r\nc1', () => {
      fires += 1;
      return Promise.resolve('b');
    });
    await expect(second).resolves.toBe('b');
    expect(fires).toBe(2);
  });

  it('C3: full-turn serialization — turn N+1 starts only after turn N completes', async () => {
    const q = new AuthSignQueue<number>();
    const order: string[] = [];
    const gate1 = deferred<void>();
    const gate2 = deferred<void>();

    const t1 = q.enqueue('r', async () => {
      order.push('sign1-start');
      await gate1.promise;
      order.push('sign1-end');
      return 1;
    });
    const t2 = q.enqueue('r', async () => {
      order.push('sign2-start');
      await gate2.promise;
      order.push('sign2-end');
      return 2;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['sign1-start']); // t2 has NOT started while t1 in flight

    gate1.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['sign1-start', 'sign1-end', 'sign2-start']);

    gate2.resolve();
    await Promise.all([t1, t2]);
    expect(order).toEqual(['sign1-start', 'sign1-end', 'sign2-start', 'sign2-end']);
    await expect(t1).resolves.toBe(1);
    await expect(t2).resolves.toBe(2);
  });

  it('C4: guard runs at fire time, before fire, and its await delays the turn', async () => {
    const q = new AuthSignQueue<number>();
    const order: string[] = [];
    const cooldownGate = deferred<void>();

    const t1 = q.enqueue('r', async () => {
      order.push('fire1');
      return 1;
    });
    const t2 = q.enqueue(
      'r',
      async () => {
        order.push('fire2');
        return 2;
      },
      () => cooldownGate.promise, // simulates the 5s cooldown await
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['fire1']);

    cooldownGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([t1, t2]);
    expect(order).toEqual(['fire1', 'fire2']);
    await expect(t2).resolves.toBe(2);
  });

  it('C5: a failed turn does not poison the chain — later turns still run', async () => {
    const q = new AuthSignQueue<number>();
    const t1 = q.enqueue('r', async () => {
      throw new Error('boom');
    });
    let ran = false;
    const t2 = q.enqueue('r', async () => {
      ran = true;
      return 7;
    });
    await expect(t1).rejects.toThrow('boom');
    await expect(t2).resolves.toBe(7);
    expect(ran).toBe(true);
  });

  it('C6: guard rejection fails the turn closed — fire never executes', async () => {
    const q = new AuthSignQueue<number>();
    let fired = false;
    const t1 = q.enqueue(
      'r',
      async () => {
        fired = true;
        return 1;
      },
      () => {
        throw new Error('superseded');
      },
    );
    await expect(t1).rejects.toThrow('superseded');
    expect(fired).toBe(false);
  });

  it('C7: reset drops the chain — the next turn starts a FRESH chain immediately; in-flight entry cleared', async () => {
    const q = new AuthSignQueue<number>();
    const gate = deferred<void>();
    let oldFired = false;
    let newFired = false;
    const t1 = q.enqueue('r', async () => {
      oldFired = true;
      await gate.promise;
      return 1;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(oldFired).toBe(true);

    q.reset('r'); // socket reopen: old turn is NOT cancelled, but the chain is gone
    expect(q.peekInFlight('r\nc')).toBeUndefined();

    // The next turn after reset must NOT wait behind the old in-flight turn —
    // a fresh socket session starts a fresh chain (NostrProvider relies on
    // this; the old sign fails closed on its own supersession guard).
    const t2 = q.enqueue('r', async () => {
      newFired = true;
      return 2;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(newFired).toBe(true);

    gate.resolve();
    await Promise.all([t1, t2]);
    await expect(t2).resolves.toBe(2);
  });

  it('C8: distinct relays do not block each other', async () => {
    const q = new AuthSignQueue<number>();
    const gate = deferred<void>();
    let bFired = false;
    const a = q.enqueue('relayA', async () => {
      await gate.promise;
      return 1;
    });
    const b = q.enqueue('relayB', async () => {
      bFired = true;
      return 2;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(bFired).toBe(true);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it('C9: clear() wipes chains and in-flight entries for all relays', async () => {
    const q = new AuthSignQueue<number>();
    const gate = deferred<void>();
    void q.enqueue('r1', async () => {
      await gate.promise;
      return 1;
    });
    void q.collapse('r2\nc', () => Promise.resolve(5));
    q.clear();
    expect(q.peekInFlight('r2\nc')).toBeUndefined();
    gate.resolve();
  });
});
