// src/wallet/cashuWallet.test.ts
//
// Tests for the Stored Wallet module's PUBLIC operations (the whole
// interface): spendFromStoredWallet, receiveIntoStoredWallet,
// mergeStoredProofs, switchStoredMint, onStoreChange, plus the read helpers.
// The mint/network edge (@cashu/cashu-ts classes) is mocked; tokens are
// built with cashu-ts's own encoder so the decode path is exercised for real.

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { getDecodedToken, getEncodedToken } from 'cashu-ts3';
import type { Proof } from 'cashu-ts3';
import { bytesToBase64Url } from '../lib/cashu/base64';

/** Mutable behavior for the fake Wallet instances the module constructs. */
let walletImpl: {
  send: (...args: never[]) => Promise<unknown>;
  receive: (...args: never[]) => Promise<unknown>;
  checkProofsStates: (...args: never[]) => Promise<unknown>;
  restore: (...args: never[]) => Promise<unknown>;
  createMintQuote: (...args: never[]) => Promise<unknown>;
  checkMintQuote: (...args: never[]) => Promise<unknown>;
  checkMeltQuote: (...args: never[]) => Promise<unknown>;
  mintProofs: (...args: never[]) => Promise<unknown>;
  createMeltQuote: (...args: never[]) => Promise<unknown>;
  meltProofs: (...args: never[]) => Promise<unknown>;
} = {
  send: vi.fn(),
  receive: vi.fn(),
  checkProofsStates: vi.fn(async () => []),
  restore: vi.fn(async () => ({ proofs: [] })),
  createMintQuote: vi.fn(),
  checkMintQuote: vi.fn(),
  checkMeltQuote: vi.fn(async () => ({ state: 'UNPAID' })),
  mintProofs: vi.fn(),
  createMeltQuote: vi.fn(),
  meltProofs: vi.fn(),
};

vi.mock('cashu-ts3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cashu-ts3')>();
  class FakeMint {
    mintUrl: string;
    constructor(url: string) {
      this.mintUrl = url;
    }
  }
  /** cashu-ts 3.x shape: Mint/Wallet + async loadMint + internal counter source. */
  class FakeWallet {
    mint: FakeMint;
    keysetId = '00'.repeat(8);
    private counterSource?: {
      reserve: (keysetId: string, n: number) => Promise<{ start: number; count: number }>;
      advanceToAtLeast: (keysetId: string, minNext: number) => Promise<void>;
    };
    constructor(mint: FakeMint, options?: { counterSource?: never }) {
      this.mint = mint;
      this.counterSource = options?.counterSource as never;
    }
    async loadMint() {}
    /** Mirror the real wallet's per-operation deterministic reservations. */
    private async reserve(n: number): Promise<void> {
      if (n > 0 && this.counterSource) await this.counterSource.reserve(this.keysetId, n);
    }
    async send(...args: never[]) {
      const result = (await walletImpl.send(...args)) as { keep?: unknown[]; send?: unknown[] } | undefined;
      await this.reserve((result?.keep?.length ?? 0) + (result?.send?.length ?? 0));
      return result;
    }
    async receive(...args: never[]) {
      const result = (await walletImpl.receive(...args)) as unknown[] | undefined;
      await this.reserve(Array.isArray(result) ? result.length : 0);
      return result;
    }
    async checkProofsStates(...args: never[]) {
      return walletImpl.checkProofsStates(...args);
    }
    async restore(...args: never[]) {
      return walletImpl.restore(...args);
    }
    async createMintQuote(...args: never[]) {
      return walletImpl.createMintQuote(...args);
    }
    async checkMintQuote(...args: never[]) {
      return walletImpl.checkMintQuote(...args);
    }
    async checkMeltQuote(...args: never[]) {
      return walletImpl.checkMeltQuote(...args);
    }
    async mintProofs(...args: never[]) {
      const result = (await walletImpl.mintProofs(...args)) as unknown[] | undefined;
      await this.reserve(Array.isArray(result) ? result.length : 0);
      return result;
    }
    async createMeltQuote(...args: never[]) {
      return walletImpl.createMeltQuote(...args);
    }
    async meltProofs(...args: never[]) {
      const result = (await walletImpl.meltProofs(...args)) as { change?: unknown[] } | undefined;
      // Real NUT-08 reservation: ceil(log2(leftover)) || 1 blanks when there
      // is a fee-reserve leftover.
      const [quote, selected] = args as unknown as [{ amount: number }, Array<{ amount: number }>];
      const leftover = Math.max(0, selected.reduce((sum, p) => sum + p.amount, 0) - quote.amount);
      await this.reserve(leftover > 0 ? Math.ceil(Math.log2(Math.max(1, leftover))) || 1 : 0);
      return result;
    }
  }
  // Keep real encode/decode so defensive validation runs for real.
  return { ...actual, Mint: FakeMint as never, Wallet: FakeWallet as never };
});

import {
  completeLightningTopUp,
  createLightningTopUp,
  loadPendingTopUp,
  hydrateStoredWallet,
  listStoredMints,
  loadStoredWallet,
  mergeStoredProofs,
  onStoreChange,
  payLightningQuote,
  quoteLightningPayment,
  receiveIntoStoredWallet,
  removeStoredMint,
  spendFromStoredWallet,
  sumProofs,
  switchStoredMint,
  totalStoredBalance,
  type PendingOp,
} from './cashuWallet';
import { loadTransactions } from './walletHistory';

const MINT = 'https://mint.example.com';
const STORAGE_KEY = 'bao-fund-wallet';
const DEFAULT_MINT = 'https://mint.minibits.cash/Bitcoin';

