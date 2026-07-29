// src/pets/wallet/components/PetsWalletDrawer.tsx
//
// Wallet drawer for NOSTR PETS. Switches between the real Cashu sats wallet
// and the BAO signet/demo wallet based on the user's chosen mode.

import { useMemo, type ComponentType } from 'react';
import {
  Bitcoin,
  FlaskConical,
  PiggyBank,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePetsWallet, type PetsWalletMode } from '@/pets/core/hooks/usePetsWallet';
import type { NostrPetProfile, PetsCompanion } from '@/pets/core/lib/pets';
import { BaoWalletDrawer } from './BaoWalletDrawer';
import { CashuWalletDrawer } from './CashuWalletDrawer';

interface PetsWalletDrawerProps {
  onModeChange?: (profileMode: 'cashu' | 'bao') => void;
  /** Pet profile — source of the in-game fiat coins balance. */
  profile?: NostrPetProfile | null;
  /** Selected pet — source of the pet-bound fiat balance. */
  companion?: PetsCompanion | null;
}

export function PetsWalletDrawer({ onModeChange, profile, companion }: PetsWalletDrawerProps) {
  const { wallet, mode, setMode, isBao } = usePetsWallet();

  const modeOptions: { value: PetsWalletMode; label: string; icon: typeof Bitcoin }[] = useMemo(
    () => [
      { value: 'bao', label: 'Demo (₿AO signet)', icon: FlaskConical },
      { value: 'cashu', label: 'Mainnet (Cashu sats)', icon: Bitcoin },
    ],
    [],
  );

  const handleModeChange = (next: PetsWalletMode) => {
    setMode(next);
    onModeChange?.(next);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 space-y-2">
        <ModeSwitch mode={mode} setMode={handleModeChange} options={modeOptions} />
        <InGameBalances profile={profile} companion={companion} />
      </div>
      <div className="flex-1 min-h-0">
        {isBao ? (
          <BaoWalletDrawer />
        ) : wallet ? (
          <CashuWalletDrawer
            wallet={wallet}
            title="Mainnet Cashu balance"
            badge="sats"
            mintPlaceholder="Select a mint"
            invoiceDescription="Cashu top-up"
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
            <Bitcoin className="size-10 mb-3" />
            <p className="text-sm">Your signer does not support the Cashu wallet (NIP-44 required).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeSwitch({
  mode,
  setMode,
  options,
}: {
  mode: PetsWalletMode;
  setMode: (mode: PetsWalletMode) => void;
  options: { value: PetsWalletMode; label: string; icon: ComponentType<{ className?: string }> }[];
}) {
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Pets wallet mode
      </p>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? 'default' : 'outline'}
            size="sm"
            className="justify-start gap-2"
            onClick={() => setMode(value)}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {mode === 'cashu'
          ? 'Mainnet mode uses your main Cashu wallet — real sats. Shop purchases pay the 2140 treasury by nutzap.'
          : 'Demo mode uses free ₿AO signet sats from the ₿AO faucet (or bao.markets). Payments run on the same Cashu rail to 2140, but no real money is involved.'}
      </p>
    </div>
  );
}

/**
 * Starter currency: ONE fiat rail, shown as a single balance. It is stored in
 * two pots — the account `coins` tag on the pet profile and the pet-bound
 * `fiat_balance` on the selected pet's event — but spends as one: pet-bound
 * fiat first (down to a small reserve), then account coins. It is play money
 * recorded as tags on the user's own Nostr events — NOT sats of any kind,
 * cannot be withdrawn, and is shown separately from the wallet rails so
 * nobody confuses it with real money.
 */
function InGameBalances({
  profile,
  companion,
}: {
  profile?: NostrPetProfile | null;
  companion?: PetsCompanion | null;
}) {
  const starterCurrency = (profile?.coins ?? 0) + (companion?.fiatBalance ?? 0);

  return (
    <div className="rounded-xl border p-3 space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        In-game balance (not sats)
      </p>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5">
          <PiggyBank className="size-3.5 text-amber-500" /> Starter currency (fiat)
        </span>
        <span className="tabular-nums font-medium">{starterCurrency.toLocaleString()}</span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Play money to keep your pet alive for the first few days, stored on your pet's Nostr
        events — it can never be withdrawn or swapped for sats. The wallet rails below are
        separate: ₿AO testnet coins (demo Cashu) in demo mode, real Cashu sats in mainnet mode.
        ₿AO demo sats you hold in other wallets (e.g. bao.markets) can be deposited into the
        ₿AO testnet coins rail here — just receive the Cashu token in the ₿AO wallet.
      </p>
    </div>
  );
}
