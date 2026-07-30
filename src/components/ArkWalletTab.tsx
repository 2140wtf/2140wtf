import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Anchor,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  LogOut,
  RefreshCw,
  Settings2,
  WalletMinimal,
  Zap,
} from 'lucide-react';
import type { Movement } from '@secondts/barkd';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBarkdConnection } from '@/hooks/useBarkdConnection';
import {
  useBarkdArkAddress,
  useBarkdBalance,
  useBarkdGenerateInvoice,
  useBarkdMovements,
  useBarkdOnchainAddress,
  useBarkdSend,
} from '@/hooks/useBarkdWallet';
import { useToast } from '@/hooks/useToast';
import { openUrl } from '@/lib/downloadFile';
import { isInsecureRemoteUrl } from '@/lib/barkd';

function formatSats(n: number): string {
  return n.toLocaleString();
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast({ title: `${label} copied` });
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function AddressCard({
  value,
  isLoading,
  copyLabel,
  hint,
}: {
  value: string | undefined;
  isLoading: boolean;
  copyLabel: string;
  hint: string;
}) {
  if (isLoading || !value) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <Skeleton className="size-[200px] rounded-lg" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="p-3 bg-white rounded-lg">
        <QRCodeSVG value={value} size={200} level="M" />
      </div>
      <p className="text-xs text-muted-foreground break-all text-center px-2 font-mono">{value}</p>
      <CopyButton value={value} label={copyLabel} />
      <p className="text-[11px] text-muted-foreground/80 text-center max-w-xs">{hint}</p>
    </div>
  );
}

