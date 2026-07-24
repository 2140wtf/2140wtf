import { describe, it, expect } from 'vitest';

import {
  BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  buildComputeCreditFulfillment,
  buildComputeCreditRequest,
  parseComputeCreditFulfillment,
  parseComputeCreditRequest,
} from './baoComputeCredits';
import type { NostrEvent } from '@nostrify/nostrify';

function ev(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...partial,
  };
}

describe('buildComputeCreditRequest', () => {
  it('builds a kind-4971 template with tag and amount', () => {
    const t = buildComputeCreditRequest({ amountSats: 2100.7, purpose: '  run inference  ' });
    expect(t.kind).toBe(BAO_COMPUTE_CREDIT_REQUEST_KIND);
    expect(t.kind).toBe(4971);
    expect(t.tags).toContainEqual(['t', BAO_COMPUTE_CREDIT_TAG]);
    expect(t.tags).toContainEqual(['amount', '2100']);
    expect(t.content).toBe('run inference');
  });
});

describe('buildComputeCreditFulfillment', () => {
  it('builds a kind-4972 template with e/p/amount and no token', () => {
    const t = buildComputeCreditFulfillment({ requestId: 'req1', requesterPubkey: 'pk1', amountSats: 500 });
    expect(t.kind).toBe(BAO_COMPUTE_CREDIT_FULFILLMENT_KIND);
    expect(t.kind).toBe(4972);
    expect(t.tags).toContainEqual(['e', 'req1']);
    expect(t.tags).toContainEqual(['p', 'pk1']);
    expect(t.tags).toContainEqual(['amount', '500']);
    expect(t.content).toBe('');
  });
});

describe('parseComputeCreditRequest', () => {
  it('parses a well-formed request', () => {
    const r = parseComputeCreditRequest(ev({
      kind: 4971,
      tags: [['t', BAO_COMPUTE_CREDIT_TAG], ['amount', '1000']],
      content: 'need compute for milestone 2',
    }));
    expect(r).toEqual({
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      amountSats: 1000,
      purpose: 'need compute for milestone 2',
      createdAt: 1_700_000_000,
    });
  });

  it('rejects wrong kind, missing t tag, and bad amount', () => {
    expect(parseComputeCreditRequest(ev({ kind: 4972, tags: [['t', BAO_COMPUTE_CREDIT_TAG], ['amount', '1']] }))).toBeNull();
    expect(parseComputeCreditRequest(ev({ kind: 4971, tags: [['amount', '1']] }))).toBeNull();
    expect(parseComputeCreditRequest(ev({ kind: 4971, tags: [['t', BAO_COMPUTE_CREDIT_TAG], ['amount', '0']] }))).toBeNull();
    expect(parseComputeCreditRequest(ev({ kind: 4971, tags: [['t', BAO_COMPUTE_CREDIT_TAG], ['amount', 'abc']] }))).toBeNull();
  });
});

describe('parseComputeCreditFulfillment', () => {
  it('parses a well-formed fulfillment', () => {
    const f = parseComputeCreditFulfillment(ev({
      kind: 4972,
      tags: [['e', 'req1'], ['p', 'pk1'], ['amount', '750']],
    }));
    expect(f).toMatchObject({ requestId: 'req1', requesterPubkey: 'pk1', amountSats: 750 });
  });

  it('rejects missing e or p tags', () => {
    expect(parseComputeCreditFulfillment(ev({ kind: 4972, tags: [['p', 'pk1']] }))).toBeNull();
    expect(parseComputeCreditFulfillment(ev({ kind: 4972, tags: [['e', 'req1']] }))).toBeNull();
    expect(parseComputeCreditFulfillment(ev({ kind: 4971, tags: [['e', 'req1'], ['p', 'pk1']] }))).toBeNull();
  });
});
