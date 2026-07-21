import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CloudDownload,
  Copy,
  RefreshCw,
  Shield,
  Trash2,
  Wallet as WalletIcon,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/useToast';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { DEFAULT_MINTS, normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import type { Transaction } from '@/lib/cashu/storage';
import type { MintQuoteResponse } from '@cashu/cashu-ts';

export function CashuWalletTab() {
  const { toast } = useToast();
  const wallet = useCashuWalletContext();
  const { error: walletError, success: walletSuccess, clearError: clearWalletError, clearSuccess: clearWalletSuccess } = wallet;

  const [receiveTokenStr, setReceiveTokenStr] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceQuote, setInvoiceQuote] = useState<MintQuoteResponse | null>(null);

  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [sendInvoice, setSendInvoice] = useState('');

  const [mintName, setMintName] = useState('');
  const [mintUrl, setMintUrl] = useState('');

  const [showSeedBackup, setShowSeedBackup] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [nutzapRecipient, setNutzapRecipient] = useState('');
  const [nutzapAmount, setNutzapAmount] = useState('');
  const [nutzapMemo, setNutzapMemo] = useState('');
  const [nutzapMintUrl, setNutzapMintUrl] = useState('');

  useEffect(() => {
    if (nutzapMintUrl === '' && wallet.mintUrl) {
      setNutzapMintUrl(wallet.mintUrl);
    }
  }, [wallet.mintUrl, nutzapMintUrl]);

  useEffect(() => {
    if (walletError) {
      toast({
        variant: 'destructive',
        title: 'Cashu wallet error',
        description: walletError,
      });
      clearWalletError();
    }
  }, [walletError, toast, clearWalletError]);

  useEffect(() => {
    if (walletSuccess) {
      toast({
        variant: 'success',
        title: 'Cashu wallet',
        description: walletSuccess,
      });
      clearWalletSuccess();
    }
  }, [walletSuccess, toast, clearWalletSuccess]);

  const customMints = useMemo(() => {
    return wallet.allMints.filter(
      (m) => !DEFAULT_MINTS.some((d) => normalizeMintUrl(d.url) === normalizeMintUrl(m.url)),
    );
  }, [wallet.allMints]);

  const handleReceiveToken = async () => {
    if (!receiveTokenStr.trim()) return;
    await wallet.receiveToken(receiveTokenStr.trim());
    setReceiveTokenStr('');
  };

  const handleCreateInvoice = async () => {
    const amount = parseInt(invoiceAmount, 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    const quote = await wallet.requestInvoice(amount, '2140.wtf Cashu deposit');
    if (quote) setInvoiceQuote(quote);
  };

  const handleMintInvoice = async () => {
    if (!invoiceQuote) return;
    await wallet.mintFromQuote(invoiceQuote.quote, invoiceQuote.amount);
    setInvoiceQuote(null);
    setInvoiceAmount('');
  };

  const handleSendToken = async () => {
    const amount = parseInt(sendAmount, 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    const token = await wallet.sendToken(amount, sendMemo.trim());
    if (token) setGeneratedToken(token);
  };

  const handlePayInvoice = async () => {
    const invoice = sendInvoice.trim();
    if (!invoice) return;
    const result = await wallet.payInvoice(invoice);
    if (result.success) {
      setSendInvoice('');
    }
  };

  const handleSendNutzap = async () => {
    const amount = parseInt(nutzapAmount, 10);
    if (Number.isNaN(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    if (!nutzapRecipient.trim() || !nutzapMintUrl) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Recipient and mint are required.' });
      return;
    }
    const ok = await wallet.sendNutzap(amount, nutzapRecipient.trim(), nutzapMintUrl, { memo: nutzapMemo.trim() });
    if (ok) {
      setNutzapAmount('');
      setNutzapRecipient('');
      setNutzapMemo('');
    }
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

  const handleAddMint = () => {
    if (!mintName.trim() || !mintUrl.trim()) return;
    wallet.addCustomMint(mintName.trim(), mintUrl.trim());
    setMintName('');
    setMintUrl('');
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const payload = await wallet.fetchBackup();
      if (payload) {
        await wallet.restoreFromBackup(payload);
      } else {
        toast({ title: 'No backup found', description: 'Could not find a Cashu backup on your relays.' });
      }
    } finally {
      setRestoring(false);
    }
  };

  const backupBadge = () => {
    switch (wallet.backupStatus) {
      case 'synced':
        return <Badge variant='secondary' className='bg-green-500/10 text-green-600 dark:text-green-400'>Backed up</Badge>;
      case 'syncing':
        return <Badge variant='secondary'><RefreshCw className='size-3 mr-1 animate-spin' /> Syncing</Badge>;
      case 'failed':
        return <Badge variant='destructive'>Backup failed</Badge>;
      default:
        return <Badge variant='outline'>Backup idle</Badge>;
    }
  };

  return (
    <div className='space-y-6'>
        {/* Balance */}
        <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='flex items-center justify-between text-base font-medium'>
            <span className='flex items-center gap-2'>
              <WalletIcon className='size-5 text-primary' />
              Cashu balance
            </span>
            <div className='flex items-center gap-2'>
              {backupBadge()}
              <Button variant='ghost' size='icon' className='size-7' onClick={wallet.calculateAllBalances}>
                <RefreshCw className='size-4' />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wallet.loading && wallet.totalBalance === 0 ? (
            <p className='text-sm text-muted-foreground'>Loading wallet…</p>
          ) : (
            <div className='flex items-baseline gap-2'>
              <span className='text-3xl font-bold'>{wallet.totalBalance}</span>
              <span className='text-muted-foreground'>sats</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mint selector + custom mints */}
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-base font-medium'>Mint</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Select value={wallet.mintUrl} onValueChange={wallet.setMintUrl}>
            <SelectTrigger>
              <SelectValue placeholder='Select a mint' />
            </SelectTrigger>
            <SelectContent>
              {wallet.allMints.map((m) => (
                <SelectItem key={normalizeMintUrl(m.url)} value={safeNormalizeMintUrl(m.url)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {customMints.length > 0 && (
            <div className='space-y-2'>
              <p className='text-xs text-muted-foreground'>Custom mints</p>
              <div className='flex flex-wrap gap-2'>
                {customMints.map((m) => (
                  <Badge key={normalizeMintUrl(m.url)} variant='secondary' className='flex items-center gap-1.5 pr-1'>
                    {m.name}
                    <button
                      className='rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive'
                      onClick={() => wallet.removeCustomMint(m.url)}
                      aria-label={`Remove ${m.name}`}
                    >
                      <Trash2 className='size-3' />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className='flex gap-2'>
            <Input
              placeholder='Mint name'
              value={mintName}
              onChange={(e) => setMintName(e.target.value)}
            />
            <Input
              placeholder='https://mint.example.com'
              value={mintUrl}
              onChange={(e) => setMintUrl(e.target.value)}
            />
            <Button onClick={handleAddMint} disabled={!mintName.trim() || !mintUrl.trim()}>
              Add
            </Button>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' onClick={() => setShowSeedBackup(true)}>
              <Shield className='size-3.5 mr-1.5' />
              Reveal seed
            </Button>
            <Button variant='outline' size='sm' onClick={handleRestore} disabled={restoring}>
              <CloudDownload className='size-3.5 mr-1.5' />
              {restoring ? 'Restoring…' : 'Restore backup'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Receive / Send tabs */}
      <Tabs defaultValue='receive' className='w-full'>
        <TabsList className='grid w-full grid-cols-3'>
          <TabsTrigger value='receive'>Receive</TabsTrigger>
          <TabsTrigger value='send'>Send</TabsTrigger>
          <TabsTrigger value='nutzaps'>Nutzaps</TabsTrigger>
        </TabsList>

        <TabsContent value='receive'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Receive sats</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue='token'>
                <TabsList className='mb-4'>
                  <TabsTrigger value='token'>Cashu token</TabsTrigger>
                  <TabsTrigger value='invoice'>Lightning invoice</TabsTrigger>
                </TabsList>

                <TabsContent value='token' className='space-y-4'>
                  <Textarea
                    placeholder='Paste Cashu token here…'
                    value={receiveTokenStr}
                    onChange={(e) => setReceiveTokenStr(e.target.value)}
                    rows={4}
                  />
                  <Button onClick={handleReceiveToken} disabled={!receiveTokenStr.trim() || wallet.loading}>
                    <ArrowDownLeft className='size-4 mr-1.5' />
                    Receive token
                  </Button>
                </TabsContent>

                <TabsContent value='invoice' className='space-y-4'>
                  {!invoiceQuote ? (
                    <div className='flex gap-2'>
                      <Input
                        type='number'
                        placeholder='Amount in sats'
                        value={invoiceAmount}
                        onChange={(e) => setInvoiceAmount(e.target.value)}
                      />
                      <Button onClick={handleCreateInvoice} disabled={wallet.loading}>
                        Create invoice
                      </Button>
                    </div>
                  ) : (
                    <div className='space-y-4 flex flex-col items-center'>
                      <div className='rounded-xl bg-white p-4 shadow-sm'>
                        <QRCodeSVG value={invoiceQuote.request} size={200} level='M' />
                      </div>
                      <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
                        {invoiceQuote.request}
                      </p>
                      <div className='flex gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => copyToClipboard(invoiceQuote.request, setCopiedInvoice)}
                        >
                          {copiedInvoice ? <Check className='size-3.5 mr-1.5' /> : <Copy className='size-3.5 mr-1.5' />}
                          {copiedInvoice ? 'Copied' : 'Copy invoice'}
                        </Button>
                        <Button size='sm' onClick={handleMintInvoice} disabled={wallet.loading}>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='send'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Send sats</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue='token'>
                <TabsList className='mb-4'>
                  <TabsTrigger value='token'>Cashu token</TabsTrigger>
                  <TabsTrigger value='invoice'>Pay invoice</TabsTrigger>
                </TabsList>

                <TabsContent value='token' className='space-y-4'>
                  <div className='flex gap-2'>
                    <Input
                      type='number'
                      placeholder='Amount in sats'
                      value={sendAmount}
                      onChange={(e) => setSendAmount(e.target.value)}
                    />
                    <Input
                      placeholder='Memo (optional)'
                      value={sendMemo}
                      onChange={(e) => setSendMemo(e.target.value)}
                    />
                    <Button onClick={handleSendToken} disabled={wallet.loading}>
                      <ArrowUpRight className='size-4 mr-1.5' />
                      Generate token
                    </Button>
                  </div>
                  {generatedToken && (
                    <div className='space-y-4 flex flex-col items-center pt-2'>
                      <div className='rounded-xl bg-white p-4 shadow-sm'>
                        <QRCodeSVG value={generatedToken} size={200} level='M' />
                      </div>
                      <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
                        {generatedToken}
                      </p>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => copyToClipboard(generatedToken, setCopiedToken)}
                      >
                        {copiedToken ? <Check className='size-3.5 mr-1.5' /> : <Copy className='size-3.5 mr-1.5' />}
                        {copiedToken ? 'Copied' : 'Copy token'}
                      </Button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value='invoice' className='space-y-4'>
                  <Textarea
                    placeholder='Paste Lightning invoice (lnbc…) here…'
                    value={sendInvoice}
                    onChange={(e) => setSendInvoice(e.target.value)}
                    rows={3}
                  />
                  <Button onClick={handlePayInvoice} disabled={!sendInvoice.trim() || wallet.loading}>
                    <ArrowUpRight className='size-4 mr-1.5' />
                    Pay invoice
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='nutzaps'>
          <Card>
            <CardHeader className='pb-2'>
              <CardTitle className='text-base font-medium'>Send Nutzap</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <Input
                placeholder='Recipient npub or nprofile…'
                value={nutzapRecipient}
                onChange={(e) => setNutzapRecipient(e.target.value)}
              />
              <div className='flex gap-2'>
                <Input
                  type='number'
                  placeholder='Amount in sats'
                  value={nutzapAmount}
                  onChange={(e) => setNutzapAmount(e.target.value)}
                />
                <Select value={nutzapMintUrl} onValueChange={setNutzapMintUrl}>
                  <SelectTrigger className='min-w-[140px]'>
                    <SelectValue placeholder='Select mint' />
                  </SelectTrigger>
                  <SelectContent>
                    {wallet.allMints.map((m) => (
                      <SelectItem key={m.url} value={m.url}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder='Memo (optional)'
                value={nutzapMemo}
                onChange={(e) => setNutzapMemo(e.target.value)}
              />
              <Button
                onClick={handleSendNutzap}
                disabled={!nutzapRecipient.trim() || !nutzapAmount || !nutzapMintUrl || wallet.loading}
              >
                <Zap className='size-4 mr-1.5' />
                Send Nutzap
              </Button>

              {wallet.nutzaps.length > 0 && (
                <div className='pt-4 border-t'>
                  <p className='text-sm font-medium mb-2'>Received Nutzaps</p>
                  <div className='space-y-2'>
                    {wallet.nutzaps.map((ev) => (
                      <div key={ev.id} className='flex items-center justify-between rounded-lg border p-2 text-sm'>
                        <span className='font-mono text-xs'>{ev.id.slice(0, 16)}…</span>
                        <span className='text-muted-foreground'>{new Date(ev.created_at * 1000).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transactions */}
      {wallet.transactions.length > 0 && (
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base font-medium'>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className='h-64 pr-3'>
              <div className='space-y-2'>
                {wallet.transactions.map((tx) => (
                  <TxRow key={tx.id} tx={tx} />
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Seed backup dialog */}
      <Dialog open={showSeedBackup} onOpenChange={setShowSeedBackup}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seed phrase backup</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              Write down these 12 words. They are the only way to restore your Cashu wallet.
            </p>
            <div className='rounded-lg border bg-muted p-4 font-mono text-sm break-words'>
              {wallet.seedPhrase}
            </div>
            <Button onClick={() => setShowSeedBackup(false)} className='w-full'>
              I have saved my seed
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
