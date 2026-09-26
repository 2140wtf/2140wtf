import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestnetRailsPanel } from './TestnetRailsPanel';

// The rail cards open relay/chain connections and pull liquidjs-lib; the panel
// only composes them, so stub both and assert the composition + prop wiring.
vi.mock('@/baofund/wallet/rails/Testnet4WalletCard', () => ({
  Testnet4WalletCard: (props: { identityHex: string | null; identityPubkey: string | null }) => (
    <div data-testid="testnet4-card" data-hex={props.identityHex ?? ''} data-pub={props.identityPubkey ?? ''} />
  ),
}));

vi.mock('@/baofund/wallet/rails/LiquidTestnetWalletCard', () => ({
  LiquidTestnetWalletCard: (props: { identityHex: string | null; identityPubkey: string | null }) => (
    <div data-testid="liquid-card" data-hex={props.identityHex ?? ''} data-pub={props.identityPubkey ?? ''} />
  ),
}));

describe('TestnetRailsPanel', () => {
  it('renders both non-custodial testnet rails with the identity props', async () => {
    render(<TestnetRailsPanel identityHex={'ab'.repeat(32)} identityPubkey={'cd'.repeat(32)} />);

    expect(screen.getByText('₿AO Testnet')).toBeInTheDocument();
    expect(screen.getByText('non-custodial')).toBeInTheDocument();
    expect(screen.getByTestId('testnet4-card')).toHaveAttribute('data-hex', 'ab'.repeat(32));
    // Liquid is lazy — it resolves after the dynamic import.
    expect(await screen.findByTestId('liquid-card')).toHaveAttribute('data-pub', 'cd'.repeat(32));
  });

  it('renders with a null identity (extension/bunker logins)', () => {
    render(<TestnetRailsPanel identityHex={null} identityPubkey={null} />);

    expect(screen.getByTestId('testnet4-card')).toHaveAttribute('data-hex', '');
  });
});
