import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { TestApp } from '@/test/TestApp';
import type { PaymentTarget } from '@/lib/paymentTargets';
import { ZapDialog } from './ZapDialog';

/**
 * The dialog discovers its rails asynchronously: the recipient's kind-0
 * metadata and the NIP-A3 payment targets only arrive a moment after the dialog
 * mounts. These module-level objects stand in for those hooks so a test can
 * resolve them late and re-render — the exact sequence that used to strand the
 * dialog on its sender-side Cashu rail.
 */
const author: { data: { metadata: Record<string, unknown> } | undefined } = { data: undefined };
const targets: { targets: PaymentTarget[] } = { targets: [] };

vi.mock('@/hooks/useAuthor', () => ({ useAuthor: () => author }));
vi.mock('@/hooks/usePaymentTargets', () => ({ usePaymentTargets: () => targets }));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'd'.repeat(64), signer: {} }, metadata: undefined }),
}));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useWallet', () => ({ useWallet: () => ({ webln: null, activeNWC: null }) }));
vi.mock('@/hooks/useZapPaymentListener', () => ({ useZapPaymentListener: () => {} }));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({ format: (sats: number) => `${sats} sats` }),
}));
// Sender has a Cashu wallet, so the Cashu rail always exists on this side —
// whether it *should* is what these tests pin down.
vi.mock('@/hooks/useCashuWalletContext', () => ({
  useCashuWalletContext: () => ({ seedAvailable: true, allMints: [], balances: {}, mintUrl: '' }),
}));
vi.mock('@/hooks/useNutzapInfo', () => ({
  useNutzapInfo: () => ({ data: null, isLoading: false }),
  // Mirrors the real predicate so these tests can't silently diverge from it.
  canReceiveNutzap: (info: { pubkey?: string; mints?: string[] } | null | undefined) =>
    !!info && (info.mints?.length ?? 0) > 0 && !!info.pubkey,
}));
vi.mock('@/hooks/useZaps', () => ({
  useZaps: () => ({
    zap: vi.fn(),
    isZapping: false,
    invoice: null,
    setInvoice: vi.fn(),
    payInvoiceWithWebLN: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      defaultZapAmount: 1000,
      currencyDisplay: 'sats',
      relayMetadata: { relays: [] },
      esploraApis: [],
    },
  }),
}));
// The panes are irrelevant here (and heavy); the rail under test is the title.
vi.mock('@/components/CashuZapContent', () => ({ CashuZapContent: () => <div data-testid="pane-cashu" /> }));
vi.mock('@/components/OnchainZapContent', () => ({ OnchainZapContent: () => <div data-testid="pane-onchain" /> }));
vi.mock('@/components/GenericPaymentContent', () => ({ GenericPaymentContent: () => <div data-testid="pane-generic" /> }));
vi.mock('@/lib/bitcoin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bitcoin')>()),
  fetchBtcPrice: vi.fn(async () => undefined),
}));

const TARGET = {
  id: 'a'.repeat(64),
  kind: 36787,
  pubkey: 'b'.repeat(64),
  sig: 'c'.repeat(128),
  created_at: 0,
  content: '',
  tags: [['d', 'track-1']],
} as unknown as NostrEvent;

const renderDialog = () =>
  render(
    <TestApp>
      <ZapDialog target={TARGET} open onOpenChange={() => {}} />
    </TestApp>,
  );

const switcher = () => screen.getByRole('button', { name: /switch payment method/i });

describe('ZapDialog rail selection', () => {
  it('moves to Lightning when the recipient lightning address resolves after mount', async () => {
    author.data = undefined; // metadata has not arrived yet
    targets.targets = [];
    const view = renderDialog();

    // Before resolution the sender-side Cashu rail is the only one, and it says
    // so: the title names the rail and the dialog explains the restriction.
    expect(await screen.findByText('Cashu (DM token)')).toBeInTheDocument();
    expect(screen.getByTestId('zap-rail-notice')).toHaveTextContent(/no Lightning address/i);

    // The recipient's kind-0 metadata lands a moment later.
    author.data = { metadata: { lud16: 'artist@example.com' } };
    view.rerender(
      <TestApp>
        <ZapDialog target={TARGET} open onOpenChange={() => {}} />
      </TestApp>,
    );

    // The preferred rail is applied as capabilities resolve rather than being
    // frozen at first render (this is the reported "only wired to Cashu" bug).
    await waitFor(() => expect(switcher()).toHaveTextContent('Lightning'));
    await waitFor(() => expect(screen.queryByTestId('zap-rail-notice')).toBeNull());
  });

  it('explains both restrictions when the recipient publishes neither', async () => {
    author.data = { metadata: {} }; // no lud16
    targets.targets = [];
    renderDialog();

    expect(await screen.findByText('Cashu (DM token)')).toBeInTheDocument();
    const notice = screen.getByTestId('zap-rail-notice');
    expect(notice).toHaveTextContent(/no Lightning address/i);
    expect(notice).toHaveTextContent(/no Nutzap info/i);
  });
});
