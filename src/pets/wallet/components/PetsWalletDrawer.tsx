// src/pets/wallet/components/PetsWalletDrawer.tsx
//
// Wallet drawer for NOSTR PETS. Switches between the real Cashu sats wallet
// and the BAO signet/demo wallet based on the user's chosen mode.

import { useMemo, type ComponentType } from 'react';
import {
  Bitcoin,
  FlaskConical,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { usePetsWallet, type PetsWalletMode } from '@/pets/core/hooks/usePetsWallet';
import { BaoWalletDrawer } from './BaoWalletDrawer';
import { CashuWalletDrawer } from './CashuWalletDrawer';

interface PetsWalletDrawerProps {
  onModeChange?: (profileMode: 'cashu' | 'bao') => void;
}

export function PetsWalletDrawer({ onModeChange }: PetsWalletDrawerProps) {
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
      <div className="p-4 pb-2">
        <ModeSwitch mode={mode} setMode={handleModeChange} options={modeOptions} />
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
