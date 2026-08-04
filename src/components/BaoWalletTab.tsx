import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bitcoin,
  Camera,
  Check,
  Coins,
  Copy,
  Droplets,
  Landmark,
  Loader2,
  RefreshCw,
  Send as SendIcon,
  Ship,
  Sparkles,
  Wallet as WalletIcon,
  Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { nip19 } from 'nostr-tools';

import { Button } from '@/components/ui/button';
import { SatsPresetPills } from '@/components/SatsPresetPills';
import { CashuTokenQr } from '@/components/CashuTokenQr';
import { QrScannerDialog } from '@/components/QrScannerDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { useBaoWalletBalances } from '@/hooks/useBaoWalletBalances';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { totalBaoApiBalance, BaoSendError, isSendRouteMissing, sendDemoSats, type BaoSendRail, type BaoWalletBalances } from '@/lib/baoWalletApi';
import { normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import { CHASE_RAILS } from '@/pets/chase/types';
import type { NostrSigner } from '@nostrify/types';
import type { Transaction } from '@/lib/cashu/storage';

interface BaoWalletTabProps {
  seedPhrase: string;
  user: { pubkey: string; signer: NostrSigner };
  relayUrls: string[];
}

/** Rails the scoped spend endpoint can debit (mirrors BAO_MARKETS ledger). */
const SEND_RAILS: Array<{ id: BaoSendRail; label: string }> = [
  { id: 'cashu', label: 'Cashu' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'ecash', label: 'Fedimint' },
  { id: 'spark', label: 'Spark' },
  { id: 'liquid', label: 'Liquid' },
  { id: 'ark', label: 'Ark' },
  { id: 'l1', label: 'L1' },
];

/** Send custodial demo sats to another ₿AO user (POST /v1/wallet/send, `user:<pubkey>`). */
function BaoSendPanel({ signer, onSent }: { signer: NostrSigner; onSent: () => void }) {
  const { toast } = useToast();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('2140');
  const [rail, setRail] = useState<BaoSendRail>('cashu');
  const [busy, setBusy] = useState(false);
  // One idempotency key per in-flight intent: a retry after an ambiguous
  // failure replays server-side instead of debiting twice.
  const idemRef = useRef<string | null>(null);

  const submit = async () => {
    const amountSats = parseInt(amount, 10) || 0;
    if (amountSats <= 0 || busy) return;
    let hex = destination.trim();
    if (hex.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(hex);
        if (decoded.type !== 'npub') throw new Error();
        hex = decoded.data;
      } catch {
        toast({ title: 'Invalid npub', description: 'Check the destination and try again.', variant: 'destructive' });
        return;
      }
    }
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      toast({ title: 'Enter an npub or 64-char hex pubkey', variant: 'destructive' });
      return;
    }
    idemRef.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const result = await sendDemoSats(signer, {
        rail,
        amountSats,
        destination: `user:${hex.toLowerCase()}`,
        idempotencyKey: idemRef.current,
      });
      toast({
        title: 'Demo sats sent',
        description: `${amountSats.toLocaleString()} sats on the ${rail} rail${typeof result.new_balance_sats === 'number' ? ` — new ${rail} balance ${result.new_balance_sats.toLocaleString()}` : ''}.`,
      });
      idemRef.current = null;
      setDestination('');
      onSent();
    } catch (e) {
      if (isSendRouteMissing(e)) {
        toast({ title: 'Coming soon', description: 'The scoped spend endpoint ships in an upcoming bao.markets API deploy.', variant: 'destructive' });
      } else if (e instanceof BaoSendError && e.code === 'INSUFFICIENT_BALANCE') {
        toast({ title: 'Insufficient balance', description: `Not enough sats on the ${rail} rail.`, variant: 'destructive' });
      } else if (e instanceof BaoSendError && e.code === 'SEND_DAILY_LIMIT') {
        toast({ title: 'Daily limit reached', description: '100,000 sats per day per user. Try again tomorrow.', variant: 'destructive' });
      } else {
        toast({ title: 'Send failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='text-base flex items-center gap-2'>
          <SendIcon className='size-4 text-primary' />
          Send demo sats
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='bao-send-dest'>To (npub or hex pubkey)</Label>
          <Input
            id='bao-send-dest'
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder='npub1…'
            autoComplete='off'
          />
        </div>
        <div className='flex gap-3'>
          <div className='space-y-1.5 flex-1'>
            <Label htmlFor='bao-send-amount'>Amount (sats)</Label>
            <Input id='bao-send-amount' value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode='numeric' />
          </div>
          <div className='space-y-1.5 w-32'>
            <Label>Rail</Label>
            <Select value={rail} onValueChange={(v) => setRail(v as BaoSendRail)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEND_RAILS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className='w-full' disabled={busy || !destination.trim() || !(parseInt(amount, 10) > 0)} onClick={() => void submit()}>
          {busy ? <Loader2 className='size-4 animate-spin' /> : `Send ${(parseInt(amount, 10) || 0).toLocaleString()} demo sats`}
        </Button>
        <p className='text-xs text-muted-foreground'>
          Debits your custodial bao.markets balance. Demo sats stay inside the ecosystem — no external withdrawals.
        </p>
      </CardContent>
    </Card>
  );
}

interface BaoMintQuote {
  quoteId: string;
  request: string;
  amount: number;
}

type WalletRailId =
  | 'lightning'
  | 'cashu'
  | 'liquid'
  | 'spark'
  | 'ark'
  | 'fedimint'
  | 'l1';

interface WalletRailConfig {
  id: WalletRailId;
  label: string;
  color: string;
  bg: string;
  icon: string;
  isReal: boolean;
}

const WALLET_RAILS: WalletRailConfig[] = [
  ...CHASE_RAILS.filter((rail) => rail.id !== 'onchain' && rail.id !== 'bitcoin').map((rail) => ({
    ...rail,
    id: rail.id as WalletRailId,
    isReal: ['lightning', 'cashu'].includes(rail.id),
  })),
  {
    id: 'fedimint',
    label: 'Fedimint',
    color: '#64748B',
    bg: '#F8FAFC',
    icon: '',
    isReal: false,
  },
  {
    id: 'l1',
    label: 'L1',
    color: '#F7931A',
    bg: '#FFF7ED',
    icon: '',
    isReal: false,
  },
];

const RAIL_BY_ID: Record<WalletRailId, WalletRailConfig> = Object.fromEntries(
  WALLET_RAILS.map((rail) => [rail.id, rail]),
) as Record<WalletRailId, WalletRailConfig>;

/** Display labels for each rail in the bao.markets API balance response. */
const API_RAIL_LABELS: Record<keyof BaoWalletBalances, string> = {
  lightning: 'Lightning',
  ecash: 'Fedimint',
  cashu: 'Cashu',
  spark: 'Spark',
  l1: 'L1',
  liquid: 'Liquid',
  ark: 'Ark',
};

/** Map a rail id to its displayed balance.
 *
 * When the bao.markets balance response is available, every tile shows that
 * same custodial ledger. Cashu falls back to the local NIP-60 balance only
 * while the remote response is unavailable, so the tiles and headline never
 * present two different sources as if they were one wallet.
 */
export function getRailBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): number {
  switch (railId) {
    case 'cashu':
      return apiBalances?.cashu ?? localCashuBalance;
    case 'lightning':
      return apiBalances?.lightning ?? 0;
    case 'liquid':
      return apiBalances?.liquid ?? 0;
    case 'spark':
      return apiBalances?.spark ?? 0;
    case 'ark':
      return apiBalances?.ark ?? 0;
    case 'fedimint':
      return apiBalances?.ecash ?? 0;
    case 'l1':
      return apiBalances?.l1 ?? 0;
    default:
      return 0;
  }
}

/** Text shown on a rail tile: the balance line plus an optional qualifier. */
export interface RailTileBalance {
  /** Main balance line, e.g. "42 sats" or "—" when the API balance is unknown. */
  main: string;
  /** Qualifier shown under the balance, e.g. "on bao.markets". */
  sub?: string;
}

/**
 * Balance text for a rail tile.
 *
 * The Cashu tile shows the custodial bao.markets balance when available and
 * falls back to the local balance while it is loading. The Lightning tile
 * shows the custodial bao.markets balance with an "on
 * bao.markets" qualifier, because its panel pays via the user's external
 * NWC/WebLN wallet and cannot touch the displayed custodial sats.
 */
export function getRailTileBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): RailTileBalance {
  if (!apiBalances) {
    return railId === 'cashu' ? { main: `${localCashuBalance} sats` } : { main: '—' };
  }
  const sats = getRailBalance(railId, apiBalances, localCashuBalance);
  if (railId === 'lightning') {
    return { main: `${sats} sats`, sub: 'on bao.markets' };
  }
  return { main: `${sats} sats` };
}

export function BaoWalletTab({ seedPhrase, user, relayUrls }: BaoWalletTabProps) {
  const [selectedRail, setSelectedRail] = useState<WalletRailId>('cashu');

  const cashuWallet = useBaoCashuWallet(seedPhrase, user, relayUrls, { enableAutoClaim: false });
  const apiBalances = useBaoWalletBalances();
  const { error: walletError, success: walletSuccess, clearError: clearWalletError, clearSuccess: clearWalletSuccess } = cashuWallet;
  const { toast } = useToast();
  const walletStatus = useWallet();
  const nwc = useNWC();

  useEffect(() => {
    if (walletError) {
      toast({
        variant: 'destructive',
        title: '₿AO wallet error',
        description: walletError,
      });
      clearWalletError();
    }
  }, [walletError, toast, clearWalletError]);

  useEffect(() => {
    if (walletSuccess) {
      toast({
        variant: 'success',
        title: '₿AO wallet',
        description: walletSuccess,
      });
      clearWalletSuccess();
    }
  }, [walletSuccess, toast, clearWalletSuccess]);

  const refreshAll = () => {
    void cashuWallet.calculateAllBalances();
    void apiBalances.refetch();
  };

  const railBalance = (railId: WalletRailId): number =>
    getRailBalance(railId, apiBalances.data, cashuWallet.totalBalance);

  const apiTotal = apiBalances.data ? totalBaoApiBalance(apiBalances.data) : null;
  const displayedTotal = apiTotal ?? cashuWallet.totalBalance;

  // Per-rail breakdown of the custodial total, so every sat in "held on
  // bao.markets" is accounted for (the total sums all 7 API rails).
  const apiBreakdown = apiBalances.data
    ? (Object.entries(API_RAIL_LABELS) as [keyof BaoWalletBalances, string][])
        .map(([key, label]) => ({ label, sats: apiBalances.data[key] }))
        .filter((rail) => rail.sats > 0)
    : [];

  // Swap guidance: local self-custody Cashu is what pets/battles spend. When
  // it's empty but the user holds sats on bao.markets rails, point them at the
  // swap instead of leaving them at a dead "0".
  const showSwapHint =
    cashuWallet.totalBalance === 0 && apiTotal !== null && apiTotal > 0;

  const selectedConfig = RAIL_BY_ID[selectedRail];

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='flex items-center justify-between text-base font-medium'>
            <span className='flex items-center gap-2'>
              <WalletIcon className='size-5 text-primary' />
              ₿AO testnet coins
              <Badge variant='outline'>signet</Badge>
            </span>
            <Button variant='ghost' size='icon' className='size-7' onClick={refreshAll}>
              <RefreshCw className='size-4' />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cashuWallet.loading && cashuWallet.totalBalance === 0 ? (
            <p className='text-sm text-muted-foreground'>Loading wallet…</p>
          ) : (
            <>
              <div className='flex items-baseline gap-2'>
                <span className='text-3xl font-bold'>{displayedTotal.toLocaleString()}</span>
                <span className='text-muted-foreground'>testnet sats</span>
              </div>
              {apiTotal !== null && (
                <p className='text-sm mt-2'>
                  <span className='tabular-nums font-medium'>{apiTotal.toLocaleString()}</span>{' '}
                  <span className='text-muted-foreground'>sats held on bao.markets across all rails</span>
                </p>
              )}
              {apiBreakdown.length > 0 && (
                <p className='text-xs text-muted-foreground mt-1 tabular-nums'>
                  {apiBreakdown.map((rail) => `${rail.label} ${rail.sats.toLocaleString()}`).join(' · ')}
                </p>
              )}
              {apiBalances.isPending && (
                <p className='text-xs text-muted-foreground mt-2'>Loading bao.markets balances…</p>
              )}
              {apiBalances.isError && (
                <p className='text-xs text-muted-foreground mt-2'>
                  Couldn't fetch your bao.markets balances — {apiBalances.error instanceof Error ? apiBalances.error.message : 'unknown error'}. Tap refresh to retry.
                </p>
              )}
              <p className='text-xs text-muted-foreground mt-3 leading-relaxed'>
                ₿AO wallet is used for educational purposes only and to empower Nostr Pets.
                ₿AO Markets project is using a private signet for testers in demo mode.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <BaoSendPanel signer={user.signer} onSent={() => void apiBalances.refetch()} />

      <div className='grid grid-cols-4 gap-3'>
        {WALLET_RAILS.map((rail) => {
          const tile = getRailTileBalance(rail.id, apiBalances.data, cashuWallet.totalBalance);
          return (
            <button
              key={rail.id}
              type='button'
              onClick={() => setSelectedRail(rail.id)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors ${
                selectedRail === rail.id
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              }`}
            >
              <div
                className='flex items-center justify-center size-10 rounded-full'
                style={{ backgroundColor: rail.bg }}
              >
                <RailIcon rail={rail} className='size-5' />
              </div>
              <span className='text-xs font-medium leading-tight'>{rail.label}</span>
              <span className='text-xs text-muted-foreground leading-tight'>{tile.main}</span>
              {tile.sub && (
                <span className='text-[10px] text-muted-foreground/70 leading-tight'>{tile.sub}</span>
              )}
            </button>
          );
        })}
      </div>

      {showSwapHint && (
        <p className='text-xs text-muted-foreground leading-relaxed rounded-lg border border-dashed p-3'>
          No Cashu on this device yet — pets and battles spend Cashu testnet coins. You have{' '}
          <span className='font-medium text-foreground'>{(apiTotal ?? 0).toLocaleString()} sats</span>{' '}
          on bao.markets
          {apiBreakdown.length > 0 && (
            <> ({apiBreakdown.map((rail) => rail.label).join(', ')})</>
          )}
          : swap them to Cashu on{' '}
          <a
            href='https://bao.markets'
            target='_blank'
            rel='noreferrer'
            className='text-primary underline underline-offset-2'
          >
            bao.markets
          </a>{' '}
          to use them here.
        </p>
      )}

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='flex items-center gap-2 text-base font-medium'>
            <RailIcon rail={selectedConfig} className='size-5' />
            {selectedConfig.label}
            {!selectedConfig.isReal && <Badge variant='secondary'>Demo rail</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedRail === 'lightning' && (
            <LightningPanel wallet={cashuWallet} walletStatus={walletStatus} nwc={nwc} />
          )}
          {selectedRail === 'cashu' && <CashuPanel wallet={cashuWallet} />}
          {['liquid', 'spark', 'ark', 'fedimint', 'l1'].includes(selectedRail) && (
            <DemoPlaceholderPanel rail={selectedConfig} balance={railBalance(selectedRail)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const RAIL_ICONS: Record<WalletRailId, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  lightning: Zap,
  cashu: Coins,
  liquid: Droplets,
  spark: Sparkles,
  ark: Ship,
  fedimint: Landmark,
  l1: Bitcoin,
};

function RailIcon({ rail, className }: { rail: WalletRailConfig; className?: string }) {
  const Icon = RAIL_ICONS[rail.id];
  if (!Icon) return null;
  return <Icon className={className} style={{ color: rail.color }} />;
}

function LightningPanel({
  wallet,
  walletStatus,
  nwc,
}: {
  wallet: ReturnType<typeof useBaoCashuWallet>;
  walletStatus: ReturnType<typeof useWallet>;
  nwc: ReturnType<typeof useNWC>;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('receive');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceQuote, setInvoiceQuote] = useState<BaoMintQuote | null>(null);
  const [dismissedQuoteId, setDismissedQuoteId] = useState<string | null>(null);
  const mintingQuoteRef = useRef<string | null>(null);
  const [payInvoiceStr, setPayInvoiceStr] = useState('');
  const [paying, setPaying] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);

  const handleCreateInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }
    const quote = await wallet.requestInvoice(amount, '₿AO Lightning invoice');
    if (quote) {
      setDismissedQuoteId(null);
      setInvoiceQuote({ quoteId: quote.quote, request: quote.request, amount });
    }
  };

  const handleMintInvoice = async () => {
    if (!invoiceQuote || mintingQuoteRef.current === invoiceQuote.quoteId) return;
    mintingQuoteRef.current = invoiceQuote.quoteId;
    try {
      const issued = await wallet.mintFromQuote(invoiceQuote.quoteId, invoiceQuote.amount);
      if (issued) {
        setInvoiceQuote(null);
        setInvoiceAmount('');
      }
    } finally {
      if (mintingQuoteRef.current === invoiceQuote.quoteId) mintingQuoteRef.current = null;
    }
  };

  useEffect(() => {
    if (invoiceQuote) return;
    const pending = [...wallet.transactions].reverse().find((transaction) =>
      transaction.type === 'mint'
      && transaction.status === 'pending'
      && safeNormalizeMintUrl(transaction.mintUrl) === safeNormalizeMintUrl(wallet.mintUrl)
      && typeof transaction.quoteId === 'string'
      && typeof transaction.paymentRequest === 'string'
      && transaction.quoteId !== dismissedQuoteId
      && transaction.bolt12 !== true,
    );
    if (!pending?.quoteId || !pending.paymentRequest) return;
    setInvoiceAmount(String(pending.amount));
    setInvoiceQuote({ quoteId: pending.quoteId, request: pending.paymentRequest, amount: pending.amount });
  }, [dismissedQuoteId, invoiceQuote, wallet.mintUrl, wallet.transactions]);

  useEffect(() => {
    if (!invoiceQuote) return;
    let active = true;
    let cancel = () => {};
    void wallet.watchMintQuote(invoiceQuote.quoteId, () => {
      if (active) void handleMintInvoice();
    }).then((stop) => {
      if (active) cancel = stop;
      else stop();
    });
    return () => {
      active = false;
      cancel();
    };
    // The quote id identifies the subscription; wallet state changes must not
    // register duplicate callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceQuote?.quoteId]);

  const handlePayInvoice = async () => {
    const invoice = payInvoiceStr.trim();
    if (!invoice) return;
    setPaying(true);
    try {
      if (walletStatus.preferredMethod === 'nwc' && walletStatus.activeNWC) {
        await nwc.sendPayment(walletStatus.activeNWC, invoice);
        toast({ title: 'Invoice paid', description: 'Paid via NWC wallet.' });
      } else if (walletStatus.preferredMethod === 'webln' && walletStatus.webln) {
        await walletStatus.webln.sendPayment(invoice);
        toast({ title: 'Invoice paid', description: 'Paid via WebLN.' });
      } else {
        toast({ variant: 'destructive', title: 'No wallet available' });
        return;
      }
      setPayInvoiceStr('');
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Payment failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setPaying(false);
    }
  };

  const copyInvoice = async () => {
    if (!invoiceQuote?.request) return;
    try {
      await navigator.clipboard.writeText(invoiceQuote.request);
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard is not available.' });
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className='w-full'>
      <TabsList className='grid w-full grid-cols-2'>
        <TabsTrigger value='receive'>Receive</TabsTrigger>
        <TabsTrigger value='send'>Send</TabsTrigger>
      </TabsList>

      <TabsContent value='receive' className='space-y-4 pt-2'>
        {!invoiceQuote ? (
          <div className='space-y-2'>
            <div className='flex gap-2'>
              <Input
                type='number'
                placeholder='Amount in demo sats'
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
              />
              <Button onClick={handleCreateInvoice} disabled={wallet.loading || !invoiceAmount}>
                <Zap className='size-4 mr-1.5' />
                Create invoice
              </Button>
            </div>
            <SatsPresetPills value={invoiceAmount} onSelect={(s) => setInvoiceAmount(String(s))} />
          </div>
        ) : (
          <div className='space-y-4 flex flex-col items-center'>
            <div className='rounded-xl bg-white p-4 shadow-sm'>
              <QRCodeSVG value={invoiceQuote.request} size={200} level='M' />
            </div>
            <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
              {invoiceQuote.request}
            </p>
            <div className='flex flex-wrap gap-2 justify-center'>
              <Button variant='outline' size='sm' onClick={copyInvoice}>
                {copiedInvoice ? (
                  <Check className='size-3.5 mr-1.5' />
                ) : (
                  <Copy className='size-3.5 mr-1.5' />
                )}
                {copiedInvoice ? 'Copied' : 'Copy invoice'}
              </Button>
              <Button size='sm' onClick={handleMintInvoice} disabled={wallet.loading}>
                Confirm payment
              </Button>
              <Button variant='ghost' size='sm' onClick={() => {
                setDismissedQuoteId(invoiceQuote.quoteId);
                setInvoiceQuote(null);
              }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value='send' className='space-y-4 pt-2'>
        {walletStatus.preferredMethod === 'manual' ? (
          <div className='text-center py-8 space-y-2'>
            <p className='text-sm text-muted-foreground font-medium'>Pay with external wallet</p>
            <p className='text-xs text-muted-foreground max-w-xs mx-auto'>
              No WebLN or NWC wallet detected. Open this invoice in your own Lightning wallet to pay it.
            </p>
          </div>
        ) : (
          <>
            <Textarea
              placeholder='Paste Lightning invoice (lnbc…) here…'
              value={payInvoiceStr}
              onChange={(e) => setPayInvoiceStr(e.target.value)}
              rows={3}
            />
            <Button
              onClick={handlePayInvoice}
              disabled={!payInvoiceStr.trim() || paying}
            >
              <ArrowUpRight className='size-4 mr-1.5' />
              {paying ? 'Paying…' : 'Pay invoice'}
            </Button>
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}

function CashuPanel({ wallet }: { wallet: ReturnType<typeof useBaoCashuWallet> }) {
  const { toast } = useToast();
  const [receiveTokenStr, setReceiveTokenStr] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceQuote, setInvoiceQuote] = useState<BaoMintQuote | null>(null);
  const [dismissedQuoteId, setDismissedQuoteId] = useState<string | null>(null);
  const mintingQuoteRef = useRef<string | null>(null);
  const [copiedInvoice, setCopiedInvoice] = useState(false);

  const handleReceive = async () => {
    if (!receiveTokenStr.trim()) return;
    await wallet.receiveToken(receiveTokenStr.trim());
    setReceiveTokenStr('');
  };

  const handleSend = async () => {
    const amount = Number(sendAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }
    const token = await wallet.sendToken(amount, sendMemo.trim());
    if (token) setGeneratedToken(token);
  };

  const handleCreateInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }
    const quote = await wallet.requestInvoice(amount, '₿AO Cashu deposit');
    if (quote) {
      setDismissedQuoteId(null);
      setInvoiceQuote({ quoteId: quote.quote, request: quote.request, amount });
    }
  };

  const handleMint = async () => {
    if (!invoiceQuote || mintingQuoteRef.current === invoiceQuote.quoteId) return;
    mintingQuoteRef.current = invoiceQuote.quoteId;
    try {
      const issued = await wallet.mintFromQuote(invoiceQuote.quoteId, invoiceQuote.amount);
      if (issued) {
        setInvoiceQuote(null);
        setInvoiceAmount('');
      }
    } finally {
      if (mintingQuoteRef.current === invoiceQuote.quoteId) mintingQuoteRef.current = null;
    }
  };

  useEffect(() => {
    if (invoiceQuote) return;
    const pending = [...wallet.transactions].reverse().find((transaction) =>
      transaction.type === 'mint'
      && transaction.status === 'pending'
      && safeNormalizeMintUrl(transaction.mintUrl) === safeNormalizeMintUrl(wallet.mintUrl)
      && typeof transaction.quoteId === 'string'
      && typeof transaction.paymentRequest === 'string'
      && transaction.quoteId !== dismissedQuoteId
      && transaction.bolt12 !== true,
    );
    if (!pending?.quoteId || !pending.paymentRequest) return;
    setInvoiceAmount(String(pending.amount));
    setInvoiceQuote({ quoteId: pending.quoteId, request: pending.paymentRequest, amount: pending.amount });
  }, [dismissedQuoteId, invoiceQuote, wallet.mintUrl, wallet.transactions]);

  useEffect(() => {
    if (!invoiceQuote) return;
    let active = true;
    let cancel = () => {};
    void wallet.watchMintQuote(invoiceQuote.quoteId, () => {
      if (active) void handleMint();
    }).then((stop) => {
      if (active) cancel = stop;
      else stop();
    });
    return () => {
      active = false;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceQuote?.quoteId]);

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard is not available.' });
    }
  };

  return (
    <div className='space-y-5'>
      <div className='flex items-baseline gap-2'>
        <span className='text-3xl font-bold'>{wallet.totalBalance}</span>
        <span className='text-muted-foreground'>demo sats</span>
      </div>

      <Select value={wallet.mintUrl} onValueChange={wallet.setMintUrl}>
        <SelectTrigger>
          <SelectValue placeholder='Select a ₿AO mint' />
        </SelectTrigger>
        <SelectContent>
          {wallet.allMints.map((m) => (
            <SelectItem key={normalizeMintUrl(m.url)} value={safeNormalizeMintUrl(m.url)}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Tabs defaultValue='receive' className='w-full'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='receive'>Receive</TabsTrigger>
          <TabsTrigger value='send'>Send</TabsTrigger>
          <TabsTrigger value='invoice'>Invoice</TabsTrigger>
        </TabsList>

        <TabsContent value='receive' className='space-y-4 pt-2'>
          <Textarea
            placeholder='Paste ₿AO Cashu token here…'
            value={receiveTokenStr}
            onChange={(e) => setReceiveTokenStr(e.target.value)}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleReceive} disabled={!receiveTokenStr.trim() || wallet.loading}>
              <ArrowDownLeft className='size-4 mr-1.5' />
              Receive token
            </Button>
            <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
              <Camera className="size-4 mr-1.5" />
              Scan QR
            </Button>
          </div>
        </TabsContent>

        <TabsContent value='send' className='space-y-4 pt-2'>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col sm:flex-row gap-2'>
              <Input
                type='number'
                placeholder='Amount in demo sats'
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
              />
              <Input
                placeholder='Memo (optional)'
                value={sendMemo}
                onChange={(e) => setSendMemo(e.target.value)}
              />
              <Button onClick={handleSend} disabled={!sendAmount || wallet.loading}>
                <ArrowUpRight className='size-4 mr-1.5' />
                Generate token
              </Button>
            </div>
            <SatsPresetPills value={sendAmount} onSelect={(s) => setSendAmount(String(s))} />
            {generatedToken && (
              <div className='space-y-4 flex flex-col items-center pt-2'>
                <CashuTokenQr token={generatedToken} size={180} />
                <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
                  {generatedToken}
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => copyToClipboard(generatedToken, setCopiedToken)}
                >
                  {copiedToken ? (
                    <Check className='size-3.5 mr-1.5' />
                  ) : (
                    <Copy className='size-3.5 mr-1.5' />
                  )}
                  {copiedToken ? 'Copied' : 'Copy token'}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value='invoice' className='space-y-4 pt-2'>
          {!invoiceQuote ? (
            <div className='space-y-2'>
              <div className='flex gap-2'>
                <Input
                  type='number'
                  placeholder='Amount in demo sats'
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                />
                <Button onClick={handleCreateInvoice} disabled={wallet.loading || !invoiceAmount}>
                  Create invoice
                </Button>
              </div>
              <SatsPresetPills value={invoiceAmount} onSelect={(s) => setInvoiceAmount(String(s))} />
            </div>
          ) : (
            <div className='space-y-4 flex flex-col items-center'>
              <div className='rounded-xl bg-white p-4 shadow-sm'>
                <QRCodeSVG value={invoiceQuote.request} size={180} level='M' />
              </div>
              <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
                {invoiceQuote.request}
              </p>
              <div className='flex flex-wrap gap-2 justify-center'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => copyToClipboard(invoiceQuote.request, setCopiedInvoice)}
                >
                  {copiedInvoice ? (
                    <Check className='size-3.5 mr-1.5' />
                  ) : (
                    <Copy className='size-3.5 mr-1.5' />
                  )}
                  {copiedInvoice ? 'Copied' : 'Copy invoice'}
                </Button>
                <Button size='sm' onClick={handleMint} disabled={wallet.loading}>
                  Confirm payment
                </Button>
                <Button variant='ghost' size='sm' onClick={() => {
                  setDismissedQuoteId(invoiceQuote.quoteId);
                  setInvoiceQuote(null);
                }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {wallet.transactions.length > 0 && (
        <div className='space-y-2'>
          <p className='text-sm font-medium'>History</p>
          {wallet.transactions.slice(0, 20).map((tx) => (
            <TxRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}
      <QrScannerDialog
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Scan ₿AO Cashu token"
        onScan={(token) => {
          setReceiveTokenStr(token);
          setScannerOpen(false);
        }}
      />
    </div>
  );
}

function DemoPlaceholderPanel({ rail, balance }: { rail: WalletRailConfig; balance: number }) {
  return (
    <div className='space-y-5'>
      <div className='flex items-baseline gap-2'>
        <span className='text-3xl font-bold'>{balance}</span>
        <span className='text-muted-foreground'>demo sats on bao.markets</span>
      </div>

      <Tabs defaultValue='receive' className='w-full'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='receive'>Receive</TabsTrigger>
          <TabsTrigger value='send'>Send</TabsTrigger>
        </TabsList>

        <TabsContent value='receive' className='pt-4'>
          <p className='text-sm text-muted-foreground text-center py-6'>
            {rail.label} deposits are managed on bao.markets — your balance above is read from there.
          </p>
        </TabsContent>

        <TabsContent value='send' className='pt-4'>
          <p className='text-sm text-muted-foreground text-center py-6'>
            {rail.label} withdrawals are managed on bao.markets.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isReceive = tx.type === 'receive' || tx.type === 'mint';
  return (
    <div className='flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors'>
      <div className='flex items-center gap-3'>
        <div
          className={`flex items-center justify-center size-8 rounded-full ${
            isReceive
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {isReceive ? <ArrowDownLeft className='size-4' /> : <ArrowUpRight className='size-4' />}
        </div>
        <div>
          <p className='text-sm font-medium capitalize'>{tx.type}</p>
          <p className='text-xs text-muted-foreground'>{formatDate(tx.createdAt)}</p>
        </div>
      </div>
      <div className='text-right'>
        <p
          className={`text-sm font-medium ${
            isReceive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {isReceive ? '+' : '-'}
          {tx.amount} sats
        </p>
        <p className='text-xs text-muted-foreground truncate max-w-[140px]'>
          {tx.mintUrl.replace(/^https?:\/\//, '')}
        </p>
      </div>
    </div>
  );
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
