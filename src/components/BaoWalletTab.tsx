import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bitcoin,
  Check,
  Coins,
  Copy,
  Droplets,
  Landmark,
  RefreshCw,
  Ship,
  Sparkles,
  Wallet as WalletIcon,
  Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { Button } from '@/components/ui/button';
import { SatsPresetPills } from '@/components/SatsPresetPills';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { totalBaoApiBalance, type BaoWalletBalances } from '@/lib/baoWalletApi';
import { normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import { CHASE_RAILS } from '@/pets/chase/types';
import type { NostrSigner } from '@nostrify/types';
import type { MintQuoteResponse } from '@cashu/cashu-ts';
import type { Transaction } from '@/lib/cashu/storage';

interface BaoWalletTabProps {
  seedPhrase: string;
  user: { pubkey: string; signer: NostrSigner };
  relayUrls: string[];
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
 * The Cashu rail always shows the local NIP-60 balance, because its panel
 * (CashuPanel) spends local proofs — the tile must match the panel. The
 * custodial bao.markets Cashu balance is only shown in the breakdown line
 * above. All other rails show the custodial bao.markets API balance.
 */
export function getRailBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): number {
  switch (railId) {
    case 'cashu':
      return localCashuBalance;
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
 * The Cashu tile always shows the local balance (never the custodial API
 * balance, and never falls back between the two depending on API health).
 * The Lightning tile shows the custodial bao.markets balance with an "on
 * bao.markets" qualifier, because its panel pays via the user's external
 * NWC/WebLN wallet and cannot touch the displayed custodial sats.
 */
export function getRailTileBalance(railId: WalletRailId, apiBalances: BaoWalletBalances | undefined, localCashuBalance: number): RailTileBalance {
  if (railId === 'cashu') {
    return { main: `${localCashuBalance} sats` };
  }
  if (!apiBalances) {
    return { main: '—' };
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
                <span className='text-3xl font-bold'>{cashuWallet.totalBalance}</span>
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
              {apiBalances.isError && (
                <p className='text-xs text-muted-foreground mt-2'>
                  Couldn't fetch your bao.markets balances — tap refresh to retry.
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
  const [invoiceQuote, setInvoiceQuote] = useState<MintQuoteResponse | null>(null);
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
    if (quote) setInvoiceQuote(quote);
  };

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
              <Button variant='ghost' size='sm' onClick={() => setInvoiceQuote(null)}>
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
  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [copiedToken, setCopiedToken] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceQuote, setInvoiceQuote] = useState<MintQuoteResponse | null>(null);
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
    if (quote) setInvoiceQuote(quote);
  };

  const handleMint = async () => {
    if (!invoiceQuote) return;
    await wallet.mintFromQuote(invoiceQuote.quote, Number(invoiceAmount));
    setInvoiceQuote(null);
    setInvoiceAmount('');
  };

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
          <Button onClick={handleReceive} disabled={!receiveTokenStr.trim() || wallet.loading}>
            <ArrowDownLeft className='size-4 mr-1.5' />
            Receive token
          </Button>
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
                <div className='rounded-xl bg-white p-4 shadow-sm'>
                  <QRCodeSVG value={generatedToken} size={180} level='M' />
                </div>
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
                <Button variant='ghost' size='sm' onClick={() => setInvoiceQuote(null)}>
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