/** A proof shaped like what cashu-ts actually produces/accepts. */
function proof(secret: string, amount: number) {
  return { id: '00' + '0'.repeat(62), C: '02' + '0'.repeat(64), secret, amount };
}

function encodeToken(mint: string, proofs: Proof[]): string {
  return getEncodedToken({ mint, proofs, unit: 'sat' });
}

function seed(mintUrl: string, proofs: Proof[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl, proofs }));
}

/** Stub the Web Locks API (absent in jsdom) recording each request. */
function stubLocks(): ReturnType<typeof vi.fn> {
  const request = vi.fn((_name: string, cb: () => unknown) => cb());
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return request;
}

afterEach(() => {
  // @ts-expect-error removing the per-test stub
  delete navigator.locks;
});

beforeEach(() => {
  localStorage.clear();
  walletImpl = {
    send: vi.fn(),
    receive: vi.fn(),
    checkProofsStates: vi.fn(async () => []),
    restore: vi.fn(async () => ({ proofs: [] })),
    createMintQuote: vi.fn(),
    checkMintQuote: vi.fn(),
    checkMeltQuote: vi.fn(async () => ({ state: 'UNPAID' })),
    mintProofs: vi.fn(),
    createMeltQuote: vi.fn(),
    meltProofs: vi.fn(),
  };
});

/** A crash-journal marker for a spend that consumed `inputs`. */
function seedPending(over: Partial<PendingOp> = {}): PendingOp {
  const pending: PendingOp = {
    kind: 'spend',
    inputs: [proof('a', 10)],
    counterStart: 0,
    keysetId: '00'.repeat(8),
    at: Date.now(),
    ...over,
  };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ mintUrl: MINT, proofs: [], seed: 'ab'.repeat(32), counter: 0, pending }),
  );
  return pending;
}

describe('loadStoredWallet (read)', () => {
  it('defaults to the configured mint when nothing is stored', () => {
    const state = loadStoredWallet();
    expect(state.mintUrl).toBe(DEFAULT_MINT);
    expect(state.proofs).toEqual([]);
  });
  it('survives corrupt JSON with a clean default', () => {
    localStorage.setItem(STORAGE_KEY, '{oops');
    const state = loadStoredWallet();
    expect(state.mintUrl).toBe(DEFAULT_MINT);
    expect(state.proofs).toEqual([]);
  });
});

describe('sumProofs', () => {
  it('sums positive amounts and ignores missing ones', () => {
    expect(sumProofs([proof('a', 10), proof('b', 20)])).toBe(30);
    expect(sumProofs([{ id: 'x', C: 'y', secret: 'z', amount: 0 } as Proof])).toBe(0);
  });
});

describe('receiveIntoStoredWallet', () => {
  it('adopts a token from another mint into its own bucket (multi-mint)', async () => {
    walletImpl.receive = vi.fn(async () => [proof('r-other', 10)]);
    const token = encodeToken('https://other.example.com', [proof('a', 10)]);
    const res = await receiveIntoStoredWallet(token);
    expect(res.receivedSats).toBe(10);
    expect(res.mintUrls).toEqual(['https://other.example.com']);
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(DEFAULT_MINT); // active mint unchanged
    expect(stored.proofs).toEqual([]);
    expect(stored.mints['https://other.example.com'].proofs.map((p) => p.secret)).toEqual(['r-other']);
  });
  it('spends from the requested mint, not the active one', async () => {
    walletImpl.receive = vi.fn(async () => [proof('other-proof', 20)]);
    await receiveIntoStoredWallet(encodeToken('https://other.example.com', [proof('b', 20)]));
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('sent', 20)] }));
    const res = await spendFromStoredWallet(20, 'https://other.example.com');
    expect(res.mintUrl).toBe('https://other.example.com');
    expect(getDecodedToken(res.token).mint).toBe('https://other.example.com');
    expect(loadStoredWallet().mintUrl).toBe(DEFAULT_MINT); // active untouched
  });
  it('persists redeemed proofs atomically and reports balances', async () => {
    const returned = [proof('r1', 10)];
    walletImpl.receive = vi.fn(async () => returned);
    const token = encodeToken(DEFAULT_MINT, [proof('t1', 10)]);
    const res = await receiveIntoStoredWallet(token);
    expect(res.receivedSats).toBe(10);
    expect(res.balanceAfter).toBe(10);
    expect(loadStoredWallet().proofs).toEqual(returned);
  });
  it('forwards P2PK unlock options to the mint swap', async () => {
    walletImpl.receive = vi.fn(async () => [proof('r', 5)]);
    await receiveIntoStoredWallet(encodeToken(DEFAULT_MINT, [proof('x', 5)]), { privkey: 'ab'.repeat(32) });
    expect(walletImpl.receive).toHaveBeenCalledWith(expect.any(String), { privkey: 'ab'.repeat(32), keysetId: '00'.repeat(8) });
  });

  it('rejects a multi-entry v3 token without journaling (cashu-ts 2.9.0 limitation)', async () => {
    // Upstream decodeVersionA throws "Multi entry token are not supported";
    // BAO fails closed at the defensive boundary instead of hand-parsing.
    const json = JSON.stringify({
      token: [
        { mint: MINT, proofs: [proof('s1', 10)] },
        { mint: MINT, proofs: [proof('s2', 10)] },
      ],
      unit: 'sat',
    });
    const token = `cashuA${bytesToBase64Url(new TextEncoder().encode(json))}`;
    await expect(receiveIntoStoredWallet(token)).rejects.toThrow(/defensive validation/);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // no journal marker written
    expect(walletImpl.receive).not.toHaveBeenCalled();
  });
});

