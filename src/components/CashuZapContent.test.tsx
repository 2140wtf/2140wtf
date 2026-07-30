import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Event } from 'nostr-tools';

import { CashuZapContent } from './CashuZapContent';

const mocks = vi.hoisted(() => ({
  sendTokenMock: vi.fn(),
  sendNutzapMock: vi.fn(),
  sendDmMock: vi.fn(),
}));

vi.mock('@/hooks/useCashuWalletContext', () => ({
  useCashuWalletContext: () => ({
    allMints: [{ name: 'Test Mint', url: 'https://mint.example' }],
    balances: { 'https://mint.example': 10_000 },
    mintUrl: 'https://mint.example',
    loading: false,
    error: '',
    seedAvailable: true,
    seedPhrase: 'test seed phrase',
    nutzaps: [],
    sendToken: mocks.sendTokenMock,
    sendNutzap: mocks.sendNutzapMock,
  }),
}));

vi.mock('@/hooks/useNutzapInfo', () => ({
  // No Nutzap info → the pane is in the NUT-18 DM fallback mode.
  useNutzapInfo: () => ({ data: null, isLoading: false }),
}));

vi.mock('@/hooks/useNip17SendMessage', () => ({
  useNip17SendMessage: () => ({ sendMessage: mocks.sendDmMock, isPending: false }),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ format: (sats: number) => `${sats} sats` }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'sender-pubkey' } }),
}));

const OUTBOX_KEY = 'bao_cashu_zap_dm_outbox_sender-pubkey_target-pubkey';

function makeTarget(): Event {
  return {
    id: 'target-id',
    kind: 1,
    pubkey: 'target-pubkey',
    content: 'hello',
    tags: [],
    created_at: 0,
    sig: 'sig',
  };
}

function mount(onSuccess = vi.fn()) {
  render(
    <CashuZapContent
      target={makeTarget()}
      amountSats={1000}
      currencyDisplay="sats"
      btcPrice={undefined}
      onAmountChange={vi.fn()}
      onSuccess={onSuccess}
    />,
  );
  return onSuccess;
}

describe('CashuZapContent NUT-18 DM fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sendTokenMock.mockResolvedValue('cashuAtesttoken');
    // The deterministic DM failure: DMs disabled in publish preferences.
    mocks.sendDmMock.mockRejectedValue(new Error('Direct messages publishing disabled'));
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the minted token when the DM fails — the sats are not burned', async () => {
    // Regression: sendToken debited the wallet, then a sendDm throw dropped
    // the only copy of the bearer token and showed a generic failure that
    // invited a money-burning retry.
    const onSuccess = mount();

    fireEvent.click(screen.getByRole('button', { name: /send 1000 sats/i }));

    // The recovery panel replaces the send form.
    await screen.findByText('Token created, DM not delivered');
    expect(screen.getByText('cashuAtesttoken')).toBeInTheDocument();

    // The token is persisted in the outbox, not just component state.
    const stored = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? 'null');
    expect(stored).toEqual({
      token: 'cashuAtesttoken',
      mintUrl: 'https://mint.example',
      amountSats: 1000,
    });

    // The send is NOT reported as successful, and no second send happened.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.sendTokenMock).toHaveBeenCalledTimes(1);
  });

  it('restores the undelivered token after unmount and delivers it on retry', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /send 1000 sats/i }));
    await screen.findByText('Token created, DM not delivered');

    // Closing the dialog (unmount) must not lose the token.
    cleanup();
    const onSuccess2 = mount();
    await screen.findByText('Token created, DM not delivered');
    expect(screen.getByText('cashuAtesttoken')).toBeInTheDocument();

    // Retry delivers the SAME token — no new sendToken debit.
    mocks.sendDmMock.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: /retry dm/i }));

    await waitFor(() => expect(onSuccess2).toHaveBeenCalledWith({ amountSats: 1000 }));
    expect(mocks.sendTokenMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? 'null')).toBeNull();
  });

  it('dismiss clears the outbox only on explicit user action', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /send 1000 sats/i }));
    await screen.findByText('Token created, DM not delivered');

    fireEvent.click(screen.getByRole('button', { name: /i saved it/i }));

    // The send form returns and the outbox is cleared.
    await screen.findByRole('button', { name: /send 1000 sats/i });
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? 'null')).toBeNull();
  });
});
