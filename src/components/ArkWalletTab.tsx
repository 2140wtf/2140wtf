import { useEffect, useRef, useState } from 'react';
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
import { SatsPresetPills } from '@/components/SatsPresetPills';
import { useBarkdConnection } from '@/hooks/useBarkdConnection';
import {
  useBarkdArkAddress,
  useBarkdBalance,
  useBarkdBoardAll,
  useBarkdBoardFee,
  useBarkdCachedAddress,
  useBarkdGenerateInvoice,
  useBarkdLightningSendFee,
  useBarkdMovements,
  useBarkdOnchainAddress,
  useBarkdOnchainBalance,
  useBarkdRefresh,
  useBarkdSend,
} from '@/hooks/useBarkdWallet';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/hooks/useToast';
import { openUrl } from '@/lib/downloadFile';
import { writeClipboardText } from '@/lib/clipboard';
import { parseBolt11Amount } from '@/lib/bolt11';

function formatSats(n: number): string {
  return n.toLocaleString();
}

/** Parse a sats amount input: undefined when empty or not a positive integer. */
function parseSatsInput(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** BOLT11 invoices and BOLT12 offers can carry their own amount; Ark/LNURL/lightning addresses can't. */
function stripLightningPrefix(destination: string): string {
  return destination.trim().replace(/^lightning:/i, '');
}

function destinationNeedsAmount(destination: string): boolean {
  const d = stripLightningPrefix(destination).toLowerCase();
  if (!d) return false;
  return !(
    d.startsWith('lnbc') ||
    d.startsWith('lntb') ||
    d.startsWith('lnbcrt') ||
    d.startsWith('lno1')
  );
}

function isLightningDestination(destination: string): boolean {
  const d = stripLightningPrefix(destination).toLowerCase();
  return (
    d.startsWith('lnbc') ||
    d.startsWith('lntb') ||
    d.startsWith('lnbcrt') ||
    d.startsWith('lno1') ||
    d.startsWith('lnurl') ||
    d.includes('@')
  );
}

/** Human labels for the pending buckets in the barkd Balance type. */
const PENDING_LABELS = {
  pendingInRoundSat: 'settling in an Ark round',
  pendingBoardSat: 'confirming on-chain',
  claimableLightningReceiveSat: 'incoming Lightning',
  pendingLightningSendSat: 'Lightning send in flight',
  pendingExitSat: 'exiting on-chain',
} as const;

/** Human labels for barkd movement subsystem identifiers. */
const SUBSYSTEM_LABELS: Record<string, string> = {
  arkoor: 'Ark payment',
  board: 'On-chain deposit',
  offboard: 'Ark withdrawal',
  exit: 'Unilateral exit',
  round: 'Ark round',
  refresh: 'VTXO refresh',
  lightning: 'Lightning',
  lnreceive: 'Lightning receive',
  lnsend: 'Lightning send',
};

function prettifySubsystem(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  if (SUBSYSTEM_LABELS[key]) return SUBSYSTEM_LABELS[key];
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await writeClipboardText(value);
          setCopied(true);
          toast({ title: `${label} copied` });
          clearTimeout(timeout.current);
          timeout.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          toast({ title: 'Copy failed', description: 'Copy it manually instead.', variant: 'destructive' });
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : `Copy ${label}`}
    </Button>
  );
}

function AddressCard({
  value,
  isLoading,
  error,
  onRetry,
  copyLabel,
  hint,
}: {
  value: string | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  copyLabel: string;
  hint: string;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-xs text-destructive max-w-xs">{error.message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || !value) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <Skeleton className="size-[200px] rounded-xl" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <QRCodeSVG value={value} size={200} level="M" />
      </div>
      <p className="text-xs text-muted-foreground break-all text-center px-2 font-mono">{value}</p>
      <CopyButton value={value} label={copyLabel} />
      <p className="text-xs text-muted-foreground text-center max-w-xs">{hint}</p>
    </div>
  );
}

