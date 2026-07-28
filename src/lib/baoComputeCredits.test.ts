import { describe, it, expect } from 'vitest';

import {
  BAO_COMPUTE_CREDIT_FULFILLMENT_KIND,
  BAO_COMPUTE_CREDIT_RECEIPT_KIND,
  BAO_COMPUTE_CREDIT_REQUEST_KIND,
  BAO_COMPUTE_CREDIT_TAG,
  aggregateAgentCreditStats,
  buildComputeCreditFulfillment,
  buildComputeCreditReceipt,
  buildComputeCreditRequest,
  corroboratedFunders,
  parseComputeCreditFulfillment,
  parseComputeCreditReceipt,
  parseComputeCreditRequest,
  resolveCreditLockTarget,
  type ComputeCreditFulfillment,
  type ComputeCreditReceipt,
  type ComputeCreditRequest,
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

// ── kind 4973 spend receipts ─────────────────────────────────────────────────

const AGENT = 'a'.repeat(64);
const FUNDER1 = 'f'.repeat(64);
const FUNDER2 = 'e'.repeat(64);
const REQ_ID = 'd'.repeat(64);

function req(partial?: Partial<ComputeCreditRequest>): ComputeCreditRequest {
  return { id: REQ_ID, pubkey: AGENT, amountSats: 1000, purpose: 'run inference', createdAt: 1_700_000_000, ...partial };
}

function ful(partial?: Partial<ComputeCreditFulfillment>): ComputeCreditFulfillment {
  return { id: '1'.repeat(64), pubkey: FUNDER1, requestId: REQ_ID, requesterPubkey: AGENT, amountSats: 1000, createdAt: 1_700_000_001, ...partial };
}

function rec(partial?: Partial<ComputeCreditReceipt>): ComputeCreditReceipt {
  return { id: '2'.repeat(64), pubkey: AGENT, requestId: REQ_ID, amountSats: 1000, note: 'redeemed', claimedFunders: [], createdAt: 1_700_000_002, ...partial };
}

describe('buildComputeCreditReceipt', () => {
  it('builds a kind-4973 template with e/amount/provider and valid p tags only', () => {
    const t = buildComputeCreditReceipt({
      requestId: REQ_ID,
      amountSats: 900.5,
      note: '  redeemed at routstr  ',
      provider: ' routstr ',
      funderPubkeys: [FUNDER1, 'not-hex', FUNDER1],
    });
    expect(t.kind).toBe(BAO_COMPUTE_CREDIT_RECEIPT_KIND);
    expect(t.kind).toBe(4973);
    expect(t.tags).toContainEqual(['e', REQ_ID]);
    expect(t.tags).toContainEqual(['amount', '900']);
    expect(t.tags).toContainEqual(['provider', 'routstr']);
    expect(t.tags.filter((tag) => tag[0] === 'p')).toEqual([['p', FUNDER1], ['p', FUNDER1]]);
    expect(t.content).toBe('redeemed at routstr');
  });
});

describe('parseComputeCreditReceipt', () => {
  it('parses a well-formed receipt', () => {
    const r = parseComputeCreditReceipt(ev({
      kind: 4973,
      pubkey: AGENT,
      tags: [['e', REQ_ID], ['amount', '1000'], ['provider', 'routstr'], ['p', FUNDER1], ['p', 'junk']],
      content: 'done',
    }));
    expect(r).toMatchObject({ pubkey: AGENT, requestId: REQ_ID, amountSats: 1000, provider: 'routstr', note: 'done' });
    expect(r?.claimedFunders).toEqual([FUNDER1]); // invalid p tag dropped
  });

  it('rejects wrong kind, non-hex e tag, and bad amounts', () => {
    expect(parseComputeCreditReceipt(ev({ kind: 4972, tags: [['e', REQ_ID], ['amount', '1']] }))).toBeNull();
    expect(parseComputeCreditReceipt(ev({ kind: 4973, tags: [['e', 'req1'], ['amount', '1']] }))).toBeNull();
    expect(parseComputeCreditReceipt(ev({ kind: 4973, tags: [['amount', '1']] }))).toBeNull();
    expect(parseComputeCreditReceipt(ev({ kind: 4973, tags: [['e', REQ_ID], ['amount', '0']] }))).toBeNull();
    expect(parseComputeCreditReceipt(ev({ kind: 4973, tags: [['e', REQ_ID], ['amount', 'abc']] }))).toBeNull();
  });
});

// ── lock-target resolution ───────────────────────────────────────────────────

describe('resolveCreditLockTarget', () => {
  const base = {
    agentIdentityPubkey: AGENT,
    funderMints: ['https://mint-a.example', 'https://mint-b.example'],
    routstrMints: ['https://mint-b.example'],
    activeMint: 'https://mint-a.example',
    allowBearer: false,
  };

  it('locks to the wallet key on a common mint, preferring Routstr-accepted', () => {
    const t = resolveCreditLockTarget({
      ...base,
      nutzapInfo: { pubkey: 'c'.repeat(64), mints: ['https://mint-a.example', 'https://mint-b.example'] },
    });
    expect(t).toEqual({ mode: 'wallet-key', lockPubkey: 'c'.repeat(64), mintUrl: 'https://mint-b.example' });
  });

  it('falls back to any common mint when Routstr accepts none of them', () => {
    const t = resolveCreditLockTarget({
      ...base,
      routstrMints: [],
      nutzapInfo: { pubkey: 'c'.repeat(64), mints: ['https://mint-b.example'] },
    });
    expect(t).toEqual({ mode: 'wallet-key', lockPubkey: 'c'.repeat(64), mintUrl: 'https://mint-b.example' });
  });

  it('falls back to the identity key when no common mint exists', () => {
    const t = resolveCreditLockTarget({
      ...base,
      nutzapInfo: { pubkey: 'c'.repeat(64), mints: ['https://mint-z.example'] },
    });
    expect(t).toEqual({ mode: 'identity-key', lockPubkey: AGENT, mintUrl: 'https://mint-a.example' });
  });

  it('falls back to the identity key when the agent has no 10019', () => {
    const t = resolveCreditLockTarget({ ...base, nutzapInfo: null });
    expect(t.mode).toBe('identity-key');
    expect(t.lockPubkey).toBe(AGENT);
  });

  it('sends bearer only on explicit opt-in, ignoring 10019', () => {
    const t = resolveCreditLockTarget({
      ...base,
      allowBearer: true,
      nutzapInfo: { pubkey: 'c'.repeat(64), mints: ['https://mint-a.example'] },
    });
    expect(t).toEqual({ mode: 'bearer', lockPubkey: null, mintUrl: 'https://mint-a.example' });
  });

  it('normalizes trailing slashes when matching mints', () => {
    const t = resolveCreditLockTarget({
      ...base,
      funderMints: ['https://mint-a.example/'],
      routstrMints: [],
      nutzapInfo: { pubkey: 'c'.repeat(64), mints: ['https://mint-a.example'] },
    });
    expect(t.mode).toBe('wallet-key');
  });
});

// ── corroborated reputation ──────────────────────────────────────────────────

describe('aggregateAgentCreditStats', () => {
  it('counts funded only when claim AND confirmation both exist', () => {
    const stats = aggregateAgentCreditStats({
      agentPubkey: AGENT,
      requests: [req()],
      fulfillments: [ful()], // claim only, no confirmation
      receipts: [],
    });
    expect(stats.fundedRequests).toBe(0);
    expect(stats.claimants).toEqual([]);

    const confirmed = aggregateAgentCreditStats({
      agentPubkey: AGENT,
      requests: [req()],
      fulfillments: [ful(), ful({ pubkey: AGENT })],
      receipts: [],
    });
    expect(confirmed.fundedRequests).toBe(1);
    expect(confirmed.claimants).toEqual([FUNDER1]);
    expect(confirmed.selfReportedSats).toBe(1000);
  });

  it('ignores self-claims and claims with a mismatched p tag', () => {
    const stats = aggregateAgentCreditStats({
      agentPubkey: AGENT,
      requests: [req()],
      fulfillments: [
        ful({ pubkey: AGENT }), // confirmation
        ful({ pubkey: '9'.repeat(64), requesterPubkey: '9'.repeat(64) }), // p tag doesn't match requester
      ],
      receipts: [],
    });
    expect(stats.fundedRequests).toBe(0);
  });

  it('dedupes receipts per request and ignores receipts for others\' requests', () => {
    const stats = aggregateAgentCreditStats({
      agentPubkey: AGENT,
      requests: [req()],
      fulfillments: [],
      receipts: [
        rec(),
        rec({ id: '3'.repeat(64) }), // same request — deduped
        rec({ id: '4'.repeat(64), requestId: '5'.repeat(64) }), // unknown request
        rec({ id: '6'.repeat(64), pubkey: FUNDER1 }), // not authored by the agent
      ],
    });
    expect(stats.receipts).toBe(1);
  });

  it('tracks distinct claimants across requests', () => {
    const req2 = req({ id: '7'.repeat(64), amountSats: 500 });
    const stats = aggregateAgentCreditStats({
      agentPubkey: AGENT,
      requests: [req(), req2],
      fulfillments: [
        ful(), ful({ pubkey: AGENT }),
        ful({ requestId: req2.id, pubkey: FUNDER2 }), ful({ requestId: req2.id, pubkey: AGENT }),
        ful({ requestId: req2.id, pubkey: FUNDER1 }), // same claimant again — distinct count
      ],
      receipts: [],
    });
    expect(stats.fundedRequests).toBe(2);
    expect(stats.claimants.sort()).toEqual([FUNDER1, FUNDER2].sort());
    expect(stats.selfReportedSats).toBe(1500);
  });
});

describe('corroboratedFunders', () => {
  it('keeps only claimed funders with their own 4972 claim', () => {
    const receipt = rec({ claimedFunders: [FUNDER1, FUNDER2] });
    expect(corroboratedFunders(receipt, [ful()])).toEqual([FUNDER1]);
    expect(corroboratedFunders(receipt, [])).toEqual([]);
  });
});
