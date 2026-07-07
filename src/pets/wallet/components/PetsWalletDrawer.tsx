// src/pets/wallet/components/PetsWalletDrawer.tsx
//
// Wallet drawer for NOSTR PETS. Switches between the real Cashu wallet
// (NIP-60/NWC) and the BAO signet/demo wallet based on the user's chosen mode.

import { useMemo, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Loader2,
  Wallet as WalletIcon,
  RefreshCw,
  Bitcoin,
  FlaskConical,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePetsWallet, type PetsWalletMode } from '@/pets/core/hooks/usePetsWallet';
import { BaoWalletDrawer } from './BaoWalletDrawer';
import { CashuWalletDrawer } from './CashuWalletDrawer';
import { normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';

export function PetsWalletDrawer() {
  const { wallet, mode, setMode, isReal, isBitcoin, isTestnet } = usePetsWallet();
  const [balanceKey, setBalanceKey] = useState(0);

  const activeMint = wallet?.mintUrl ?? '';
  const allMints = wallet?.allMints ?? [];

  const handleMintChange = (url: string) => {
    wallet?.setMintUrl(url);
  };

  const modeOptions: { value: PetsWalletMode; label: string; icon: typeof Bitcoin }[] = useMemo(
    () => [
      { value: 'real', label: 'Real sats', icon: WalletIcon },
      { value: 'bitcoin', label: 'Bitcoin sats', icon: Bitcoin },
      { value: 'testnet', label: 'BAO testnet', icon: FlaskConical },
    ],
    [],
  );

  if (isTestnet) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 pb-2">
          <ModeSwitch mode={mode} setMode={setMode} options={modeOptions} />
        </div>
        <div className="flex-1 min-h-0">
          <BaoWalletDrawer />
        </div>
      </div>
    );
  }

  if (isBitcoin) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 pb-2">
          <ModeSwitch mode={mode} setMode={setMode} options={modeOptions} />
        </div>
        <div className="flex-1 min-h-0">
          {wallet ? (
            <CashuWalletDrawer
              wallet={wallet}
              title="Bitcoin sats balance"
              badge="sats"
              mintPlaceholder="Select a mint"
              invoiceDescription="Bitcoin top-up"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
              <WalletIcon className="size-10 mb-3" />
              <p className="text-sm">Your signer does not support the Cashu wallet (NIP-44 required).</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        <ModeSwitch mode={mode} setMode={setMode} options={modeOptions} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base font-medium">
              <span className="flex items-center gap-2">
                <WalletIcon className="size-5 text-primary" />
                Wallet balance
                <Badge variant="outline">{isReal ? 'real' : 'testnet'}</Badge>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setBalanceKey((k) => k + 1);
                  void wallet?.calculateAllBalances();
                }}
                disabled={!wallet || wallet.loading}
              >
                <RefreshCw className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {wallet?.loading && balanceKey === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">Loading wallet…</span>
              </div>
            ) : !wallet ? (
              <p className="text-sm text-muted-foreground">
                Your signer does not support the Cashu wallet (NIP-44 required).
              </p>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold" key={balanceKey}>
                  {wallet.totalBalance.toLocaleString()}
                </span>
                <span className="text-muted-foreground">sats</span>
              </div>
            )}
          </CardContent>
        </Card>

        {wallet && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Mint</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={activeMint} onValueChange={handleMintChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a mint" />
                </SelectTrigger>
                <SelectContent>
                  {allMints.map((m) => (
                    <SelectItem key={normalizeMintUrl(m.url)} value={safeNormalizeMintUrl(m.url)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        <Button asChild className="w-full">
          <Link to="/wallet">
            <ArrowUpRight className="size-4 mr-1.5" />
            Open Wallet to send/receive
          </Link>
        </Button>

        <p className="text-xs text-muted-foreground leading-relaxed">
          NOSTR PETS is now in real-money mode. Shop purchases are settled from
          your Cashu wallet. Top it up from the Wallet tab anytime.
        </p>
      </div>
    </ScrollArea>
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
      <div className="grid grid-cols-3 gap-2">
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
        {mode === 'real'
          ? 'Real mode shows your main Cashu wallet balance. Switch to Bitcoin sats for deposit/send/receive, or BAO testnet for free demo sats and faucet play.'
          : mode === 'bitcoin'
            ? 'Bitcoin sats mode uses your main Cashu wallet. Create invoices, send tokens, and receive tokens here.'
            : 'Testnet mode uses BAO signet sats and the BAO faucet. Shop purchases still come from this demo wallet.'}
      </p>
    </div>
  );
}