describe('spendFromStoredWallet', () => {
  it('rejects non-positive or fractional amounts before touching the mint', async () => {
    await expect(spendFromStoredWallet(0)).rejects.toThrow(/positive/);
    await expect(spendFromStoredWallet(1.5)).rejects.toThrow(/positive/);
    await expect(spendFromStoredWallet(-5)).rejects.toThrow(/positive/);
  });
  it('throws when the stored balance cannot cover the amount', async () => {
    seed(MINT, [proof('a', 10)]);
    await expect(spendFromStoredWallet(100)).rejects.toThrow(/Insufficient/);
    expect(loadStoredWallet().proofs).toHaveLength(1); // unchanged on failure
  });
  it('greedy-selects, embeds send proofs in the token, and carries the unselected tail', async () => {
    const proofs = [proof('a', 10), proof('b', 20), proof('c', 30)];
    seed(MINT, proofs);
    // Amount 25 → a+b selected (30 ≥ 25); c stays behind as the tail.
    walletImpl.send = vi.fn(async () => ({ keep: [proof('k', 5)], send: [proof('s1', 10), proof('s2', 15)] }));
    const { token, balanceAfter } = await spendFromStoredWallet(25);
    expect(walletImpl.send).toHaveBeenCalledWith(25, [proofs[0], proofs[1]], { keysetId: '00'.repeat(8) });
    const decoded = getDecodedToken(token);
    expect(decoded.mint).toBe(MINT);
    expect(decoded.proofs).toHaveLength(2);
    // Persisted change = keep + unselected tail ('c'), NOT just keep.
    const stored = loadStoredWallet().proofs;
    expect(stored.map((p) => p.secret)).toEqual(['k', 'c']);
    expect(balanceAfter).toBe(35);
  });
});

describe('mergeStoredProofs (multi-mint)', () => {
  it('keeps the funded active mint and gives every mint its own bucket', async () => {
    seed(MINT, [proof('local', 10)]);
    const res = await mergeStoredProofs(
      { [MINT]: [proof('restored', 21)], 'https://other.example.com': [proof('x', 99)] },
      'https://other.example.com',
    );
    expect(res.activeMint).toBe(MINT); // funded active mint wins
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(MINT);
    expect(stored.proofs.map((p) => p.secret)).toEqual(['local', 'restored']);
    expect(stored.mints['https://other.example.com'].proofs.map((p) => p.secret)).toEqual(['x']);
  });
  it('fresh device adopts the preferred mint, deduped by secret', async () => {
    const res = await mergeStoredProofs(
      { [MINT]: [{ ...proof('dup', 7), C: '02' + 'f'.repeat(64) }, proof('dup', 7)] },
      MINT,
    );
    expect(res.activeMint).toBe(MINT);
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(MINT);
    expect(stored.proofs).toHaveLength(1); // duplicate secret dropped
    expect(stored.proofs[0].C.startsWith('02ff')).toBe(true); // restored copy kept
  });
  it('falls back to the first key when no preferred mint given', async () => {
    const res = await mergeStoredProofs({ [MINT]: [proof('q', 3)] });
    expect(res.activeMint).toBe(MINT);
    expect(res.balanceAfter).toBe(3);
  });
});

describe('switchStoredMint (multi-mint active selector)', () => {
  it('switches an empty wallet to a new mint', async () => {
    seed(MINT, []);
    await switchStoredMint('https://next.example.com');
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe('https://next.example.com');
    expect(stored.proofs).toEqual([]);
    expect(stored.mints['https://next.example.com']).toEqual({ proofs: [] });
  });
  it.each([10, 0])('keeps stored proofs in their own bucket when switching (amount %s)', async amount => {
    seed(MINT, [proof('a', amount)]);
    await switchStoredMint('https://next.example.com');
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe('https://next.example.com');
    expect(stored.proofs).toEqual([]); // active mint starts empty
    expect(stored.mints[MINT].proofs.map((p) => p.secret)).toEqual(['a']);
    expect(walletImpl.send).not.toHaveBeenCalled();
    expect(walletImpl.receive).not.toHaveBeenCalled();
  });
  it('rejects a non-https mint URL when adding a new mint', async () => {
    seed(MINT, []);
    await expect(switchStoredMint('http://insecure.example.com')).rejects.toThrow(/https/);
    await expect(switchStoredMint('https://localhost:4448')).rejects.toThrow(/https/);
  });
  it('keeps a funded wallet unchanged when selecting its current mint', async () => {
    seed(MINT, [proof('a', 10)]);
    const raw = localStorage.getItem(STORAGE_KEY);
    await switchStoredMint(MINT);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it.each(['broken json', '{}', '{"mintUrl":"https://mint.example.com","proofs":null}'])('preserves unreadable recovery data: %s', async raw => {
    localStorage.setItem(STORAGE_KEY, raw);
    await expect(switchStoredMint('https://next.example.com')).rejects.toThrow(/Wallet data/);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('serializes a queued receive before a switch and keeps both', async () => {
    seed(MINT, []);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    walletImpl.receive = vi.fn(async () => { await gate; return [proof('received', 10)]; });
    const receiving = receiveIntoStoredWallet(encodeToken(MINT, [proof('incoming', 10)]));
    const switching = switchStoredMint('https://next.example.com');
    release(); await receiving; await switching;
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe('https://next.example.com');
    expect(stored.mints[MINT].proofs.map((p) => p.secret)).toEqual(['received']);
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('received', 10)] }));
    const result = await spendFromStoredWallet(10, MINT);
    expect(getDecodedToken(result.token).mint).toBe(MINT);
  });
});