/** Disconnected state: connect to a barkd server, or use Ark over NWC. */
function ArkConnectView({ connection }: { connection: ReturnType<typeof useBarkdConnection> }) {
  const [url, setUrl] = useState(connection.serverUrl ?? '');
  const [password, setPassword] = useState('');

  const insecure = (() => {
    try {
      return url.trim() ? isInsecureRemoteUrl(new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).origin) : false;
    } catch {
      return false;
    }
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Anchor className="size-5 text-primary shrink-0" />
            Connect to a barkd server
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Run{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl('https://gitlab.com/ark-bitcoin/labs/bark-web')}
            >
              bark-web
            </button>{' '}
            on your node or VPS (docker, Umbrel, or Start9) and enter its API URL. Your Ark wallet
            and keys stay on that server — this app only holds a session.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="barkd-url">Server URL</Label>
            <Input
              id="barkd-url"
              placeholder="https://bark.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="barkd-password">UI password (if enabled)</Label>
            <Input
              id="barkd-password"
              type="password"
              placeholder="Optional"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {insecure && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Plain-http remote URLs are blocked by browsers. Put the server behind TLS (e.g.
              Tailscale Serve or Caddy), or use the native app.
            </p>
          )}
          {connection.connect.isError && (
            <p className="text-xs text-destructive">{connection.connect.error.message}</p>
          )}
          {connection.sessionError && (
            <p className="text-xs text-destructive">
              Saved session no longer works — reconnect below.
            </p>
          )}
          <Button
            className="w-full"
            disabled={!url.trim() || connection.connect.isPending}
            onClick={() => connection.connect.mutate({ url, password })}
          >
            {connection.connect.isPending ? (
              <>
                <RefreshCw className="size-4 mr-2 animate-spin" /> Connecting…
              </>
            ) : (
              'Connect'
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Set <span className="font-mono">ALLOWED_ORIGINS</span> on the bark-web API to include
            this app’s origin. If UI auth is enabled, cross-site cookies may be blocked — prefer
            running it on a private network with auth handled by your gateway.
          </p>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="py-6 px-6 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            <p className="text-sm font-medium">Or use Ark over NWC</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Run{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl('https://gitlab.com/ark-bitcoin/labs/bark-nwc')}
            >
              bark-nwc
            </button>{' '}
            or{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl('https://getalby.com/blog/introducing-ark-in-alby-hub')}
            >
              Alby Hub with the Bark backend
            </button>{' '}
            and paste its Nostr Wallet Connect string into your wallet settings. The Ark balance
            then works for Lightning payments and zaps everywhere in this app — it shows up in the
            Lightning tab.
          </p>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/settings/wallet">
              <Settings2 className="size-3.5" /> Add NWC connection
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function MovementRow({ movement }: { movement: Movement }) {
  const amount = movement.effectiveBalanceSat || movement.intendedBalanceSat;
  const received = amount >= 0;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div
        className={`p-1.5 rounded-full shrink-0 ${
          received ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
        }`}
      >
        {received ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium tabular-nums">
          {received ? '+' : '−'}
          {formatSats(Math.abs(amount))} sats
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {movement.subsystem.name} · {new Date(movement.time.createdAt).toLocaleString()}
        </p>
      </div>
      <Badge
        variant={movement.status === 'successful' ? 'secondary' : movement.status === 'pending' ? 'outline' : 'destructive'}
        className="shrink-0 capitalize"
      >
        {movement.status}
      </Badge>
    </div>
  );
}

function ReceivePanel({ serverUrl }: { serverUrl: string }) {
  const arkAddress = useBarkdArkAddress(serverUrl, true);
  const onchainAddress = useBarkdOnchainAddress(serverUrl, true);
  const generateInvoice = useBarkdGenerateInvoice(serverUrl);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  return (
    <Tabs defaultValue="ark" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="ark">Ark</TabsTrigger>
        <TabsTrigger value="lightning">Lightning</TabsTrigger>
        <TabsTrigger value="onchain">On-chain</TabsTrigger>
      </TabsList>

      <TabsContent value="ark">
        <AddressCard
          value={arkAddress.data}
          isLoading={arkAddress.isPending}
          copyLabel="Ark address"
          hint="Share this Ark address to receive off-chain payments from another Ark wallet."
        />
      </TabsContent>

      <TabsContent value="lightning">
        {generateInvoice.data ? (
          <div className="space-y-3">
            <AddressCard
              value={generateInvoice.data}
              isLoading={false}
              copyLabel="Invoice"
              hint="This BOLT11 invoice settles into your Ark balance as soon as it is paid."
            />
            <Button variant="outline" size="sm" className="w-full" onClick={() => generateInvoice.reset()}>
              New invoice
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-amount">Amount (sats)</Label>
              <Input
                id="invoice-amount"
                type="number"
                min={1}
                placeholder="1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-description">Description (optional)</Label>
              <Input
                id="invoice-description"
                placeholder="What's it for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {generateInvoice.isError && (
              <p className="text-xs text-destructive">{generateInvoice.error.message}</p>
            )}
            <Button
              className="w-full"
              disabled={!Number(amount) || Number(amount) <= 0 || generateInvoice.isPending}
              onClick={() =>
                generateInvoice.mutate({ amountSat: Number(amount), description: description || undefined })
              }
            >
              {generateInvoice.isPending ? (
                <>
                  <RefreshCw className="size-4 mr-2 animate-spin" /> Generating…
                </>
              ) : (
                'Generate invoice'
              )}
            </Button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="onchain">
        <AddressCard
          value={onchainAddress.data}
          isLoading={onchainAddress.isPending}
          copyLabel="On-chain address"
          hint="On-chain funds sent here are boarded into your Ark wallet after confirmation."
        />
      </TabsContent>
    </Tabs>
  );
}

function SendPanel({ serverUrl }: { serverUrl: string }) {
  const send = useBarkdSend(serverUrl);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');

  const amountSat = Number(amount) || undefined;

  return (
    <div className="space-y-3 py-4">
      <div className="space-y-1.5">
        <Label htmlFor="send-destination">Destination</Label>
        <Input
          id="send-destination"
          placeholder="Ark address, BOLT11 invoice, LNURL, or lightning address"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="send-amount">Amount (sats) — optional for BOLT11</Label>
        <Input
          id="send-amount"
          type="number"
          min={1}
          placeholder="1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {send.isError && <p className="text-xs text-destructive">{send.error.message}</p>}
      {send.isSuccess && (
        <p className="text-xs text-green-600">{send.data.message || 'Payment sent.'}</p>
      )}
      <Button
        className="w-full"
        disabled={!destination.trim() || send.isPending}
        onClick={() =>
          send.mutate(
            { destination: destination.trim(), amountSat },
            { onSuccess: () => setDestination('') },
          )
        }
      >
        {send.isPending ? (
          <>
            <RefreshCw className="size-4 mr-2 animate-spin" /> Sending…
          </>
        ) : (
          'Send'
        )}
      </Button>
    </div>
  );
}

/** Connected state: balance card + Receive / Send / Activity. */
function ArkConnectedView({ connection }: { connection: ReturnType<typeof useBarkdConnection> }) {
  const serverUrl = connection.serverUrl!;
  const balance = useBarkdBalance(serverUrl, connection.connected);
  const movements = useBarkdMovements(serverUrl, connection.connected);

  const pending: Array<[string, number | null | undefined]> = [
    ['in round', balance.data?.pendingInRoundSat],
    ['boarding', balance.data?.pendingBoardSat],
    ['claimable Lightning', balance.data?.claimableLightningReceiveSat],
    ['in Lightning send', balance.data?.pendingLightningSendSat],
    ['in exit', balance.data?.pendingExitSat],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base font-medium">
            <span className="flex items-center gap-2 min-w-0">
              <Anchor className="size-5 text-primary shrink-0" />
              <span className="truncate">Ark Wallet</span>
              {connection.serverConfig && (
                <Badge variant="outline" className="shrink-0 capitalize">
                  {connection.serverConfig.network}
                </Badge>
              )}
            </span>
            <span className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => balance.refetch()}
              >
                <RefreshCw className={`size-4 ${balance.isFetching ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={connection.disconnect}
                title="Disconnect"
              >
                <LogOut className="size-4" />
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {balance.data ? formatSats(balance.data.spendableSat) : '…'}
            </span>
            <span className="text-muted-foreground">sats</span>
          </div>
          {pending.some(([, v]) => (v ?? 0) > 0) && (
            <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
              {pending
                .filter(([, v]) => (v ?? 0) > 0)
                .map(([label, v]) => `${formatSats(v!)} ${label}`)
                .join(' · ')}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Wallet hosted on your barkd server ({new URL(serverUrl).host}), refreshed every 15s.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="receive" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="send">Send</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="receive">
          <ReceivePanel serverUrl={serverUrl} />
        </TabsContent>

        <TabsContent value="send">
          <SendPanel serverUrl={serverUrl} />
        </TabsContent>

        <TabsContent value="activity">
          {movements.isPending ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !movements.data?.length ? (
            <Card className="border-dashed mt-4">
              <CardContent className="py-10 px-8 text-center">
                <WalletMinimal className="size-7 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  No movements yet. Receive sats via Ark, Lightning, or on-chain to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="divide-y divide-border">
              {movements.data.map((m) => (
                <MovementRow key={m.id} movement={m} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Ark wallet tab — two ways in:
 *
 *  1. Tier 1: connect to a remote barkd server via the bark-web API for full
 *     Ark features (VTXO balance, Ark/Lightning/on-chain receive, unified
 *     send, movement history).
 *  2. Tier 0: use Ark through Nostr Wallet Connect (bark-nwc or Alby Hub with
 *     the Bark backend) — pointer to wallet settings.
 */
export function ArkWalletTab() {
  const connection = useBarkdConnection();

  if (connection.checkingSession) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!connection.connected) {
    return <ArkConnectView connection={connection} />;
  }

  return <ArkConnectedView connection={connection} />;
}
