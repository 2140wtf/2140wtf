import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Event } from 'nostr-tools';

import { useZapPaymentListener } from './useZapPaymentListener';

const mocks = vi.hoisted(() => ({
  reqMock: vi.fn(),
  closeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@nostrify/nostrify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/nostrify')>();
  return {
    ...actual,
    NRelay1: vi.fn(function (this: Record<string, unknown>, _url: string) {
      this.req = mocks.reqMock;
      this.close = mocks.closeMock;
    }),
  };
});

function makeTarget(kind = 1): Event {
  return {
    kind,
    pubkey: 'target-pubkey',
    content: 'hello',
    tags: [],
    created_at: 0,
    id: 'target-id',
    sig: 'sig',
  };
}

function makeReceipt(tags: string[][]): NostrEvent {
  return {
    id: 'receipt-id',
    kind: 9735,
    pubkey: 'zapper-pubkey',
    content: '',
    tags,
    created_at: Math.floor(Date.now() / 1000),
    sig: 'sig',
  };
}

describe('useZapPaymentListener', () => {
  const invoice = 'lnbc210n1ptestinvoice';

  beforeEach(() => {
    vi.clearAllMocks();
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
        expect.objectContaining({ kinds: [9735], '#e': ['target-id'] }),
        expect.objectContaining({ kinds: [9735], '#p': ['target-pubkey'] }),
      ]),
    );
  });

  it('fires onPaid for a p-tagged receipt whose bolt11 matches the invoice', async () => {
    const onPaid = vi.fn();
    // A profile-zap receipt: no e tag at all, only p + bolt11.
    const receipt = makeReceipt([
      ['p', 'target-pubkey'],
      ['bolt11', invoice.toUpperCase()], // case-insensitive match
    ]);
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt] as ['EVENT', string, NostrEvent];
    });

    renderHook(() => useZapPaymentListener(invoice, makeTarget(0), ['wss://relay.example.com'], onPaid));

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
  });

  it('ignores receipts for a different invoice', async () => {
    const onPaid = vi.fn();
    const receipt = makeReceipt([
      ['e', 'target-id'],
      ['p', 'target-pubkey'],
      ['bolt11', 'lnbc999n1someotherinvoice'],
    ]);
    mocks.reqMock.mockImplementation(async function* () {
      yield ['EVENT', '', receipt] as ['EVENT', string, NostrEvent];
    });

    renderHook(() => useZapPaymentListener(invoice, makeTarget(1), ['wss://relay.example.com'], onPaid));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onPaid).not.toHaveBeenCalled();
  });
});
