// src/pets/wallet/components/CashuWalletDrawer.tsx
//
// Generic Cashu wallet drawer UI. Used by both the BAO signet/demo wallet and
// the main real-sats Cashu wallet inside the Pets section.

import { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/lib/utils';
import { normalizeMintUrl, safeNormalizeMintUrl } from '@/lib/cashu/cashu';
import type { CashuWalletState, CashuWalletActions } from '@/hooks/useCashuWallet';
import type { MintQuoteResponse } from '@cashu/cashu-ts';

export interface CashuWalletDrawerProps {
  wallet: CashuWalletState & CashuWalletActions;
  title: string;
  badge?: string;
  mintPlaceholder?: string;
  invoiceDescription?: string;
  showMintSelector?: boolean;
}

export function CashuWalletDrawer({
  wallet,
  title,
  badge,
  mintPlaceholder = 'Select a mint',
  invoiceDescription = 'Wallet top-up',
  showMintSelector = true,
}: CashuWalletDrawerProps) {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const [receiveTokenStr, setReceiveTokenStr] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendMemo, setSendMemo] = useState('');
  // The generated send token is persisted in localStorage (scoped by user +
  // mint) because sendToken debits the wallet and clears its send-recovery
  // journal after encoding — a useState-only copy is destroyed when the
  // drawer closes, burning the sats. It stays here until the user dismisses
  // it.
  const sendOutboxKey = `bao_cashu_drawer_send_${user?.pubkey ?? 'anon'}_${wallet.mintUrl ?? 'default'}`;
  const [generatedToken, setGeneratedToken] = useLocalStorage<string>(sendOutboxKey, '');
  const [copiedToken, setCopiedToken] = useState(false);
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
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    const token = await wallet.sendToken(amount, sendMemo.trim());
    if (token) setGeneratedToken(token);
  };

  const copyGeneratedToken = async () => {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Clipboard is not available — select and copy the token manually.' });
    }
  };

  const handleCreateInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    const quote = await wallet.requestInvoice(amount, invoiceDescription);
    if (quote) setInvoiceQuote(quote);
  };

  const handleMint = async () => {
    if (!invoiceQuote) return;
    await wallet.mintFromQuote(invoiceQuote.quote, Number(invoiceAmount));
    setInvoiceQuote(null);
    setInvoiceAmount('');
  };

  const activeMint = wallet.mintUrl ?? '';

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base font-medium">
              <span className="flex items-center gap-2">
                <WalletIcon className="size-5 text-primary" />
                {title}
                {badge && <Badge variant="outline">{badge}</Badge>}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => void wallet.calculateAllBalances()}
                disabled={wallet.loading}
              >
                <RefreshCw className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{wallet.totalBalance.toLocaleString()}</span>
              <span className="text-muted-foreground">sats</span>
            </div>
          </CardContent>
        </Card>

        {showMintSelector && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Mint</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={activeMint} onValueChange={wallet.setMintUrl}>
                <SelectTrigger>
                  <SelectValue placeholder={mintPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {wallet.allMints.map((m) => (
                    <SelectItem key={normalizeMintUrl(m.url)} value={safeNormalizeMintUrl(m.url)}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {(wallet.error || wallet.success) && (
          <div
            className={cn(
              'rounded-lg border p-3 text-sm',
              wallet.error
                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                : 'border-green-500/50 bg-green-500/10 text-green-700',
            )}
          >
            {wallet.error || wallet.success}
          </div>
        )}

        <Tabs defaultValue="receive" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="receive">Receive</TabsTrigger>
            <TabsTrigger value="send">Send</TabsTrigger>
            <TabsTrigger value="invoice">Invoice</TabsTrigger>
          </TabsList>

          <TabsContent value="receive">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Receive Cashu token</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="Paste Cashu token here…"
                  value={receiveTokenStr}
                  onChange={(e) => setReceiveTokenStr(e.target.value)}
                  rows={4}
                />
                <Button onClick={() => void handleReceive()} disabled={!receiveTokenStr.trim() || wallet.loading}>
                  <ArrowDownLeft className="size-4 mr-1.5" />
                  Receive token
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="send">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Send Cashu token</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  type="number"
                  placeholder="Amount in sats"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                />
                <Input
                  placeholder="Memo (optional)"
                  value={sendMemo}
                  onChange={(e) => setSendMemo(e.target.value)}
                />
                <Button onClick={() => void handleSend()} disabled={!sendAmount || wallet.loading}>
                  <ArrowUpRight className="size-4 mr-1.5" />
                  Generate token
                </Button>
                {generatedToken && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Cashu token</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      This token IS the money — your wallet is already debited. It is stored in
                      this browser until you dismiss it; copy it before moving on.
                    </p>
                    <div className="rounded-lg border bg-muted p-3 font-mono text-xs break-all">{generatedToken}</div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => void copyGeneratedToken()}>
                        {copiedToken ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
                        {copiedToken ? 'Copied' : 'Copy token'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setGeneratedToken('')}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoice">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Lightning deposit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!invoiceQuote ? (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Amount in sats"
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                    />
                    <Button onClick={() => void handleCreateInvoice()} disabled={wallet.loading || !activeMint}>
                      Create invoice
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Pay the invoice, then mint the sats.</p>
                    <Button onClick={() => void handleMint()} disabled={wallet.loading}>
                      Mint {invoiceAmount} sats
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
