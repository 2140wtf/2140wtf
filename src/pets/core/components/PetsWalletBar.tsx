import { Bitcoin, Coins } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePetsCashuWallet } from '@/pets/core/hooks/usePetsCashuWallet';
import type { BlobbonautProfile } from '@/pets/core/lib/pets';

interface PetsWalletBarProps {
  profile: BlobbonautProfile | undefined;
  selectedD: string | undefined;
  onModeChange: (mode: 'demo' | 'real') => void;
}

export function PetsWalletBar({ profile, selectedD, onModeChange }: PetsWalletBarProps) {
  const walletMode = profile?.walletMode ?? 'demo';
  const cashuWallet = usePetsCashuWallet(walletMode === 'real' ? selectedD : undefined);

  if (!selectedD) return null;

  return (
    <div className="pointer-events-auto w-full max-w-xs rounded-2xl bg-background/70 backdrop-blur-md border border-border/60 px-3 py-2 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'flex items-center justify-center size-7 rounded-full shrink-0',
            walletMode === 'real' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary'
          )}>
            {walletMode === 'real' ? <Bitcoin className="size-4" /> : <Coins className="size-4" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium truncate">
              {walletMode === 'real' ? 'Real sats' : 'Demo coins'}
            </span>
            {walletMode === 'real' ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {cashuWallet.loading ? (
                  <Skeleton className="h-3 w-12" />
                ) : (
                  `${cashuWallet.totalBalance.toLocaleString()} sats`
                )}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">BAO play-money</span>
            )}
          </div>
        </div>
        <Switch
          checked={walletMode === 'real'}
          onCheckedChange={(checked) => onModeChange(checked ? 'real' : 'demo')}
          aria-label="Toggle real Cashu wallet"
        />
      </div>
      {walletMode === 'real' && cashuWallet.error && (
        <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 truncate">{cashuWallet.error}</p>
      )}
    </div>
  );
}
