// src/pets/wallet/components/BaoWalletDrawer.tsx
//
// ₿AO MARKETS signet wallet UI embedded inside the Pets wallet.
// Reuses the full wallet tab from /wallet (now pets-only) so users get the
// same deposit / withdraw / rail options while in demo mode.

import { Wallet as WalletIcon, Loader2 } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useAppContext } from '@/hooks/useAppContext';
import { BaoWalletTab } from '@/components/BaoWalletTab';
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

  if (seedLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading ₿AO wallet…</p>
      </div>
    );
  }

  if (!user || !user.signer?.nip44 || !seedPhrase) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
        <WalletIcon className="size-10 mb-3" />
        <p className="text-sm">Your signer does not support the ₿AO wallet (NIP-44 required).</p>
      </div>
    );
  }

  return (
    <div className="p-2 overflow-y-auto h-full">
      <BaoWalletTab seedPhrase={seedPhrase} user={user} relayUrls={relayUrls} />
    </div>
  );
}