describe('corrupt wallet storage is never overwritten by any mutation', () => {
  const CORRUPT = '{oops';
  const MALFORMED = '{}';

  const mutations: Record<string, () => Promise<unknown>> = {
    spendFromStoredWallet: () => spendFromStoredWallet(10),
    receiveIntoStoredWallet: () => receiveIntoStoredWallet(encodeToken(MINT, [proof('t', 10)])),
    mergeStoredProofs: () => mergeStoredProofs({ [MINT]: [proof('r', 10)] }),
    removeStoredMint: () => removeStoredMint(MINT),
    switchStoredMint: () => switchStoredMint('https://next.example.com'),
    completeLightningTopUp: () => completeLightningTopUp('mq-1'),
    payLightningQuote: () => payLightningQuote({ quote: 'melt-1', amount: 21, fee_reserve: 1 } as never),
    hydrateStoredWallet: () => hydrateStoredWallet(),
  };

  it.each(Object.entries(mutations))('%s refuses unparseable bytes and never touches the mint', async (_name, run) => {
    localStorage.setItem(STORAGE_KEY, CORRUPT);
    await expect(run()).rejects.toThrow(/Wallet data/);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(CORRUPT); // bytes preserved for recovery
    expect(walletImpl.send).not.toHaveBeenCalled();
    expect(walletImpl.receive).not.toHaveBeenCalled();
    expect(walletImpl.mintProofs).not.toHaveBeenCalled();
    expect(walletImpl.meltProofs).not.toHaveBeenCalled();
  });

  it.each(Object.entries(mutations))('%s refuses parseable-but-malformed storage', async (_name, run) => {
    localStorage.setItem(STORAGE_KEY, MALFORMED);
    await expect(run()).rejects.toThrow(/Wallet data/);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(MALFORMED);
  });

  it('reads stay non-destructive: a corrupt store still degrades to a clean default', () => {
    localStorage.setItem(STORAGE_KEY, CORRUPT);
    expect(loadStoredWallet().proofs).toEqual([]);
    expect(listStoredMints().length).toBeGreaterThan(0);
  });

  it('a valid legacy store is still mutable after the guard', async () => {
    seed(MINT, [proof('a', 10)]);
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('a', 10)] }));
    const { token } = await spendFromStoredWallet(10);
    expect(getDecodedToken(token).proofs).toHaveLength(1);
  });
});

describe('removeStoredMint', () => {
  it('refuses to remove a mint that still holds proofs', async () => {
    seed(MINT, [proof('a', 10)]);
    await expect(removeStoredMint(MINT)).rejects.toThrow(/holds proofs/);
    expect(loadStoredWallet().mints[MINT].proofs).toHaveLength(1);
  });
  it('removes an empty mint and falls back to another active mint', async () => {
    seed(MINT, []);
    await switchStoredMint('https://next.example.com');
    await removeStoredMint('https://next.example.com');
    const stored = loadStoredWallet();
    expect(stored.mints['https://next.example.com']).toBeUndefined();
    expect(stored.mintUrl).toBe(MINT);
  });
});

describe('listStoredMints / totalStoredBalance', () => {
  it('lists every mint with its balance, active first', async () => {
    seed(MINT, [proof('a', 10)]);
    walletImpl.receive = vi.fn(async () => [proof('r', 20)]);
    await receiveIntoStoredWallet(encodeToken('https://other.example.com', [proof('b', 20)]));
    const mints = listStoredMints();
    expect(mints[0].mintUrl).toBe(MINT);
    expect(mints[0].active).toBe(true);
    expect(mints.find((m) => m.mintUrl === 'https://other.example.com')?.balanceSats).toBe(20);
    expect(totalStoredBalance()).toBe(30);
  });
});