/** Disconnected state: connect to a barkd server, or use Ark over NWC. */
function ArkConnectView({ connection }: { connection: ReturnType<typeof useBarkdConnection> }) {
  const [url, setUrl] = useState(connection.serverUrl ?? '');
  const [password, setPassword] = useState('');

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
            on your node or VPS (docker, Umbrel, or Start9), give it an https URL (Tailscale Serve
            or Caddy works well), and enter that URL here. Your Ark wallet and keys stay on that
            server — this app only holds a session.
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
            {password && !connection.canSavePassword && (
              <p className="text-xs text-muted-foreground">
                Your signer can’t encrypt data (NIP-44), so the password won’t be saved between
                sessions.
              </p>
            )}
          </div>
          {connection.connect.isError && (
            <p className="text-xs text-destructive">{connection.connect.error.message}</p>
          )}
          {connection.sessionError && (
            <p className="text-xs text-destructive">
              Your saved session expired — reconnect below.
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
          <p className="text-xs text-muted-foreground leading-relaxed">
            Set <span className="font-mono">ALLOWED_ORIGINS</span> on the bark-web API to include
            this app’s origin. If UI auth is enabled, cross-site cookies may be blocked — prefer
            running it on a private network behind a TLS-terminating gateway (Caddy, Tailscale
            Serve).
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
  const amount = movement.effectiveBalanceSat;
  const received = amount >= 0;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div
        className={`p-1.5 rounded-full shrink-0 ${
          received
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400'
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
          {prettifySubsystem(movement.subsystem.name)} ·{' '}
          {new Date(movement.time.createdAt).toLocaleString()}
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

interface ReceivePanelProps {
  serverUrl: string;
  connected: boolean;
  arkAddress: ReturnType<typeof useBarkdArkAddress>;
  cachedArkAddress: string | undefined;
  onchainAddress: ReturnType<typeof useBarkdOnchainAddress>;
  cachedOnchainAddress: string | undefined;
  boardAll: ReturnType<typeof useBarkdBoardAll>;
  onOpenOnchainTab: () => void;
  onFreshArkAddress: () => void;
  invoice: ReturnType<typeof useBarkdGenerateInvoice>;
  invoiceAmount: string;
  setInvoiceAmount: (v: string) => void;
  invoiceDescription: string;
  setInvoiceDescription: (v: string) => void;
}

function ReceivePanel({
  serverUrl,
  connected,
  arkAddress,
  cachedArkAddress,
  onchainAddress,
  cachedOnchainAddress,
  boardAll,
  onOpenOnchainTab,
  onFreshArkAddress,
  invoice,
  invoiceAmount,
  setInvoiceAmount,
  invoiceDescription,
  setInvoiceDescription,
}: ReceivePanelProps) {
  const onchainBalance = useBarkdOnchainBalance(serverUrl, connected);

  const invoiceAmountSat = parseSatsInput(invoiceAmount);
  const spendableOnchain = onchainBalance.data?.trustedSpendableSat ?? 0;
  const incomingOnchain = onchainBalance.data?.untrustedPendingSat ?? 0;
  const boardFee = useBarkdBoardFee(serverUrl, spendableOnchain > 0 ? spendableOnchain : undefined);

  // Terminal board state is reset on mount — after a remount the inline
  // success/error line would misattribute whatever balance shows up next to
  // the old board. (In-flight boards still surface via the balance card's
  // "confirming on-chain" pending line.)
  useEffect(() => {
    if (boardAll.isSuccess || boardAll.isError) boardAll.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New funds confirming (an *increase*) make the button actionable again —
  // the decrease a successful board causes must not clear the success state.
  // null-seeded so the first data load after a cold-cache remount doesn't
  // count as an increase.
  const prevSpendable = useRef<number | null>(null);
  useEffect(() => {
    if (
      prevSpendable.current !== null &&
      spendableOnchain > prevSpendable.current &&
      (boardAll.isSuccess || boardAll.isError)
    ) {
      boardAll.reset();
    }
    prevSpendable.current = spendableOnchain;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendableOnchain]);

  return (
    <Tabs
      defaultValue="ark"
      className="w-full"
      onValueChange={(v) => {
        if (v === 'onchain') onOpenOnchainTab();
      }}
    >
      <TabsList className="mb-4">
        <TabsTrigger value="ark">Ark</TabsTrigger>
        <TabsTrigger value="lightning">Lightning</TabsTrigger>
        <TabsTrigger value="onchain">On-chain</TabsTrigger>
      </TabsList>

      <TabsContent value="ark">
        <AddressCard
          value={cachedArkAddress}
          isLoading={arkAddress.isPending && !cachedArkAddress}
          error={cachedArkAddress ? null : arkAddress.error}
          onRetry={() => arkAddress.mutate()}
          copyLabel="Ark address"          hint="Share this Ark address to receive off-chain payments from another Ark wallet."
        />
        {cachedArkAddress && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={arkAddress.isPending}
            onClick={onFreshArkAddress}
          >
            {arkAddress.isPending ? 'Generating…' : 'Generate a fresh address'}
          </Button>
        )}
      </TabsContent>

      <TabsContent value="lightning">
        {invoice.data ? (
          <div className="space-y-3">
            <AddressCard
              value={invoice.data}
              isLoading={false}
              error={null}
              onRetry={() => invoice.reset()}
              copyLabel="Invoice"
              hint="This BOLT11 invoice settles into your Ark balance as soon as it is paid."
            />
            <Button variant="outline" size="sm" className="w-full" onClick={() => invoice.reset()}>
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
                step={1}
                placeholder="1000"
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
              />
              <SatsPresetPills value={invoiceAmount} onSelect={(s) => setInvoiceAmount(String(s))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-description">Description (optional)</Label>
              <Input
                id="invoice-description"
                placeholder="What's it for?"
                value={invoiceDescription}
                onChange={(e) => setInvoiceDescription(e.target.value)}
              />
            </div>
            {invoice.isError && <p className="text-xs text-destructive">{invoice.error.message}</p>}
            <Button
              className="w-full"
              disabled={invoiceAmountSat === undefined || invoice.isPending}
              onClick={() => {
                if (invoiceAmountSat === undefined) return;
                invoice.mutate({
                  amountSat: invoiceAmountSat,
                  description: invoiceDescription || undefined,
                });
              }}
            >
              {invoice.isPending ? (
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
          value={cachedOnchainAddress}
          isLoading={onchainAddress.isPending && !cachedOnchainAddress}
          error={cachedOnchainAddress ? null : onchainAddress.error}
          onRetry={() => onchainAddress.mutate()}
          copyLabel="On-chain address"
          hint="On-chain funds land in your wallet’s on-chain balance. Once confirmed, board them into Ark below to spend them off-chain."
        />
        {onchainBalance.data !== undefined && (incomingOnchain > 0 || spendableOnchain > 0) && (
          <div className="space-y-2 pb-2">
            {incomingOnchain > 0 && (
              <p className="text-xs text-muted-foreground text-center tabular-nums">
                {formatSats(incomingOnchain)} sats incoming — awaiting confirmation
              </p>
            )}
            {spendableOnchain > 0 && (
              <>
                <p className="text-xs text-muted-foreground text-center tabular-nums">
                  On-chain balance: {formatSats(spendableOnchain)} sats
                </p>
                {boardFee.data && (
                  <p className="text-xs text-muted-foreground text-center tabular-nums">
                    Ark board fee ≈ {formatSats(boardFee.data.feeSat)} sats — an on-chain
                    transaction fee also applies
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={boardAll.isPending}
                  onClick={() => boardAll.mutate()}
                >
                  {boardAll.isPending ? (
                    <>
                      <RefreshCw className="size-4 mr-2 animate-spin" /> Boarding…
                    </>
                  ) : (
                    'Board into Ark'
                  )}
                </Button>
              </>
            )}
          </div>
        )}
        {boardAll.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400 text-center pb-2">
            Boarding started — funds appear in your Ark balance after confirmation.
          </p>
        )}
        {boardAll.isError && (
          <p className="text-xs text-destructive text-center pb-2">{boardAll.error.message}</p>
        )}
      </TabsContent>
    </Tabs>
  );
}

interface SendPanelProps {
  serverUrl: string;
  send: ReturnType<typeof useBarkdSend>;
  destination: string;
  setDestination: (v: string) => void;
  sendAmount: string;
  setSendAmount: (v: string) => void;
}

function SendPanel({
  serverUrl,
  send,
  destination,
  setDestination,
  sendAmount,
  setSendAmount,
}: SendPanelProps) {
  const amountSat = parseSatsInput(sendAmount);
  const amountInvalid = !!sendAmount.trim() && amountSat === undefined;

  // BOLT11 invoices: decode the requested amount so the user always sees a
  // number before sending. Amountless invoices need a typed amount.
  const strippedDestination = stripLightningPrefix(destination);
  const isBolt11 = /^(lnbc|lntb|lnbcrt)/.test(strippedDestination.toLowerCase());
  const invoiceAmountSat = isBolt11 ? parseBolt11Amount(strippedDestination) : null;

  const needsAmount = destinationNeedsAmount(destination) || (isBolt11 && invoiceAmountSat === null);
  const missingAmount = needsAmount && amountSat === undefined;

  // The effective amount the payment will settle for — the invoice's own
  // amount when it carries one, otherwise the typed amount. (Nano/pico-BTC
  // invoices can decode to fractional sats — round for the fee estimate.)
  const effectiveAmountSat =
    invoiceAmountSat !== null && invoiceAmountSat !== undefined
      ? Math.round(invoiceAmountSat)
      : amountSat;

  // Debounce so typing an amount doesn't fire one fee request per keystroke.
  const debouncedAmountSat = useDebounce(effectiveAmountSat, 400);
  const fee = useBarkdLightningSendFee(
    serverUrl,
    isLightningDestination(destination) ? debouncedAmountSat : undefined,
  );

  const editDestination = (v: string) => {
    setDestination(v);
    if (send.isSuccess || send.isError) send.reset();
  };
  const editAmount = (v: string) => {
    setSendAmount(v);
    if (send.isSuccess || send.isError) send.reset();
  };

  return (
    <div className="space-y-3 py-4">
      <div className="space-y-1.5">
        <Label htmlFor="send-destination">Destination</Label>
        <Input
          id="send-destination"
          placeholder="Ark address, BOLT11 invoice, BOLT12 offer, LNURL, or lightning address"
          value={destination}
          onChange={(e) => editDestination(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="send-amount">
          Amount (sats){destination.trim() && !needsAmount ? ' — optional for invoices/offers' : ''}
        </Label>
        <Input
          id="send-amount"
          type="number"
          min={1}
          step={1}
          placeholder="1000"
          value={sendAmount}
          onChange={(e) => editAmount(e.target.value)}
        />
        <SatsPresetPills value={sendAmount} onSelect={(s) => editAmount(String(s))} />
        {isBolt11 && invoiceAmountSat !== null && (
          <p className="text-xs text-muted-foreground tabular-nums">
            This invoice requests {formatSats(effectiveAmountSat ?? 0)} sats.
          </p>
        )}
        {isBolt11 && invoiceAmountSat === null && amountSat === undefined && (
          <p className="text-xs text-muted-foreground">
            This invoice has no amount — enter one below.
          </p>
        )}
        {amountInvalid && (
          <p className="text-xs text-destructive">Enter a whole number of sats.</p>
        )}
        {!amountInvalid && missingAmount && destination.trim() && !isBolt11 && (
          <p className="text-xs text-muted-foreground">
            This destination type needs an amount.
          </p>
        )}
        {fee.data && debouncedAmountSat === effectiveAmountSat && effectiveAmountSat !== undefined && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Fee estimate: {formatSats(fee.data.feeSat)} sats — total spend ≈{' '}
            {formatSats(fee.data.grossAmountSat)} sats.
          </p>
        )}
      </div>
      {send.isError && <p className="text-xs text-destructive">{send.error.message}</p>}
      {send.isSuccess && (
        <p className="text-xs text-green-600 dark:text-green-400">
          {send.data.message || 'Payment sent.'}
        </p>
      )}
      <Button
        className="w-full"
        disabled={!destination.trim() || missingAmount || amountInvalid || send.isPending}
        onClick={() =>
          send.mutate(
            { destination: strippedDestination, amountSat },
            {
              onSuccess: () => {
                setDestination('');
                setSendAmount('');
              },
            },
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
  const refresh = useBarkdRefresh(serverUrl);
  const { toast } = useToast();

  // Receive/send state is lifted here so it survives Radix unmounting the
  // inner Receive/Send/Activity panels on tab switches.
  const arkAddress = useBarkdArkAddress(serverUrl);
  const onchainAddress = useBarkdOnchainAddress(serverUrl);
  const cachedArkAddress = useBarkdCachedAddress(serverUrl, 'ark');
  const cachedOnchainAddress = useBarkdCachedAddress(serverUrl, 'onchain');
  const invoice = useBarkdGenerateInvoice(serverUrl);
  const send = useBarkdSend(serverUrl);
  const boardAll = useBarkdBoardAll(serverUrl);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDescription, setInvoiceDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [sendAmount, setSendAmount] = useState('');

  // Address generation derives a fresh HD address per call, so only fire when
  // there is no cached address yet. The cache (written by the mutations'
  // onSuccess) survives unmounts, so switching wallet tabs doesn't burn
  // keychain indexes or silently rotate the QR the user may have shared. The
  // ref latch absorbs StrictMode's double-effect in dev.
  const arkAddressCached = cachedArkAddress.data;
  const arkAddressRequested = useRef(false);
  useEffect(() => {
    if (!arkAddressCached && !arkAddressRequested.current && !arkAddress.isError) {
      arkAddressRequested.current = true;
      arkAddress.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arkAddressCached]);

  // The on-chain address derives lazily on first visit of the on-chain tab —
  // no reason to burn an index for users who only use Ark/Lightning. The ref
  // latch covers a remount while a previous derivation is still in flight.
  const onchainAddressCached = cachedOnchainAddress.data;
  const onchainAddressRequested = useRef(false);
  const ensureOnchainAddress = () => {
    if (!onchainAddressCached && !onchainAddressRequested.current && !onchainAddress.isError) {
      onchainAddressRequested.current = true;
      onchainAddress.mutate();
    }
  };

  const freshArkAddress = () => {
    arkAddress.mutate(undefined, {
      onSuccess: () =>
        toast({
          title: 'New address generated',
          description: 'Addresses you shared earlier still work.',
        }),
      onError: (error) =>
        toast({
          title: 'Couldn’t generate an address',
          description: error.message,
          variant: 'destructive',
        }),
    });
  };

  const pendingCandidates: Array<[string, number]> = [
    [PENDING_LABELS.pendingInRoundSat, balance.data?.pendingInRoundSat ?? 0],
    [PENDING_LABELS.pendingBoardSat, balance.data?.pendingBoardSat ?? 0],
    [PENDING_LABELS.claimableLightningReceiveSat, balance.data?.claimableLightningReceiveSat ?? 0],
    [PENDING_LABELS.pendingLightningSendSat, balance.data?.pendingLightningSendSat ?? 0],
    // null means "exit subsystem unavailable" (unknown, not zero) — hide it.
    [PENDING_LABELS.pendingExitSat, balance.data?.pendingExitSat ?? 0],
  ];
  const pendingEntries = pendingCandidates.filter(([, v]) => v > 0);

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
                aria-label="Refresh"
                onClick={() => refresh()}
              >
                <RefreshCw className={`size-4 ${balance.isFetching ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={connection.disconnect}
                title="Disconnect"
                aria-label="Disconnect"
              >
                <LogOut className="size-4" />
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balance.isError ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">{balance.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => balance.refetch()}>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">
                  {balance.data ? formatSats(balance.data.spendableSat) : '…'}
                </span>
                <span className="text-muted-foreground">sats</span>
              </div>
              {pendingEntries.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                  {pendingEntries.map(([label, v]) => `${formatSats(v)} ${label}`).join(' · ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Wallet hosted on your barkd server ({new URL(serverUrl).host}), refreshed every 15s.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="receive" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="send">Send</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="receive">
          <ReceivePanel
            serverUrl={serverUrl}
            connected={connection.connected}
            arkAddress={arkAddress}
            cachedArkAddress={cachedArkAddress.data}
            onchainAddress={onchainAddress}
            cachedOnchainAddress={cachedOnchainAddress.data}
            boardAll={boardAll}
            onOpenOnchainTab={ensureOnchainAddress}
            onFreshArkAddress={freshArkAddress}
            invoice={invoice}
            invoiceAmount={invoiceAmount}
            setInvoiceAmount={setInvoiceAmount}
            invoiceDescription={invoiceDescription}
            setInvoiceDescription={setInvoiceDescription}
          />
        </TabsContent>

        <TabsContent value="send">
          <SendPanel
            serverUrl={serverUrl}
            send={send}
            destination={destination}
            setDestination={setDestination}
            sendAmount={sendAmount}
            setSendAmount={setSendAmount}
          />
        </TabsContent>

        <TabsContent value="activity">
          {movements.isPending ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : movements.isError ? (
            <Card className="border-dashed mt-4">
              <CardContent className="py-10 px-8 text-center space-y-3">
                <p className="text-xs text-destructive max-w-xs mx-auto">
                  {movements.error.message}
                </p>
                <Button variant="outline" size="sm" onClick={() => movements.refetch()}>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Retry
                </Button>
              </CardContent>
            </Card>
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
