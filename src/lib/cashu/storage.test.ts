import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { addTransaction, loadTransactionsSync } from './storage';

describe('addTransaction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseTx = {
    type: 'send' as const,
    amount: 100,
    memo: 'test',
    mintUrl: 'https://mint.example.com',
    status: 'completed' as const,
  };

  it('generates a crypto.randomUUID id by default', async () => {
    const id = await addTransaction(baseTx, undefined, undefined, { allowPlaintextFallback: true });
    expect(typeof id).toBe('string');
    expect(id).not.toContain('_');
    expect(id.length).toBeGreaterThan(10);

    const txs = loadTransactionsSync({ allowPlaintextFallback: true });
    expect(txs).toHaveLength(1);
    expect(txs[0].id).toBe(id);
  });

  it('falls back to Math.random when crypto.randomUUID throws', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('Insecure context');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const id = await addTransaction(baseTx, undefined, undefined, { allowPlaintextFallback: true });
    expect(typeof id).toBe('string');
    expect(id).toContain('_');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Math.random'));

    const txs = loadTransactionsSync({ allowPlaintextFallback: true });
    expect(txs).toHaveLength(1);
    expect(txs[0].id).toBe(id);

    warnSpy.mockRestore();
  });

  it('appends a timestamp when a generated id collides with an existing transaction', async () => {
    const existingId = 'collision-id';
    localStorage.setItem(
      'freedomid_transactions',
      JSON.stringify([
        { ...baseTx, id: existingId, createdAt: Date.now() - 1000 },
      ]),
    );
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(existingId as `${string}-${string}-${string}-${string}-${string}`);

    const id = await addTransaction(baseTx, undefined, undefined, { allowPlaintextFallback: true });
    expect(id).not.toBe(existingId);
    expect(id.startsWith(`${existingId}_`)).toBe(true);

    const txs = loadTransactionsSync({ allowPlaintextFallback: true });
    expect(txs).toHaveLength(2);
    expect(txs.map((t) => t.id)).toContain(existingId);
    expect(txs.map((t) => t.id)).toContain(id);
  });
});
