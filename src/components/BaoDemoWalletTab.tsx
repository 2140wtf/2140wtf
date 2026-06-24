import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Wallet as WalletIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { normalizeMintUrl } from '@/lib/cashu/cashu';
import type { NostrSigner } from '@nostrify/types';
import type { MintQuoteResponse } from '@cashu/cashu-ts';
import type { Transaction } from '@/lib/cashu/storage';

interface BaoDemoWalletTabProps {
  seedPhrase: string;
  user: { pubkey: string; signer: NostrSigner };
  relayUrls: string[];
}

export function BaoDemoWalletTab({ seedPhrase, user, relayUrls }: BaoDemoWalletTabProps) {
  const { toast } = useToast();
  const wallet = useBaoCashuWallet(seedPhrase, user, relayUrls, { enableAutoClaim: false });

  const [receiveTokenStr, setReceiveTokenStr] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceQuote, setInvoiceQuote] = useState<MintQuoteResponse | null>(null);

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
    const quote = await wallet.requestInvoice(amount, 'BAO Demo top-up');
    if (quote) setInvoiceQuote(quote);
  };

  const handleMint = async () => {
    if (!invoiceQuote) return;
    await wallet.mintFromQuote(invoiceQuote.quote, Number(invoiceAmount));
    setInvoiceQuote(null);
    setInvoiceAmount('');
  };

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='flex items-center justify-between text-base font-medium'>
            <span className='flex items-center gap-2'>
              <WalletIcon className='size-5 text-primary' />
              BAO Demo balance
              <Badge variant='outline'>signet</Badge>
            </span>
            <Button variant='ghost' size='icon' className='size-7' onClick={wallet.calculateAllBalances}>
              <RefreshCw className='size-4' />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wallet.loading && wallet.totalBalance === 0 ? (
            <p className='text-sm text-muted-foreground'>Loading wallet…</p>
          ) : (
            <div className='flex items-baseline gap-2'>
              <span className='text-3xl font-bold'>{wallet.totalBalance}</span>
              <span className='text-muted-foreground'>demo sats</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base font-medium'>Mint</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Select value={wallet.mintUrl} onValueChange={wallet.setMintUrl}>
            <SelectTrigger>
              <SelectValue placeholder='Select a BAO mint' />
            </SelectTrigger>
            <SelectContent>
              {wallet.allMints.map((m) => (
                <SelectItem key={normalizeMintUrl(m.url)} value={normalizeMintUrl(m.url)!}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Tabs defaultValue='receive' className='w-full'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='receive'>Receive</TabsTrigger>
          <TabsTrigger value='send'>Send</TabsTrigger>
          <TabsTrigger value='invoice'>Invoice</TabsTrigger>
        </TabsList>

        <TabsContent value='receive'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Receive Cashu token</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <Textarea
                placeholder='Paste BAO Cashu token here…'
                value={receiveTokenStr}
                onChange={(e) => setReceiveTokenStr(e.target.value)}
                rows={4}
              />
              <Button onClick={handleReceive} disabled={!receiveTokenStr.trim() || wallet.loading}>
                <ArrowDownLeft className='size-4 mr-1.5' />
                Receive token
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='send'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Send Cashu token</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
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
              {generatedToken && (
                <div className='space-y-2'>
                  <p className='text-sm font-medium'>Cashu token</p>
                  <div className='rounded-lg border bg-muted p-3 font-mono text-xs break-all'>{generatedToken}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='invoice'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Lightning deposit</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              {!invoiceQuote ? (
                <div className='flex gap-2'>
                  <Input
                    type='number'
                    placeholder='Amount in demo sats'
                    value={invoiceAmount}
                    onChange={(e) => setInvoiceAmount(e.target.value)}
                  />
                  <Button onClick={handleCreateInvoice} disabled={wallet.loading}>
                    Create invoice
                  </Button>
                </div>
              ) : (
                <div className='space-y-4'>
                  <p className='text-sm text-muted-foreground'>Pay the invoice, then mint the demo sats.</p>
                  <Button onClick={handleMint} disabled={wallet.loading}>
                    Mint {invoiceAmount} sats
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {wallet.transactions.length > 0 && (
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base font-medium'>History</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {wallet.transactions.slice(0, 20).map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))}
          </CardContent>
        </Card>
      )}
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
        <p className={`text-sm font-medium ${isReceive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isReceive ? '+' : '-'}
          {tx.amount} sats
        </p>
        <p className='text-xs text-muted-foreground truncate max-w-[140px]'>{tx.mintUrl.replace(/^https?:\/\//, '')}</p>
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
