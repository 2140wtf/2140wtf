// src/pets/wallet/components/BaoWalletDrawer.tsx
//
// BAO Demo wallet UI embedded inside the Pets section.
// Wraps the generic Cashu wallet drawer with the BAO-specific wallet hook.

import { Wallet as WalletIcon, Loader2 } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useAppContext } from '@/hooks/useAppContext';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { CashuWalletDrawer } from './CashuWalletDrawer';
import { useMemo } from 'react';

export function BaoWalletDrawer() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { seedPhrase, loading: seedLoading } = useCashuSeed();

  const relayUrls = useMemo(
    () =>
      (config.relayMetadata?.relays ?? [])
        .filter((r) => r.read !== false || r.write !== false)
        .map((r) => r.url)
        .filter(Boolean),
    [config.relayMetadata?.relays],
  );

  const canInitialize = !!user && !!user.signer?.nip44 && !!seedPhrase;
  const wallet = useBaoCashuWallet(seedPhrase ?? '', user ?? { pubkey: '', signer: {} as never }, relayUrls);

  if (seedLoading || wallet.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading ₿AO wallet…</p>
      </div>
    );
  }

  if (!canInitialize) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
        <WalletIcon className="size-10 mb-3" />
        <p className="text-sm">Your signer does not support the ₿AO wallet (NIP-44 required).</p>
      </div>
    );
  }

  return (
    <CashuWalletDrawer
      wallet={wallet}
      title="₿AO Demo balance"
      badge="signet"
      mintPlaceholder="Select a ₿AO mint"
      invoiceDescription="₿AO Demo top-up"
    />
  );
}