describe('onStoreChange', () => {
  it('fires after each committed write and stops after unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = onStoreChange(cb);
    walletImpl.receive = vi.fn(async () => [proof('r', 1)]);
    await switchStoredMint('https://n.example.com');
    await receiveIntoStoredWallet(encodeToken('https://n.example.com', [proof('t', 1)]));
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    walletImpl.receive = vi.fn(async () => [proof('r2', 1)]);
    await receiveIntoStoredWallet(encodeToken('https://n.example.com', [proof('t2', 1)]));
    expect(cb).toHaveBeenCalledTimes(2); // no further notifications
  });
  it('fires when ANOTHER tab writes the same storage key, not other keys', () => {
    const cb = vi.fn();
    onStoreChange(cb);
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }));
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it('a throwing listener does not break subsequent listeners or the write', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    onStoreChange(() => {
      throw new Error('listener bug');
    });
    onStoreChange(good);
    walletImpl.receive = vi.fn(async () => [proof('r', 1)]);
    const res = await receiveIntoStoredWallet(encodeToken(DEFAULT_MINT, [proof('t', 1)]));
    expect(res.balanceAfter).toBe(1); // write committed despite listener throw
    expect(good).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('serialized operations', () => {
  it('overlapping spend + receive never lose either write', async () => {
    const proofs = [proof('a', 10), proof('b', 20)];
    seed(MINT, proofs);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sendResult = { keep: [proof('k', 30)], send: [proof('s', 10)] };
    walletImpl.send = vi.fn(async () => {
      await gate; // hold the spend mid-flight across the mint round-trip
      return sendResult;
    });
    walletImpl.receive = vi.fn(async () => [proof('rr', 40)]);
    const spendPromise = spendFromStoredWallet(5);
    // Enqueued BEHIND the in-flight spend: must observe its committed change.
    const receivePromise = receiveIntoStoredWallet(encodeToken(MINT, [proof('rr', 40)]));
    release();
    await Promise.all([spendPromise, receivePromise]);
    const secrets = loadStoredWallet().proofs.map((p) => p.secret);
    // spend(5) selects 'a' → change keeps 'k' + unselected tail 'b';
    // the queued receive then appends 'rr'. All three survive.
    expect(secrets).toEqual(['k', 'b', 'rr']);
  });
});

describe('crash recovery (R11)', () => {
  it('no pending marker → no-op', async () => {
    seed(MINT, [proof('a', 10)]);
    const res = await hydrateStoredWallet();
    expect(res.recovered).toBe(0);
    expect(walletImpl.checkProofsStates).not.toHaveBeenCalled();
  });

  it('a swap that never reached the mint keeps the inputs and drops the marker', async () => {
    seedPending();
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'UNSPENT' }]);
    const res = await hydrateStoredWallet();
    expect(res.recovered).toBe(0);
    expect(loadStoredWallet().pending).toBeUndefined();
    expect(loadStoredWallet().proofs.map((p) => p.secret)).toEqual([]); // inputs were never committed
  });

  it('a committed swap recovers the deterministic change via restore (no double-spend)', async () => {
    seedPending();
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }]);
    walletImpl.restore = vi.fn(async () => ({ proofs: [proof('recovered', 7)], lastCounterWithSignature: 3 }));
    const res = await hydrateStoredWallet();
    expect(res.recovered).toBe(1);
    const state = loadStoredWallet();
    expect(state.pending).toBeUndefined();
    expect(state.proofs.map((p) => p.secret)).toEqual(['recovered']);
    expect(state.counter).toBe(4); // lastCounterWithSignature + 1
  });

  it('inputs still PENDING at the mint fail closed (never race a live swap)', async () => {
    seedPending();
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'PENDING' }]);
    await expect(hydrateStoredWallet()).rejects.toThrow(/PENDING/);
    expect(loadStoredWallet().pending).toBeDefined(); // marker retained for a later retry
  });

  it('a spent swap with NO seed refuses rather than silently dropping the change', async () => {
    const pending: PendingOp = { kind: 'spend', inputs: [proof('a', 10)], counterStart: 0, keysetId: '00'.repeat(8), at: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: MINT, proofs: [], pending }));
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }]);
    await expect(hydrateStoredWallet()).rejects.toThrow(/no recovery seed/);
  });

  it('a new spend recovers the pending swap first, then spends the recovered change', async () => {
    seedPending({ inputs: [proof('a', 10)] });
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }]);
    walletImpl.restore = vi.fn(async () => ({ proofs: [proof('recovered', 10)], lastCounterWithSignature: 0 }));
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('s', 10)] }));
    const { token, balanceAfter } = await spendFromStoredWallet(10);
    expect(walletImpl.send).toHaveBeenCalledWith(10, [expect.objectContaining({ secret: 'recovered' })], { keysetId: '00'.repeat(8) });
    expect(getDecodedToken(token).proofs).toHaveLength(1);
    expect(balanceAfter).toBe(0);
    expect(loadStoredWallet().pending).toBeUndefined();
    // The spend resumed at the recovered counter (1) and reserved one output.
    expect(loadStoredWallet().counter).toBe(2);
  });

  it('a new spend journals the intent BEFORE the mint call, then commits the change', async () => {
    seed(MINT, [proof('a', 20)]);
    const seen: Array<PendingOp | undefined> = [];
    walletImpl.send = vi.fn(async () => {
      seen.push(loadStoredWallet().pending);
      return { keep: [proof('k', 10)], send: [proof('s', 10)] };
    });
    await spendFromStoredWallet(10);
    expect(seen[0]).toMatchObject({ kind: 'spend', counterStart: 0 });
    expect(seen[0]?.inputs.map((p) => p.secret)).toEqual(['a']);
    expect(loadStoredWallet().pending).toBeUndefined();
  });

  it('switching mints leaves a pending recovery marker with its own mint', async () => {
    seedPending();
    await switchStoredMint('https://next.example.com');
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe('https://next.example.com');
    expect(stored.mints[MINT].pending).toBeDefined();
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'UNSPENT' }]);
    await hydrateStoredWallet();
    expect(loadStoredWallet().mints[MINT].pending).toBeUndefined();
  });
});

describe('legacy single-mint migration', () => {
  it('migrates an empty legacy signet wallet to the mainnet fallback', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: 'https://relay.bao.network/cashu', proofs: [] }));
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(DEFAULT_MINT);
    expect(stored.mints['https://relay.bao.network/cashu']).toBeUndefined();
  });
  it('demotes a funded legacy signet wallet to the mainnet fallback but keeps its proofs', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: 'https://relay.bao.network/cashu', proofs: [proof('signet', 5)] }));
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(DEFAULT_MINT);
    expect(stored.proofs).toEqual([]);
    // Proofs are never destroyed: the test-mint bucket stays in the map.
    expect(stored.mints['https://relay.bao.network/cashu'].proofs.map((p) => p.secret)).toEqual(['signet']);
  });
  it('never activates the signet mint - rejected at the door', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: DEFAULT_MINT, proofs: [] }));
    await expect(switchStoredMint('https://relay.bao.network/cashu')).rejects.toThrow(/test-network/);
    expect(loadStoredWallet().mintUrl).toBe(DEFAULT_MINT);
  });
  it('never activates a FUNDED legacy signet bucket (existing is not an allowlist bypass)', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: 'https://relay.bao.network/cashu', proofs: [proof('signet', 5)] }));
    // loadStoredWallet keeps the funded bucket in the map but demotes it.
    expect(loadStoredWallet().mints['https://relay.bao.network/cashu']).toBeDefined();
    await expect(switchStoredMint('https://relay.bao.network/cashu')).rejects.toThrow(/test-network/);
    expect(loadStoredWallet().mintUrl).toBe(DEFAULT_MINT);
  });
  it('refuses to auto-adopt the blocked signet mint from a pasted token', async () => {
    seed(DEFAULT_MINT, []);
    walletImpl.receive = vi.fn(async () => [proof('signet', 5)]);
    const token = encodeToken('https://relay.bao.network/cashu', [proof('signet', 5)]);
    await expect(receiveIntoStoredWallet(token)).rejects.toThrow(/validation/);
    expect(loadStoredWallet().mints['https://relay.bao.network/cashu']).toBeUndefined();
  });
  it('folds the legacy shape into a per-mint bucket on load', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: MINT, proofs: [proof('old', 7)], seed: 'ab'.repeat(32), counter: 3 }));
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(MINT);
    expect(stored.proofs.map((p) => p.secret)).toEqual(['old']);
    expect(stored.seed).toBe('ab'.repeat(32));
    expect(stored.counter).toBe(3);
    expect(stored.mints[MINT].proofs.map((p) => p.secret)).toEqual(['old']);
  });
});

