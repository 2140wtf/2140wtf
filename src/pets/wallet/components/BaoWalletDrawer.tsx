// src/pets/wallet/components/BaoWalletDrawer.tsx
//
// BAO Demo wallet UI embedded inside the Pets section.
// Provides deposit (Lightning invoice), receive (Cashu token), and send
// (Cashu token) rails. Intentionally does NOT include a faucet claim button —
// claiming is handled automatically on first BAO wallet creation.

import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
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
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCashuSeed } from '@/hooks/useCashuSeed';
import { useBaoCashuWallet } from '@/hooks/useBaoCashuWallet';
import { normalizeMintUrl } from '@/lib/cashu/cashu';
import type { MintQuoteResponse } from '@cashu/cashu-ts';

export function BaoWalletDrawer() {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { toast } = useToast();
  const { seedPhrase, loading: seedLoading } = useCashuSeed();

  const relayUrls = useMemo(
    () =>
      (config.relayMetadata?.relays ?? [])
        .filter((r) => r.read !== false || r.write !== false)
        .map((r) => r.url)
        .filter(Boolean),
    [config.relayMetadata?.relays],
  );

  const canInitialize = !!user && !!user.signer?.nip44 && !!seedPhrase;
  const wallet = useBaoCashuWallet(seedPhrase ?? '', user ?? { pubkey: '', signer: {} as never }, relayUrls);

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
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
      return;
    }
    const token = await wallet.sendToken(amount, sendMemo.trim());
    if (token) setGeneratedToken(token);
  };

  const handleCreateInvoice = async () => {
    const amount = Number(invoiceAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter a positive number of sats.' });
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

  if (seedLoading || wallet.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading BAO wallet…</p>
      </div>
    );
  }

  if (!canInitialize) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground">
        <WalletIcon className="size-10 mb-3" />
        <p className="text-sm">Your signer does not support the BAO wallet (NIP-44 required).</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base font-medium">
              <span className="flex items-center gap-2">
                <WalletIcon className="size-5 text-primary" />
                BAO Demo balance
                <Badge variant="outline">signet</Badge>
              </span>
              <Button variant="ghost" size="icon" className="size-7" onClick={wallet.calculateAllBalances}>
                <RefreshCw className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{wallet.totalBalance}</span>
              <span className="text-muted-foreground">demo sats</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Mint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={wallet.mintUrl} onValueChange={wallet.setMintUrl}>
              <SelectTrigger>
                <SelectValue placeholder="Select a BAO mint" />
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
                  placeholder="Paste BAO Cashu token here…"
                  value={receiveTokenStr}
                  onChange={(e) => setReceiveTokenStr(e.target.value)}
                  rows={4}
                />
                <Button onClick={handleReceive} disabled={!receiveTokenStr.trim() || wallet.loading}>
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
                  placeholder="Amount in demo sats"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                />
                <Input
                  placeholder="Memo (optional)"
                  value={sendMemo}
                  onChange={(e) => setSendMemo(e.target.value)}
                />
                <Button onClick={handleSend} disabled={!sendAmount || wallet.loading}>
                  <ArrowUpRight className="size-4 mr-1.5" />
                  Generate token
                </Button>
                {generatedToken && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Cashu token</p>
                    <div className="rounded-lg border bg-muted p-3 font-mono text-xs break-all">{generatedToken}</div>
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
                      placeholder="Amount in demo sats"
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                    />
                    <Button onClick={handleCreateInvoice} disabled={wallet.loading}>
                      Create invoice
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Pay the invoice, then mint the demo sats.</p>
                    <Button onClick={handleMint} disabled={wallet.loading}>
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
