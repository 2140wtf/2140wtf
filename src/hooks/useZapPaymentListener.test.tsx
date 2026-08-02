import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Event } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

import { useZapPaymentListener } from './useZapPaymentListener';

const mocks = vi.hoisted(() => ({
  reqMock: vi.fn(),
  queryMock: vi.fn(),
  closeMock: vi.fn().mockResolvedValue(undefined),
  relayConstructor: vi.fn(),
}));

vi.mock('@nostrify/nostrify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/nostrify')>();
  return {
    ...actual,
    NRelay1: vi.fn(function (this: Record<string, unknown>, url: string) {
      mocks.relayConstructor(url);
      this.req = mocks.reqMock;
      this.query = mocks.queryMock;
      this.close = mocks.closeMock;
    }),
  };
});

const payerKey = new Uint8Array(32).fill(1);
const providerKey = new Uint8Array(32).fill(2);
const targetPubkey = getPublicKey(new Uint8Array(32).fill(3));

function makeTarget(kind = 1): Event {
  return {
    kind,
    pubkey: targetPubkey,
    content: 'hello',
    tags: [],
    created_at: 0,
    id: 'a'.repeat(64),
    sig: 'b'.repeat(128),
  };
}

function makeReceipt(tags: string[][], target = makeTarget(0)): NostrEvent {
  const request = finalizeEvent({
    kind: 9734,
    content: '',
    tags: [
      ['p', target.pubkey],
      ...(target.kind === 0 ? [] : [['e', target.id]]),
      ['amount', '21000'],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }, payerKey);
  return finalizeEvent({
    kind: 9735,
    content: '',
    tags: [...tags, ['description', JSON.stringify(request)]],
    created_at: Math.floor(Date.now() / 1000),
  }, providerKey);
}

describe('useZapPaymentListener', () => {
  const invoice = 'lnbc210n1ptestinvoice';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryMock.mockResolvedValue([]);
    mocks.reqMock.mockImplementation(async function* () { /* no events */ });
  });

  afterEach(() => {
    cleanup();
  });

  it('subscribes with BOTH #e and #p filters so profile/QR zap receipts are seen', async () => {
    // Regression: an #e-only filter never matches receipts for profile (kind 0)
    // or QR-code zaps — those receipts carry only the recipient's p tag.
    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], vi.fn()));

    await waitFor(() => expect(mocks.reqMock).toHaveBeenCalled());
    const filters = mocks.reqMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [9735], '#e': ['a'.repeat(64)] }),
        expect.objectContaining({ kinds: [9735], '#p': [targetPubkey] }),
      ]),
    );
  });

  it('also subscribes the well-known receipt relays beyond the caller list', async () => {
    // LNURL servers often publish receipts to their own fixed relay set
    // (damus, nos.lol, …) instead of the zap-request relays — a receipt the
    // sender's relays never see must still be heard.
    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], vi.fn()));

    await waitFor(() => expect(mocks.relayConstructor).toHaveBeenCalled());
    const urls = mocks.relayConstructor.mock.calls.map(([url]) => url);
    expect(urls).toContain('wss://relay.example.com');
    expect(urls).toContain('wss://relay.damus.io');
    expect(urls).toContain('wss://nos.lol');
  });

  it('fires onPaid for a p-tagged receipt whose bolt11 matches the invoice', async () => {
    const onPaid = vi.fn();
    // A profile-zap receipt: no e tag at all, only p + bolt11.
    const receipt = makeReceipt([
      ['p', targetPubkey],
      ['bolt11', invoice.toUpperCase()], // case-insensitive match
    ]);
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt] as ['EVENT', string, NostrEvent];
    });

    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], onPaid));

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
  });

  it('catches a receipt published before the live subscription was ready', async () => {
    const onPaid = vi.fn();
    const receipt = makeReceipt([
      ['p', targetPubkey],
      ['bolt11', invoice],
    ]);
    mocks.queryMock.mockResolvedValue([receipt]);

    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], onPaid));

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
    expect(mocks.queryMock).toHaveBeenCalled();
  });

  it('ignores an unsigned receipt that merely copies the visible invoice', async () => {
    const onPaid = vi.fn();
    const forged = {
      ...JSON.parse(JSON.stringify(makeReceipt([['p', targetPubkey], ['bolt11', invoice]]))) as NostrEvent,
      sig: '0'.repeat(128),
    };
    mocks.queryMock.mockResolvedValue([forged]);

    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], onPaid));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('requires the LNURL-advertised provider to sign a purchase receipt', async () => {
    const onPaid = vi.fn();
    const receipt = makeReceipt([['p', targetPubkey], ['bolt11', invoice]]);
    mocks.queryMock.mockResolvedValue([receipt]);

    renderHook(() => useZapPaymentListener(
      invoice,
      makeTarget(0),
      ['wss://relay.example.com'],
      onPaid,
      'f'.repeat(64),
    ));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('ignores receipts for a different invoice', async () => {
    const onPaid = vi.fn();
    const receipt = makeReceipt([
      ['e', 'a'.repeat(64)],
      ['p', targetPubkey],
      ['bolt11', 'lnbc999n1someotherinvoice'],
    ], makeTarget(1));
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt] as ['EVENT', string, NostrEvent];
    });

    renderHook(() => useZapPaymentListener(invoice, makeTarget(1), ['wss://relay.example.com'], onPaid));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('re-arms for a NEW invoice after a payment was detected (second QR zap is detected)', async () => {
    // Regression: paidRef was a permanent boolean latch — after one detected
    // payment every later QR zap in the same mounted dialog was ignored.
    const onPaid = vi.fn();
    const target = makeTarget(1);
    const receipt1 = makeReceipt([
      ['p', targetPubkey],
      ['bolt11', invoice],
    ], target);
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt1] as ['EVENT', string, NostrEvent];
    });

    const { rerender } = renderHook(
      ({ inv }: { inv: string }) =>
        useZapPaymentListener(inv, target, ['wss://relay.example.com'], onPaid),
      { initialProps: { inv: invoice } },
    );

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));

    // A second zap with a new invoice must subscribe again and detect payment.
    const invoice2 = 'lnbc555n1psecondinvoice';
    const receipt2 = makeReceipt([
      ['p', targetPubkey],
      ['bolt11', invoice2],
    ], target);
    mocks.reqMock.mockClear();
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt2] as ['EVENT', string, NostrEvent];
    });

    rerender({ inv: invoice2 });

    await waitFor(() => expect(mocks.reqMock).toHaveBeenCalled());
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(2));
  });

  it('does not resubscribe for the SAME already-paid invoice', async () => {
    const onPaid = vi.fn();
    const target = makeTarget(1);
    const receipt = makeReceipt([
      ['p', targetPubkey],
      ['bolt11', invoice],
    ], target);
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt] as ['EVENT', string, NostrEvent];
    });

    const { rerender } = renderHook(
      ({ inv }: { inv: string }) =>
        useZapPaymentListener(inv, target, ['wss://relay.example.com'], onPaid),
      { initialProps: { inv: invoice } },
    );

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));

    mocks.reqMock.mockClear();
    rerender({ inv: invoice });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mocks.reqMock).not.toHaveBeenCalled();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });
});