describe('cross-tab exclusion (Web Locks)', () => {
  it('runs every operation under the per-origin storage lock', async () => {
    const request = stubLocks();
    walletImpl.receive = vi.fn(async () => [proof('r', 1)]);
    await switchStoredMint('https://n.example.com');
    await receiveIntoStoredWallet(encodeToken('https://n.example.com', [proof('t', 1)]));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([name]) => name === STORAGE_KEY)).toBe(true);
  });
  it('degrades to same-tab serialization where the Locks API is absent', async () => {
    // jsdom ships no navigator.locks - every other test in this file runs
    // through exactly that path and still serializes correctly.
    expect((navigator as { locks?: unknown }).locks).toBeUndefined();
    seed(MINT, [proof('a', 10)]);
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('a', 10)] }));
    const { token } = await spendFromStoredWallet(10);
    expect(getDecodedToken(token).proofs).toHaveLength(1);
  });
});

describe('Lightning rail — top-up (NUT-04) and pay (NUT-05)', () => {
  const INVOICE = `lnbc21u1p${'q'.repeat(80)}`;
  const MINT_QUOTE = { quote: 'mq-1', request: INVOICE, state: 'PAID', amount: 21, unit: 'sat' };
  const MELT_QUOTE = { quote: 'melt-1', request: INVOICE, state: 'UNPAID', amount: 21, fee_reserve: 1, unit: 'sat' };

  function seedWallet(proofs: ReturnType<typeof proof>[], counter = 0) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mintUrl: MINT, proofs, seed: 'ab'.repeat(32), counter }),
    );
  }

  it('creates a top-up invoice and validates the amount', async () => {
    seedWallet([], 0);
    walletImpl.createMintQuote = vi.fn(async () => ({ quote: 'mq-1', request: INVOICE, state: 'UNPAID', amount: 100, unit: 'sat', expiry: 1_900_000_000 }));
    const quote = await createLightningTopUp(100);
    expect(quote).toMatchObject({ quoteId: 'mq-1', invoice: INVOICE, amountSats: 100, expiry: 1_900_000_000, mintUrl: MINT });
    await expect(createLightningTopUp(0)).rejects.toThrow(/positive whole number/);
    await expect(createLightningTopUp(1.5)).rejects.toThrow(/positive whole number/);
  });

  it('keeps polling while unpaid and mints at the deterministic counter once paid', async () => {
    seedWallet([], 0);
    walletImpl.checkMintQuote = vi.fn(async () => ({ ...MINT_QUOTE, state: 'UNPAID' }));
    expect(await completeLightningTopUp('mq-1')).toMatchObject({ state: 'pending', minted: 0 });

    walletImpl.checkMintQuote = vi.fn(async () => MINT_QUOTE);
    walletImpl.mintProofs = vi.fn(async () => [proof('minted', 21)]);
    const res = await completeLightningTopUp('mq-1');
    expect(res).toEqual({ state: 'paid', minted: 21, balanceAfter: 21 });
    expect(walletImpl.mintProofs).toHaveBeenCalledWith(21, 'mq-1', { keysetId: '00'.repeat(8) });
    const stored = loadStoredWallet();
    expect(stored.counter).toBe(1);
    expect(stored.pending).toBeUndefined();
  });

  it('recovers a paid-but-unminted quote by restore when the mint reports ISSUED', async () => {
    seedWallet([], 0);
    walletImpl.checkMintQuote = vi.fn(async () => ({ ...MINT_QUOTE, state: 'ISSUED' }));
    walletImpl.restore = vi.fn(async () => ({ proofs: [proof('recovered', 21)], lastCounterWithSignature: 0 }));
    const res = await completeLightningTopUp('mq-1');
    expect(res).toEqual({ state: 'paid', minted: 21, balanceAfter: 21 });
    expect(loadStoredWallet().counter).toBe(1);
  });

  it('recovers a crashed mint marker via hydrate (no local inputs involved)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mintUrl: MINT,
        proofs: [],
        seed: 'ab'.repeat(32),
        counter: 0,
        pending: { kind: 'mint', inputs: [], counterStart: 0, keysetId: '00'.repeat(8), at: Date.now(), quoteId: 'mq-1' },
      }),
    );
    walletImpl.restore = vi.fn(async () => ({ proofs: [proof('crashed-mint', 21)], lastCounterWithSignature: 0 }));
    const res = await hydrateStoredWallet();
    expect(res.recovered).toBe(1);
    expect(sumProofs(loadStoredWallet().proofs)).toBe(21);
    expect(loadStoredWallet().pending).toBeUndefined();
  });

  it('quotes a Lightning payment and refuses malformed invoices', async () => {
    walletImpl.createMeltQuote = vi.fn(async () => MELT_QUOTE);
    const q = await quoteLightningPayment(`lightning:${INVOICE}`);
    expect(q.amountSats).toBe(21);
    expect(q.feeReserveSats).toBe(1);
    expect(walletImpl.createMeltQuote).toHaveBeenCalledWith(INVOICE);
    await expect(quoteLightningPayment('not-an-invoice')).rejects.toThrow(/valid Lightning invoice/);
  });

  it('pays a quoted invoice, persists the change and journals first', async () => {
    seedWallet([proof('a', 100)], 0);
    walletImpl.meltProofs = vi.fn(async () => ({ quote: { ...MELT_QUOTE, state: 'PAID' }, change: [proof('change', 78)] }));
    const res = await payLightningQuote(MELT_QUOTE as never);
    expect(res).toEqual({ paid: true, changeSats: 78, balanceAfter: 78, state: 'PAID' });
    const stored = loadStoredWallet();
    expect(stored.pending).toBeUndefined();
    // NUT-09: selected=100, amount=21 -> leftover 79 -> 7 blank outputs were
    // submitted to the mint, so the counter advances past all of them (not
    // just the 1 used as change).
    expect(stored.counter).toBe(7);
    expect(sumProofs(stored.proofs)).toBe(78);
  });

  it('refuses to melt a quote the mint already reports PAID (no proof erasure)', async () => {
    seedWallet([proof('kept', 100)], 0);
    walletImpl.checkMeltQuote = vi.fn(async () => ({ ...MELT_QUOTE, state: 'PAID' }));
    const res = await payLightningQuote(MELT_QUOTE as never);
    expect(res).toEqual({ paid: true, changeSats: 0, balanceAfter: 100, state: 'PAID' });
    expect(walletImpl.meltProofs).not.toHaveBeenCalled();
    expect(sumProofs(loadStoredWallet().proofs)).toBe(100);
  });

  it('recovers a crashed melt through the shared SPENT-input restore path', async () => {
    const consumed = proof('spent-input', 100);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mintUrl: MINT,
        proofs: [proof('kept', 5)],
        seed: 'ab'.repeat(32),
        counter: 0,
        pending: { kind: 'melt', inputs: [consumed], counterStart: 0, keysetId: '00'.repeat(8), at: Date.now(), quoteId: 'melt-1' },
      }),
    );
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }]);
    walletImpl.restore = vi.fn(async () => ({ proofs: [proof('melt-change', 60)], lastCounterWithSignature: 0 }));
    const res = await hydrateStoredWallet();
    expect(res.recovered).toBe(1);
    const secrets = loadStoredWallet().proofs.map((p) => p.secret);
    expect(secrets).toEqual(['kept', 'melt-change']);
  });
});

