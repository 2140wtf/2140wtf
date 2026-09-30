import { beforeEach, describe, expect, it } from 'vitest';
import {
  listPendingDeliveries,
  pendingDeliveryFor,
  removePendingDelivery,
  savePendingDelivery,
  type PendingDeliveryRecord,
} from './pendingDelivery';

const PK = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const record = (over: Partial<PendingDeliveryRecord> = {}): PendingDeliveryRecord => ({
  v: 1,
  frId: 'fr_1',
  mint: 'https://mint.example',
  amountSats: 1000,
  token: 'cashuBtoken1',
  via: 'nutzap',
  createdAt: 1,
  ...over,
});

beforeEach(() => localStorage.clear());

describe('pendingDelivery journal (per identity)', () => {
  it('stores, lists and clears an issued token', () => {
    expect(savePendingDelivery(PK, record())).toBe(true);
    expect(listPendingDeliveries(PK)).toHaveLength(1);
    removePendingDelivery(PK, 'cashuBtoken1');
    expect(listPendingDeliveries(PK)).toHaveLength(0);
    expect(localStorage.getItem(`baofund:pending-delivery:${PK}`)).toBeNull();
  });

  it('is identity-scoped and refuses invalid pubkeys', () => {
    savePendingDelivery(PK, record());
    expect(listPendingDeliveries(OTHER)).toHaveLength(0);
    expect(savePendingDelivery('nope', record())).toBe(false);
    expect(listPendingDeliveries(null)).toHaveLength(0);
    expect(listPendingDeliveries(PK.toUpperCase())).toHaveLength(1);
  });

  it('dedupes by token and keeps the newest first', () => {
    savePendingDelivery(PK, record({ token: 't1', createdAt: 1 }));
    savePendingDelivery(PK, record({ token: 't1', createdAt: 2 }));
    savePendingDelivery(PK, record({ token: 't2', createdAt: 3 }));
    const rows = listPendingDeliveries(PK);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.token)).toEqual(['t2', 't1']);
  });

  it('bounds the journal', () => {
    for (let i = 0; i < 15; i++) savePendingDelivery(PK, record({ token: `t${i}` }));
    expect(listPendingDeliveries(PK)).toHaveLength(10);
    expect(listPendingDeliveries(PK)[0].token).toBe('t14');
  });

  it('restores the newest undelivered token for a campaign', () => {
    savePendingDelivery(PK, record({ frId: 'other', token: 'x' }));
    savePendingDelivery(PK, record({ frId: 'fr_1', token: 'mine', createdAt: 9 }));
    expect(pendingDeliveryFor(PK, 'fr_1')?.token).toBe('mine');
    expect(pendingDeliveryFor(PK, 'missing')).toBeNull();
    expect(pendingDeliveryFor(null, 'fr_1')).toBeNull();
  });

  it('degrades corrupt storage to an empty list, never a throw', () => {
    localStorage.setItem(`baofund:pending-delivery:${PK}`, '{not json');
    expect(listPendingDeliveries(PK)).toEqual([]);
    localStorage.setItem(`baofund:pending-delivery:${PK}`, JSON.stringify([{ v: 1, token: '', amountSats: -1 }]));
    expect(listPendingDeliveries(PK)).toEqual([]);
  });
});
