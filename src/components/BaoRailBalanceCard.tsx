import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useBaoWalletBalances } from '@/hooks/useBaoWalletBalances';
import { openUrl } from '@/lib/downloadFile';
import type { BaoWalletBalances } from '@/lib/baoWalletApi';

function formatSats(n: number): string {
  return n.toLocaleString();
}

const RAIL_META: Record<string, { title: string; hint: string }> = {
  lightning: { title: 'Lightning', hint: 'HTLC-settled trades on bao.markets' },
  spark: { title: 'Spark', hint: 'Spark-native settlement rail (demo)' },
  ark: { title: 'Ark', hint: 'Ark layer-2 settlement rail (demo)' },
};

interface BaoRailBalanceCardProps {
  rail: keyof BaoWalletBalances;
}

/**
 * One ₿AO custodial rail balance, fetched from the bao.markets API
 * (GET /v1/wallet/balance, NIP-98 signed — refreshed every 30s). The rails
 * hold demo signet sats on the custodial ledger; deposits/claims happen on
 * bao.markets.
 */
export function BaoRailBalanceCard({ rail }: BaoRailBalanceCardProps) {
  const balances = useBaoWalletBalances();
  const meta = RAIL_META[rail] ?? { title: rail, hint: '' };
  const sats = balances.data?.[rail] ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base font-medium">
            <span className="flex items-center gap-2">
              {meta.title}
              <Badge variant="outline">signet</Badge>
            </span>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => balances.refetch()}>
              <RefreshCw className={`size-4 ${balances.isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balances.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading balance…</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">{formatSats(sats)}</span>
                <span className="text-muted-foreground">sats</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Held on bao.markets (custodial demo ledger) — {meta.hint}. Fetched via API with
                your signer; no wallet session needed.
              </p>
              {balances.isError && (
                <p className="text-xs text-destructive mt-2">
                  Couldn't fetch balances from bao.markets — tap refresh to retry.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => openUrl('https://bao.markets')}
              >
                Manage on bao.markets
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
