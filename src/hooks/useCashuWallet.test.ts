import { describe, expect, it } from 'vitest';

import { acquireMutex } from './useCashuWallet';

describe('acquireMutex FIFO serialization', () => {
  it('queues concurrent callers so only one runs at a time', async () => {
    const mutexRef = { current: null as Promise<void> | null };
    const order: number[] = [];

    const first = (async () => {
      const release = await acquireMutex(mutexRef);
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
    })();

    const second = (async () => {
      const release = await acquireMutex(mutexRef);
      order.push(2);
      release();
    })();

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('allows sequential callers to acquire and release independently', async () => {
    const mutexRef = { current: null as Promise<void> | null };
    const release1 = await acquireMutex(mutexRef);
    expect(mutexRef.current).not.toBeNull();
    release1();
    expect(mutexRef.current).toBeNull();

    const release2 = await acquireMutex(mutexRef);
    expect(mutexRef.current).not.toBeNull();
    release2();
    expect(mutexRef.current).toBeNull();
  });
});