describe('deep-hunt regressions', () => {
  it('recovery drops only the SPENT inputs and keeps the unspent ones', async () => {
    // A swap rejected because ONE input was already spent elsewhere must not
    // erase the other (still unspent) selected proofs.
    const spent = proof('spent-elsewhere', 100);
    const unspent = proof('still-mine', 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mintUrl: MINT,
      proofs: [spent, unspent],
      seed: 'ab'.repeat(32),
      counter: 0,
      pending: { kind: 'spend', inputs: [spent, unspent], counterStart: 0, keysetId: '00'.repeat(8), at: Date.now() },
    }));
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }, { state: 'UNSPENT' }]);
    walletImpl.restore = vi.fn(async () => ({ proofs: [], lastCounterWithSignature: undefined }));
    await hydrateStoredWallet();
    const stored = loadStoredWallet();
    expect(stored.pending).toBeUndefined();
    expect(stored.proofs.map((p) => p.secret)).toEqual(['still-mine']);
  });

  it('drops restored proofs the mint reports SPENT (no phantom balance)', async () => {
    seed(MINT, [proof('local', 10)]);
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'SPENT' }]);
    const res = await mergeStoredProofs({ [MINT]: [proof('stale', 100)] });
    expect(res.balanceAfter).toBe(10);
    expect(loadStoredWallet().proofs.map((p) => p.secret)).toEqual(['local']);
  });

  it('keeps restored proofs when the mint cannot confirm (never drop unproven funds)', async () => {
    seed(MINT, []);
    walletImpl.checkProofsStates = vi.fn(async () => { throw new Error('mint down'); });
    const res = await mergeStoredProofs({ [MINT]: [proof('restored', 42)] });
    expect(res.balanceAfter).toBe(42);
  });

  it('a PENDING marker on one mint does not block operations on another', async () => {
    const other = 'https://other.example.com';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mintUrl: MINT,
      proofs: [proof('mine', 10)],
      seed: 'ab'.repeat(32),
      counter: 0,
      mints: {
        [MINT]: {
          proofs: [proof('mine', 10)],
          seed: 'ab'.repeat(32),
          counter: 0,
          pending: { kind: 'spend', inputs: [proof('ambiguous', 5)], counterStart: 0, keysetId: '00'.repeat(8), at: Date.now() },
        },
        [other]: { proofs: [proof('other', 20)], seed: 'cd'.repeat(32), counter: 0 },
      },
    }));
    walletImpl.checkProofsStates = vi.fn(async () => [{ state: 'PENDING' }]);
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('sent', 20)] }));
    // The healthy mint still spends; the blocked one still fails closed.
    const res = await spendFromStoredWallet(20, other);
    expect(getDecodedToken(res.token).mint).toBe(other);
    await expect(spendFromStoredWallet(10, MINT)).rejects.toThrow(/PENDING/);
    expect(loadStoredWallet().mints[MINT].pending).toBeDefined();
  });

  it('persists an open top-up quote and clears it once paid', async () => {
    seed(MINT, []);
    walletImpl.createMintQuote = vi.fn(async () => ({ quote: 'mq-keep', request: `lnbc21u1p${'q'.repeat(80)}`, state: 'UNPAID', amount: 21, unit: 'sat' }));
    const quote = await createLightningTopUp(21);
    expect(loadPendingTopUp()).toMatchObject({ quoteId: 'mq-keep', mintUrl: MINT, amountSats: 21 });
    walletImpl.checkMintQuote = vi.fn(async () => ({ quote: 'mq-keep', request: quote.invoice, state: 'PAID', amount: 21, unit: 'sat' }));
    walletImpl.mintProofs = vi.fn(async () => [proof('minted', 21)]);
    await completeLightningTopUp('mq-keep', MINT);
    expect(loadPendingTopUp()).toBeNull();
  });

  it('mints a PAID quote whose check response omits amount (NUT-04 response shape)', async () => {
    seed(MINT, []);
    const invoice = `lnbc42u1p${'q'.repeat(80)}`;
    walletImpl.createMintQuote = vi.fn(async () => ({ quote: 'mq-noamt', request: invoice, state: 'UNPAID', amount: 42, unit: 'sat' }));
    await createLightningTopUp(42);
    // A spec-shaped check reply carries quote/request/state only; the amount
    // is already persisted with the open quote. Throwing here would strand a
    // PAID Lightning invoice at the mint forever.
    walletImpl.checkMintQuote = vi.fn(async () => ({ quote: 'mq-noamt', request: invoice, state: 'PAID' }));
    walletImpl.mintProofs = vi.fn(async () => [proof('minted-noamt', 42)]);
    const res = await completeLightningTopUp('mq-noamt', MINT);
    expect(res).toEqual({ state: 'paid', minted: 42, balanceAfter: 42 });
    expect(walletImpl.mintProofs).toHaveBeenCalledWith(42, 'mq-noamt', { keysetId: '00'.repeat(8) });
  });

  it('never activates the signet mint and prefers another funded mint over the fallback', () => {
    const fundedOther = 'https://other.example.com';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mintUrl: 'https://relay.bao.network/cashu',
      proofs: [proof('signet', 5)],
      mints: {
        'https://relay.bao.network/cashu': { proofs: [proof('signet', 5)], seed: 'ab'.repeat(32) },
        [fundedOther]: { proofs: [proof('other', 7)] },
      },
    }));
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe(fundedOther);
    // The signet bucket (proofs + recovery seed) survives in the map.
    expect(stored.mints['https://relay.bao.network/cashu'].proofs).toHaveLength(1);
  });

  it('canonicalizes legacy mint keys on load so raw-URL buckets stay spendable', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mintUrl: 'https://Mint.Example.com/', proofs: [proof('legacy', 10)] }));
    const stored = loadStoredWallet();
    expect(stored.mintUrl).toBe('https://mint.example.com');
    expect(stored.mints['https://mint.example.com'].proofs.map((p) => p.secret)).toEqual(['legacy']);
  });
});

