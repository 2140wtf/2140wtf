import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRANSACTIONS,
  RAIL_HISTORY_LABEL,
  TX_STORAGE_KEY,
  clearTransactions,
  isTxid,
  loadTransactions,
  onHistoryChange,
  recordRailSend,
  recordTransaction,
} from './walletHistory';

beforeEach(() => {
  localStorage.clear();
});

describe('walletHistory', () => {
  it('records newest first and loads back', () => {
    recordTransaction({ type: 'receive', mintUrl: 'https://mint.example', amountSats: 10 });
    recordTransaction({ type: 'send', mintUrl: 'https://mint.example', amountSats: 5 });
    const txs = loadTransactions();
    expect(txs.map((t) => t.type)).toEqual(['send', 'receive']);
    expect(txs[0].amountSats).toBe(5);
    expect(txs[0].id).toBeTruthy();
    expect(txs[0].at).toBeGreaterThan(0);
  });

  it('caps the log at MAX_TRANSACTIONS', () => {
    for (let i = 0; i < MAX_TRANSACTIONS + 20; i++) {
      recordTransaction({ type: 'receive', mintUrl: 'https://mint.example', amountSats: i + 1 });
    }
    expect(loadTransactions()).toHaveLength(MAX_TRANSACTIONS);
    // Newest survived; the first 20 were evicted.
    expect(loadTransactions()[0].amountSats).toBe(MAX_TRANSACTIONS + 20);
  });

  it('survives corrupt storage with an empty log', () => {
    localStorage.setItem(TX_STORAGE_KEY, '{oops');
    expect(loadTransactions()).toEqual([]);
    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify([{ nope: true }, { type: 'send', mintUrl: '', amountSats: -1, id: 'x', at: 1 }]));
    expect(loadTransactions()).toEqual([]);
  });

  it('clears the log', () => {
    recordTransaction({ type: 'pay', mintUrl: 'https://mint.example', amountSats: 21, feeSats: 1 });
    expect(loadTransactions()).toHaveLength(1);
    clearTransactions();
    expect(loadTransactions()).toEqual([]);
  });

  it('records rail sends with the rail label and a validated txid, and notifies listeners', () => {
    const listener = vi.fn();
    const off = onHistoryChange(listener);
    const txid = 'ab'.repeat(32);
    const entry = recordRailSend('l1', 21_000, txid, 300);
    expect(entry.rail).toBe('l1');
    expect(entry.mintUrl).toBe(RAIL_HISTORY_LABEL.l1);
    expect(entry.txid).toBe(txid);
    expect(entry.feeSats).toBe(300);
    expect(loadTransactions()[0]).toMatchObject({ rail: 'l1', txid, amountSats: 21_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    off();
    recordRailSend('liquid', 1, txid);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('omits a malformed txid and drops unknown rails / txids on load', () => {
    expect(isTxid('ab'.repeat(32))).toBe(true);
    expect(isTxid('zz'.repeat(32))).toBe(false);
    const entry = recordRailSend('liquid', 5, 'not-a-txid');
    expect(entry.txid).toBeUndefined();
    expect(loadTransactions()).toHaveLength(1);

    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify([
      { id: 'x', type: 'send', mintUrl: 'bitcoin-testnet4', amountSats: 1, at: Date.now(), rail: 'btc' },
      { id: 'y', type: 'send', mintUrl: 'bitcoin-testnet4', amountSats: 1, at: Date.now(), rail: 'l1', txid: 'nope' },
      { id: 'z', type: 'send', mintUrl: 'liquid-testnet', amountSats: 1, at: Date.now(), rail: 'liquid', txid: 'cd'.repeat(32) },
    ]));
    const loaded = loadTransactions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('z');
  });

  it('clearTransactions notifies listeners too', () => {
    const listener = vi.fn();
    const off = onHistoryChange(listener);
    recordTransaction({ type: 'receive', mintUrl: 'https://mint.example', amountSats: 1 });
    clearTransactions();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
});
