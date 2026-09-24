/**
 * TestnetRailsPanel — the non-custodial ₿AO Testnet wallets.
 *
 * Ported from bao_fund_it: Bitcoin testnet4 + Liquid testnet holding wallets,
 * derived from the signed-in identity (or a created/imported mnemonic stored
 * per identity on this device). No-value coins only — the platform never holds
 * keys. Rendered inside the BAO Wallet tab's "Testnet" mode.
 */
import React, { Suspense } from 'react';

import { Testnet4WalletCard } from '@/baofund/wallet/rails/Testnet4WalletCard';
import '@/baofund/theme/newspaperTheme.css';
import '@/baofund/theme/appTokens.css';

// Liquid pulls in liquidjs-lib (heavy) — load it only when this panel shows.
const LiquidTestnetWalletCard = React.lazy(() =>
  import('@/baofund/wallet/rails/LiquidTestnetWalletCard').then((m) => ({
    default: m.LiquidTestnetWalletCard,
  })),
);

export interface TestnetRailsPanelProps {
  /** Seed identity hex for deterministic derivation; null when unavailable. */
  identityHex: string | null;
  /** Signed-in pubkey for per-identity wallet/cursor storage. */
  identityPubkey: string | null;
}

export function TestnetRailsPanel({ identityHex, identityPubkey }: TestnetRailsPanelProps): React.ReactElement {
  return (
    <div className="bao-fund-chat space-y-4" data-testid="testnet-rails-panel">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-lg font-bold">₿AO Testnet</h3>
        <span
          className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em]"
          style={{ borderColor: 'var(--np-accent)', color: 'var(--np-accent)', fontFamily: 'var(--np-font-mono)' }}
        >
          non-custodial
        </span>
      </header>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--np-muted)' }}>
        No-value testnet coins. The Bitcoin testnet4 and Liquid testnet wallets
        are derived from your identity; a created or imported wallet is stored
        per identity on this device. The words are the only backup.
      </p>

      <Testnet4WalletCard identityHex={identityHex} identityPubkey={identityPubkey} />

      <Suspense
        fallback={
          <div className="border p-4 text-xs" style={{ borderColor: 'var(--np-rule)', color: 'var(--np-muted)' }}>
            Loading Liquid testnet wallet…
          </div>
        }
      >
        <LiquidTestnetWalletCard identityHex={identityHex} identityPubkey={identityPubkey} />
      </Suspense>
    </div>
  );
}

export default TestnetRailsPanel;
