import { Link } from 'react-router-dom';
import { RefreshCw, Settings2, WalletMinimal, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNWC } from '@/hooks/useNWCContext';
import { useNWCWalletInfo } from '@/hooks/useNWCWalletInfo';

function formatSats(n: number): string {
  return n.toLocaleString();
}

/**
 * Lightning wallet tab — the connected NWC wallet (Rizful, Alby, Coinos, …)
 * with its live balance, Amethyst-style. Connect wallets in Wallet settings;
 * the active connection's balance shows here, refreshed every 60s.
 */
export function LightningWalletTab() {
  const { connections, activeConnection } = useNWC();
  const connection =
    connections.find((c) => c.connectionString === activeConnection) ?? connections[0];

  const { data: info, refetch, isFetching } = useNWCWalletInfo(connection?.connectionString);

  if (!connection) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center space-y-3">
          <WalletMinimal className="size-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            No Lightning wallet connected. Connect a NWC wallet (Rizful, Alby, Coinos) and its
            balance shows up here — same as the wallet section in Amethyst.
          </p>
          <Button asChild size="sm">
            <Link to="/settings/wallet">Connect a wallet</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const title =
    connection.alias && connection.alias !== 'NWC Wallet'
      ? connection.alias
      : info?.serviceAlias || 'Lightning Wallet';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base font-medium">
            <span className="flex items-center gap-2 min-w-0">
              <Zap className="size-5 text-amber-500 shrink-0" />
              <span className="truncate">{title}</span>
              <Badge variant="outline" className="shrink-0">NWC</Badge>
            </span>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => refetch()}>
              <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {info?.balanceSats !== undefined ? formatSats(info.balanceSats) : '…'}
            </span>
            <span className="text-muted-foreground">sats</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Balance from your wallet service via Nostr Wallet Connect, refreshed every 60s.
          </p>
        </CardContent>
      </Card>

      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link to="/settings/wallet">
          <Settings2 className="size-3.5" /> Manage wallets
        </Link>
      </Button>
    </div>
  );
}
