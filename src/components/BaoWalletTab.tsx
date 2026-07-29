import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
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
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
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
  | 'fedimint';

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
];

const RAIL_BY_ID: Record<WalletRailId, WalletRailConfig> = Object.fromEntries(
  WALLET_RAILS.map((rail) => [rail.id, rail]),
) as Record<WalletRailId, WalletRailConfig>;

export function BaoWalletTab({ seedPhrase, user, relayUrls }: BaoWalletTabProps) {
  const [selectedRail, setSelectedRail] = useState<WalletRailId>('cashu');

  const cashuWallet = useBaoCashuWallet(seedPhrase, user, relayUrls, { enableAutoClaim: false });
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
  };

  const getRailBalance = (railId: WalletRailId): number => {
    switch (railId) {
      case 'cashu':
        return cashuWallet.totalBalance;
      default:
        return 0;
    }
  };

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
              <p className='text-xs text-muted-foreground mt-3 leading-relaxed'>
                ₿AO wallet is used for educational purposes only and to empower Nostr Pets.
                ₿AO Markets project is using a private signet for testers in demo mode.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className='grid grid-cols-4 gap-3'>
        {WALLET_RAILS.map((rail) => (
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
            <span className='text-xs text-muted-foreground leading-tight'>
              {getRailBalance(rail.id)} sats
            </span>
          </button>
        ))}
      </div>

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
          {['liquid', 'spark', 'ark', 'fedimint'].includes(selectedRail) && (
            <DemoPlaceholderPanel rail={selectedConfig} />
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

function DemoPlaceholderPanel({ rail }: { rail: WalletRailConfig }) {
  return (
    <div className='space-y-5'>
      <div className='flex items-baseline gap-2'>
        <span className='text-3xl font-bold'>0</span>
        <span className='text-muted-foreground'>demo sats</span>
      </div>

      <Tabs defaultValue='receive' className='w-full'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='receive'>Receive</TabsTrigger>
          <TabsTrigger value='send'>Send</TabsTrigger>
        </TabsList>

        <TabsContent value='receive' className='pt-4'>
          <p className='text-sm text-muted-foreground text-center py-6'>
            {rail.label} deposits are not available in this demo.
          </p>
        </TabsContent>

        <TabsContent value='send' className='pt-4'>
          <p className='text-sm text-muted-foreground text-center py-6'>
            {rail.label} withdrawals are not available in this demo.
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
