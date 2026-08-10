import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CloudDownload,
  Copy,
  Camera,
  Landmark,
  RefreshCw,
  Shield,
  Settings2,
  Trash2,
  Wallet as WalletIcon,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SatsPresetPills } from '@/components/SatsPresetPills';
import { CashuTokenQr } from '@/components/CashuTokenQr';
import { QrScannerDialog } from '@/components/QrScannerDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Link } from 'react-router-dom';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import type { Transaction } from '@/lib/cashu/storage';
import type { Nut15PaymentPlan } from '@/lib/cashu/nut15';
interface DepositQuote {
  method: 'bolt11' | 'bolt12';
  quoteId: string;
  request: string;
  amount: number;
}

export function CashuWalletTab() {
  const mintingQuoteRef = useRef<string | null>(null);
  const { toast } = useToast();
  const wallet = useCashuWalletContext();
  const { user } = useCurrentUser();
  const { error: walletError, success: walletSuccess, clearError: clearWalletError, clearSuccess: clearWalletSuccess } = wallet;

  const [receiveTokenStr, setReceiveTokenStr] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState<'bolt11' | 'bolt12'>('bolt11');
  const [invoiceQuote, setInvoiceQuote] = useState<DepositQuote | null>(null);
  const [dismissedQuoteId, setDismissedQuoteId] = useState<string | null>(null);

  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  // The generated send token is persisted in localStorage (scoped by user +
  // mint) because sendToken debits the wallet and clears its send-recovery
  // journal after encoding — a useState-only copy is destroyed when this tab
  // unmounts (tab switch / navigation), burning the sats. It stays here
  // until the user dismisses it.
  const sendOutboxKey = `bao_cashu_wallet_send_${user?.pubkey ?? 'anon'}_${wallet.mintUrl ?? 'default'}`;
  const [generatedToken, setGeneratedToken] = useLocalStorage<string>(sendOutboxKey, '');
  const [sendInvoice, setSendInvoice] = useState('');
  const [multiPathPlan, setMultiPathPlan] = useState<Nut15PaymentPlan | null>(null);

  const [mintName, setMintName] = useState('');
  const [mintUrl, setMintUrl] = useState('');
  const [manageMintsOpen, setManageMintsOpen] = useState(false);
  const [removingMintUrl, setRemovingMintUrl] = useState<string | null>(null);
  const [pendingMintRemoval, setPendingMintRemoval] = useState<{ name: string; url: string; balance: number } | null>(null);

  const [showSeedBackup, setShowSeedBackup] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [recoveringFromMint, setRecoveringFromMint] = useState(false);
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

  const handleRemoveMint = async (name: string, url: string, expectedBalance?: number) => {
    setRemovingMintUrl(url);
    try {
      const result = await wallet.removeCustomMint(url, expectedBalance);
      if (result.status === 'confirmation-required') {
        setPendingMintRemoval({ name, url, balance: result.balance });
      } else if (result.status === 'removed') {
        setPendingMintRemoval(null);
        toast({ variant: 'success', title: 'Mint removed', description: `${name} was removed from this wallet.` });
      }
    } finally {
      setRemovingMintUrl(null);
    }
  };

  const supportsBolt12Mint = Array.isArray(wallet.mintInfo?.nuts?.['4']?.methods)
    && wallet.mintInfo.nuts['4'].methods.some((method: { method?: unknown; unit?: unknown }) => method.method === 'bolt12' && method.unit === 'sat');

  useEffect(() => {
    if (!supportsBolt12Mint && depositMethod === 'bolt12') setDepositMethod('bolt11');
    setInvoiceQuote(null);
  }, [wallet.mintUrl, supportsBolt12Mint, depositMethod]);

  useEffect(() => {
    if (invoiceQuote) return;
    const pending = [...wallet.transactions]
      .reverse()
      .find((transaction) =>
        transaction.type === 'mint'
        && transaction.status === 'pending'
        && safeNormalizeMintUrl(transaction.mintUrl) === safeNormalizeMintUrl(wallet.mintUrl)
        && typeof transaction.quoteId === 'string'
        && typeof transaction.paymentRequest === 'string'
        && transaction.quoteId !== dismissedQuoteId,
      );
    if (!pending?.quoteId || !pending.paymentRequest) return;
    setInvoiceAmount(String(pending.amount));
    setInvoiceQuote({
      method: pending.bolt12 ? 'bolt12' : 'bolt11',
      quoteId: pending.quoteId,
      request: pending.paymentRequest,
      amount: pending.amount,
    });
  }, [dismissedQuoteId, invoiceQuote, wallet.mintUrl, wallet.transactions]);

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
    if (depositMethod === 'bolt12') {
      const quote = await wallet.requestBolt12Offer(amount, '2140.wtf Cashu deposit');
      if (quote) setInvoiceQuote({ method: 'bolt12', quoteId: quote.quote, request: quote.request, amount });
    } else {
      const quote = await wallet.requestInvoice(amount, '2140.wtf Cashu deposit');
      if (quote) setInvoiceQuote({ method: 'bolt11', quoteId: quote.quote, request: quote.request, amount });
    }
  };

  const handleMintInvoice = async () => {
    if (!invoiceQuote) return;
    if (mintingQuoteRef.current === invoiceQuote.quoteId) return;
    mintingQuoteRef.current = invoiceQuote.quoteId;
    try {
      const issued = await wallet.mintFromQuote(invoiceQuote.quoteId, invoiceQuote.amount, invoiceQuote.method);
      if (issued && invoiceQuote.method === 'bolt11') {
        setInvoiceQuote(null);
        setInvoiceAmount('');
      }
    } finally {
      if (mintingQuoteRef.current === invoiceQuote.quoteId) mintingQuoteRef.current = null;
    }
  };

  // NUT-17: supported mints can advance the deposit as soon as Lightning
  // settles. The button stays available as a polling fallback for older mints
  // and WebViews where the WebSocket cannot connect.
  useEffect(() => {
    if (!invoiceQuote || typeof wallet.watchMintQuote !== 'function') return;
    let active = true;
    let cancel = () => {};
    void wallet.watchMintQuote(invoiceQuote.quoteId, () => {
      if (!active) return;
      void handleMintInvoice();
    }, invoiceQuote.method).then((stop) => {
      if (active) cancel = stop;
      else stop();
    });
    return () => {
      active = false;
      cancel();
    };
  // The quote id identifies this subscription; recreating it for unrelated
  // wallet state changes can register duplicate callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceQuote?.quoteId, invoiceQuote?.method]);

  // NUT-17 is the fast path, but browser WebSockets can be blocked by a
  // relay/mint proxy, a restrictive network, or a WebView. Keep checking the
  // quote over the normal HTTPS API so a paid Lightning invoice is not left
  // waiting for the user to press Mint manually. The mintFromQuote mutex and
  // mintingQuoteRef make this safe if polling and NUT-17 notice payment at
  // the same time.
  useEffect(() => {
    if (!invoiceQuote || invoiceQuote.method !== 'bolt11') return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (!active || checking || mintingQuoteRef.current === invoiceQuote.quoteId) return;
      checking = true;
      try {
        const updated = await wallet.checkMintQuote({
          quote: invoiceQuote.quoteId,
          request: invoiceQuote.request,
          state: 'UNPAID',
          amount: invoiceQuote.amount,
          unit: 'sat',
          expiry: Math.floor(Date.now() / 1000) + 3600,
        });
        if (active && (updated?.state === 'PAID' || updated?.state === 'ISSUED')) {
          await handleMintInvoice();
        }
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // The quote id is intentionally the only lifecycle dependency; changing
    // wallet state while this quote is pending must not create duplicate polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceQuote?.quoteId, invoiceQuote?.method]);

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

  const handlePrepareMultiPath = async () => {
    const invoice = sendInvoice.trim();
    if (!invoice) return;
    setMultiPathPlan(await wallet.prepareMultiPathPayment(invoice));
  };

  const handleConfirmMultiPath = async () => {
    if (!multiPathPlan) return;
    const result = await wallet.executeMultiPathPayment(multiPathPlan);
    if (result.success) setSendInvoice('');
    setMultiPathPlan(null);
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
    const result = await wallet.sendNutzap(amount, nutzapRecipient.trim(), nutzapMintUrl, { memo: nutzapMemo.trim() });
    if (result.status === 'sent') {
      setNutzapAmount('');
      setNutzapRecipient('');
      setNutzapMemo('');
    } else if (result.status === 'pending') {
      // Sats left the wallet; the nutzap is queued for auto-retry. Clear the
      // form so the user does not send twice.
      setNutzapAmount('');
      setNutzapRecipient('');
      setNutzapMemo('');
      toast({ title: 'Nutzap queued', description: 'The payment is being delivered — no need to send it again.' });
    } else if (result.status === 'unknown') {
      // The mint may have committed — keep the form and warn against a blind
      // retry: a second send would double-pay.
      toast({ variant: 'destructive', title: 'Payment outcome unknown', description: 'The mint may still have processed it. Check your balance before sending again.' });
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

  const handleMintRecovery = async () => {
    setRecoveringFromMint(true);
    try {
      await wallet.recoverFromMints();
    } finally {
      setRecoveringFromMint(false);
    }
  };

  const backupBadge = () => {
    switch (wallet.nip60Status) {
      case 'verified':
        return <Badge variant='secondary' className='bg-green-500/10 text-green-600 dark:text-green-400'>Relay backup verified</Badge>;
      case 'verifying':
        return <Badge variant='secondary'><RefreshCw className='size-3 mr-1 animate-spin' /> Verifying relay backup</Badge>;
      case 'failed':
        return <Badge variant='destructive'>Relay backup failed</Badge>;
      default:
        return <Badge variant='outline'>Local only</Badge>;
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

          <Button variant='outline' size='sm' className='w-full gap-2' onClick={() => setManageMintsOpen(true)}>
            <Settings2 className='size-4' />
            Manage mints
          </Button>

          <div className='grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto]'>
            <Input
              className='min-w-0'
              placeholder='Mint name'
              value={mintName}
              onChange={(e) => setMintName(e.target.value)}
            />
            <Input
              className='min-w-0'
              placeholder='https://mint.example.com'
              value={mintUrl}
              onChange={(e) => setMintUrl(e.target.value)}
            />
            <Button className='w-full sm:w-auto' onClick={handleAddMint} disabled={!mintName.trim() || !mintUrl.trim()}>
              Add
            </Button>
          </div>

          <Button variant='outline' size='sm' className='w-full gap-2' asChild>
            <Link to='/mints'>
              <Landmark className='size-4' />
              Discover mints
            </Link>
          </Button>

          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' onClick={() => setShowSeedBackup(true)}>
              <Shield className='size-3.5 mr-1.5' />
              Reveal seed
            </Button>
            <Button variant='outline' size='sm' onClick={handleRestore} disabled={restoring}>
              <CloudDownload className='size-3.5 mr-1.5' />
              {restoring ? 'Restoring…' : 'Restore backup'}
            </Button>
            <Button variant='outline' size='sm' onClick={handleMintRecovery} disabled={recoveringFromMint}>
              <RefreshCw className={`size-3.5 mr-1.5 ${recoveringFromMint ? 'animate-spin' : ''}`} />
              {recoveringFromMint ? 'Checking mints…' : 'Recover from mints'}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            If a paid Lightning deposit is missing, recovery checks deterministic outputs at each configured mint and only restores proofs the mint confirms are unspent.
          </p>
        </CardContent>
      </Card>

      <Dialog open={manageMintsOpen} onOpenChange={setManageMintsOpen}>
        <DialogContent className='max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>Manage mints</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            {wallet.allMints.map((mint) => {
              const normalized = safeNormalizeMintUrl(mint.url);
              const balance = wallet.balances[normalized] ?? 0;
              const removing = removingMintUrl === mint.url;
              return (
                <div key={normalized} className='flex min-w-0 items-center gap-3 rounded-lg border p-3'>
                  <div className='min-w-0 flex-1'>
                    <p className='font-medium'>{mint.name}</p>
                    <p className='truncate text-xs text-muted-foreground'>{normalized}</p>
                    <p className='text-sm text-muted-foreground'>{balance} sats</p>
                  </div>
                  <Button
                    type='button'
                    variant='destructive'
                    size='sm'
                    disabled={removing}
                    onClick={() => void handleRemoveMint(mint.name, mint.url)}
                    aria-label={`Remove ${mint.name}`}
                  >
                    <Trash2 className='mr-1.5 size-3.5' />
                    {removing ? 'Checking…' : 'Remove'}
                  </Button>
                </div>
              );
            })}
            {wallet.allMints.length === 0 && (
              <p className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
                No mints configured. Add one from the wallet screen.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingMintRemoval !== null} onOpenChange={(open) => { if (!open) setPendingMintRemoval(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This mint still holds ecash</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMintRemoval
                ? `${pendingMintRemoval.name} holds ${pendingMintRemoval.balance} sats. Removing it deletes the local proofs and may permanently lose those funds. Spend or sweep them first unless you accept that loss.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep mint</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              disabled={!pendingMintRemoval || removingMintUrl !== null}
              onClick={(event) => {
                event.preventDefault();
                if (pendingMintRemoval) {
                  void handleRemoveMint(pendingMintRemoval.name, pendingMintRemoval.url, pendingMintRemoval.balance);
                }
              }}
            >
              {pendingMintRemoval ? `Remove and lose ${pendingMintRemoval.balance} sats` : 'Remove mint'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleReceiveToken} disabled={!receiveTokenStr.trim() || wallet.loading}>
                      <ArrowDownLeft className='size-4 mr-1.5' />
                      Receive token
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
                      <Camera className="size-4 mr-1.5" />
                      Scan QR
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value='invoice' className='space-y-4'>
                  {!invoiceQuote ? (
                    <div className='space-y-2'>
                      {supportsBolt12Mint && (
                        <div className='grid grid-cols-2 gap-2' role='group' aria-label='Lightning deposit method'>
                          <Button type='button' size='sm' variant={depositMethod === 'bolt11' ? 'default' : 'outline'} onClick={() => setDepositMethod('bolt11')}>
                            BOLT11 invoice
                          </Button>
                          <Button type='button' size='sm' variant={depositMethod === 'bolt12' ? 'default' : 'outline'} onClick={() => setDepositMethod('bolt12')}>
                            BOLT12 offer
                          </Button>
                        </div>
                      )}
                      <div className='flex gap-2'>
                        <Input
                          type='number'
                          placeholder='Amount in sats'
                          value={invoiceAmount}
                          onChange={(e) => setInvoiceAmount(e.target.value)}
                        />
                        <Button onClick={handleCreateInvoice} disabled={wallet.loading}>
                          Create {depositMethod === 'bolt12' ? 'offer' : 'invoice'}
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
                      <div className='flex gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => copyToClipboard(invoiceQuote.request, setCopiedInvoice)}
                        >
                          {copiedInvoice ? <Check className='size-3.5 mr-1.5' /> : <Copy className='size-3.5 mr-1.5' />}
                          {copiedInvoice ? 'Copied' : `Copy ${invoiceQuote.method === 'bolt12' ? 'offer' : 'invoice'}`}
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
                  <div className='space-y-2'>
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
                    <SatsPresetPills value={sendAmount} onSelect={(s) => setSendAmount(String(s))} />
                  </div>
                  {generatedToken && (
                    <div className='space-y-4 flex flex-col items-center pt-2'>
                      <CashuTokenQr token={generatedToken} size={200} />
                      <p className='text-xs text-amber-600 dark:text-amber-500 text-center max-w-xs'>
                        This token IS the money — your wallet is already debited. It is stored in
                        this browser until you dismiss it; copy it before leaving this page.
                      </p>
                      <p className='text-xs text-muted-foreground text-center break-all max-w-xs'>
                        {generatedToken}
                      </p>
                      <div className='flex gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => copyToClipboard(generatedToken, setCopiedToken)}
                        >
                          {copiedToken ? <Check className='size-3.5 mr-1.5' /> : <Copy className='size-3.5 mr-1.5' />}
                          {copiedToken ? 'Copied' : 'Copy token'}
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => setGeneratedToken('')}>
                          Dismiss
                        </Button>
                      </div>
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
                  <Button variant='outline' onClick={handlePrepareMultiPath} disabled={!sendInvoice.trim() || wallet.loading}>
                    Split across mints
                  </Button>
                  {multiPathPlan && (
                    <div className='space-y-3 rounded-xl border bg-muted/40 p-4' role='region' aria-label='Multi-mint payment confirmation'>
                      <div>
                        <p className='font-medium'>Confirm {multiPathPlan.amountSats} sat multi-mint payment</p>
                        <p className='text-sm text-muted-foreground'>Maximum routing fees: {multiPathPlan.totalFeeReserveSats} sats. All legs are submitted together.</p>
                      </div>
                      <div className='space-y-2'>
                        {multiPathPlan.legs.map((leg) => (
                          <div key={leg.mintUrl} className='flex items-start justify-between gap-4 text-sm'>
                            <span className='min-w-0 break-all text-muted-foreground'>{leg.mintUrl.replace(/^https?:\/\//, '')}</span>
                            <span className='shrink-0 font-medium'>{leg.amountSats} + ≤{leg.quote.fee_reserve} sats</span>
                          </div>
                        ))}
                      </div>
                      <p className='text-xs text-muted-foreground'>Cashu mints are custodial. A partial Lightning failure can take time to reconcile; do not retry while a leg is pending.</p>
                      <div className='flex flex-wrap gap-2'>
                        <Button onClick={handleConfirmMultiPath} disabled={wallet.loading}>Confirm and pay</Button>
                        <Button variant='ghost' onClick={() => setMultiPathPlan(null)} disabled={wallet.loading}>Cancel</Button>
                      </div>
                    </div>
                  )}
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
              <SatsPresetPills value={nutzapAmount} onSelect={(s) => setNutzapAmount(String(s))} />
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
      <QrScannerDialog
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Scan Cashu token"
        onScan={(token) => {
          setReceiveTokenStr(token);
          setScannerOpen(false);
        }}
      />

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
  const status = transactionStatusLabel(tx);
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
          <div className='flex flex-wrap items-center gap-1.5'>
            <p className='text-xs text-muted-foreground'>{formatDate(tx.createdAt)}</p>
            <Badge variant={status.variant} className={status.className}>
              {status.label}
            </Badge>
          </div>
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

/**
 * Cashu has no chain confirmation. These labels describe the strongest state
 * this wallet can actually verify: a mint quote settlement or valid/unspent
 * proofs. A generated token cannot prove that its recipient redeemed it.
 */
function transactionStatusLabel(tx: Transaction): {
  label: string;
  variant: 'secondary' | 'outline' | 'destructive';
  className?: string;
} {
  switch (tx.status) {
    case 'pending':
      return { label: 'Unconfirmed · checking mint', variant: 'outline', className: 'border-amber-500/40 text-amber-700 dark:text-amber-300' };
    case 'failed':
      return { label: 'Not completed', variant: 'destructive' };
    case 'expired':
      return { label: 'Expired', variant: 'outline', className: 'text-muted-foreground' };
    case 'completed':
      switch (tx.type) {
        case 'receive':
          return { label: 'Mint verified', variant: 'secondary', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
        case 'mint':
          return { label: 'Mint confirmed', variant: 'secondary', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
        case 'melt':
          return { label: 'Payment confirmed', variant: 'secondary', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
        case 'send':
          return { label: 'Token created', variant: 'secondary', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
      }
  }
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