describe('wallet history recording', () => {
  it('records send and receive operations', async () => {
    seed(MINT, [proof('a', 20)]);
    walletImpl.send = vi.fn(async () => ({ keep: [], send: [proof('s', 20)] }));
    await spendFromStoredWallet(20);
    walletImpl.receive = vi.fn(async () => [proof('r', 10)]);
    await receiveIntoStoredWallet(encodeToken(MINT, [proof('t', 10)]));
    const txs = loadTransactions();
    expect(txs.map((t) => t.type)).toEqual(['receive', 'send']);
    expect(txs.find((t) => t.type === 'send')?.amountSats).toBe(20);
    expect(txs.find((t) => t.type === 'receive')?.amountSats).toBe(10);
  });

  it('records a Lightning top-up once paid', async () => {
    seed(MINT, []);
    const INVOICE = `lnbc21u1p${'q'.repeat(80)}`;
    walletImpl.createMintQuote = vi.fn(async () => ({ quote: 'mq-h', request: INVOICE, state: 'UNPAID', amount: 21, unit: 'sat' }));
    walletImpl.checkMintQuote = vi.fn(async () => ({ quote: 'mq-h', request: INVOICE, state: 'PAID', amount: 21, unit: 'sat' }));
    walletImpl.mintProofs = vi.fn(async () => [proof('minted-h', 21)]);
    await createLightningTopUp(21);
    await completeLightningTopUp('mq-h', MINT);
    const txs = loadTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'topup', amountSats: 21, mintUrl: MINT });
  });

  it('records a Lightning payment with the actual fee', async () => {
    seed(MINT, [proof('a', 100)]);
    const quote = { quote: 'melt-h', request: `lnbc21u1p${'q'.repeat(80)}`, state: 'UNPAID', amount: 21, fee_reserve: 3, unit: 'sat' };
    walletImpl.createMeltQuote = vi.fn(async () => quote);
    walletImpl.checkMeltQuote = vi.fn(async () => ({ ...quote, state: 'UNPAID' }));
    walletImpl.meltProofs = vi.fn(async () => ({ quote: { ...quote, state: 'PAID' }, change: [proof('change', 77)] }));
    const q = await quoteLightningPayment(quote.request, MINT);
    await payLightningQuote(q.quote, q.mintUrl);
    const txs = loadTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'pay', amountSats: 21, feeSats: 2 });
  });
});
