import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Bitcoin, Copy, Check, RefreshCw, Wallet, ChevronDown, ArrowDownLeft, ArrowUpRight, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { LoginArea } from '@/components/auth/LoginArea';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { SendBitcoinDialog } from '@/components/SendBitcoinDialog';
import { CashuWalletTab } from '@/components/CashuWalletTab';
import { BaoWalletTab } from '@/components/BaoWalletTab';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useBitcoinWallet } from '@/hooks/useBitcoinWallet';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { satsToUSD, formatBTC } from '@/lib/bitcoin';
import type { Transaction } from '@/lib/bitcoin';

/**
 * Shape of `location.state` consumed by this page when arriving via a
 * `bitcoin:` deep link. The `DeepLinkHandler` navigates to `/wallet` with
 * `state: { bip21Uri }` so we can auto-open the Send dialog with the URI
 * prefilled. Kept here (rather than exported) because no other route
 * produces this state.
 */
interface WalletLocationState {
  bip21Uri?: string;
}

export function WalletPage() {
  const { config } = useAppContext();
  const { user } = useCurrentUser();
  const { bitcoinAddress, addressData, btcPrice, transactions, isLoading, error, refetch } = useBitcoinWallet();
  const cashuWallet = useCashuWalletContext();

  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as WalletLocationState | null;

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Snapshot of the URI we opened with. We snapshot once (rather than reading
  // `locationState?.bip21Uri` on every render) so clearing `location.state`
  // after consumption doesn't blank out the dialog's `initialUri` prop while
  // it's still open.
  const [pendingUri, setPendingUri] = useState<string | undefined>(undefined);
  const consumedDeepLinkRef = useRef(false);

  const relayUrls = useMemo(
    () =>
      (config.relayMetadata?.relays ?? [])
        .filter((r) => r.read !== false || r.write !== false)
        .map((r) => r.url)
        .filter(Boolean),
    [config.relayMetadata?.relays],
  );

  // Auto-open the Send dialog when the user arrived via a `bitcoin:` deep
  // link. Only fires once per navigation; we then clear `location.state` so
  // a back-then-forward navigation, or a refresh, doesn't relaunch the
  // dialog. Logged-out users get the login prompt instead — no point opening
  // a Send dialog they can't use.
  useEffect(() => {
    if (consumedDeepLinkRef.current) return;
    const uri = locationState?.bip21Uri;
    if (!uri) return;
    consumedDeepLinkRef.current = true;
    if (user) {
      setPendingUri(uri);
      setSendOpen(true);
    }
    // Strip the URI from history state so it doesn't replay on back-forward.
    navigate(location.pathname, { replace: true, state: null });
  }, [locationState, user, navigate, location.pathname]);

  useSeoMeta({
    title: `Wallet | ${config.appName}`,
    description: 'Your Bitcoin Taproot wallet, Cashu wallet, and BAO demo wallet.',
  });

  const copyAddress = async () => {
    if (!bitcoinAddress) return;
    try {
      await navigator.clipboard.writeText(bitcoinAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      // clipboard API not available
    }
  };

  const truncatedAddress = bitcoinAddress
    ? `${bitcoinAddress.slice(0, 12)}...${bitcoinAddress.slice(-8)}`
    : '';

  return (
    <main>
      <PageHeader title="Wallet" icon={<Wallet className="size-5" />} />

      {!user ? (
        <div className="py-20 px-8 flex flex-col items-center gap-6 text-center">
          <div className="p-4 rounded-full bg-primary/10">
            <Bitcoin className="size-8 text-primary" />
          </div>
          <div className="space-y-2 max-w-xs">
            <h2 className="text-xl font-bold">Your Wallet</h2>
            <p className="text-muted-foreground text-sm">
              Log in to see your Bitcoin Taproot address, Cashu wallet, and BAO demo wallet.
            </p>
          </div>
          <LoginArea className="max-w-60" />
        </div>
      ) : (
        <div className="px-4 pt-6 pb-4 max-w-sm mx-auto">
          <Tabs defaultValue="bitcoin" className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="bitcoin">Bitcoin</TabsTrigger>
              <TabsTrigger value="cashu">Cashu</TabsTrigger>
              <TabsTrigger value="bao-demo">BAO Demo</TabsTrigger>
            </TabsList>

            <TabsContent value="bitcoin" className="flex flex-col items-center space-y-6">
              {/* Balance */}
              {isLoading ? (
                <div className="flex flex-col items-center space-y-2">
                  <Skeleton className="h-10 w-40 rounded-lg" />
                  <Skeleton className="h-4 w-24 rounded" />
                </div>
              ) : error ? (
                <div className="text-center space-y-3">
                  <p className="text-sm text-destructive">Failed to load balance</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              ) : addressData ? (
                <div className="flex flex-col items-center space-y-1">
                  <span className="text-4xl font-bold tracking-tight">
                    {btcPrice
                      ? satsToUSD(addressData.totalBalance, btcPrice)
                      : '---'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {formatBTC(addressData.totalBalance)} BTC
                  </span>

                  {addressData.pendingBalance !== 0 && (
                    <span className="flex items-center gap-1 text-xs text-orange-500 dark:text-orange-400 pt-1">
                      <RefreshCw className="size-3 animate-spin" />
                      {btcPrice
                        ? `${satsToUSD(addressData.pendingBalance, btcPrice)} pending`
                        : 'pending'}
                    </span>
                  )}
                </div>
              ) : null}

              {/* Send button */}
              {addressData && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSendOpen(true)}
                  className="rounded-full"
                >
                  <Send className="size-3.5 mr-1.5" />
                  Send
                </Button>
              )}

              <SendBitcoinDialog
                isOpen={sendOpen}
                onClose={() => {
                  setSendOpen(false);
                  setPendingUri(undefined);
                }}
                btcPrice={btcPrice}
                initialUri={pendingUri}
              />

              {/* QR Code */}
              {bitcoinAddress ? (
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <QRCodeCanvas value={bitcoinAddress} size={200} level="M" />
                </div>
              ) : (
                <Skeleton className="h-[232px] w-[232px] rounded-2xl" />
              )}

              {/* Address + copy */}
              {bitcoinAddress ? (
                <button
                  onClick={copyAddress}
                  className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-mono text-muted-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {truncatedAddress}
                  {copiedAddress ? (
                    <Check className="size-3.5 text-green-500" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              ) : (
                <Skeleton className="h-9 w-48 rounded-full" />
              )}

              {/* Transactions */}
              {transactions && transactions.length > 0 && (
                <>
                  <button
                    onClick={() => setTxOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Transactions
                    <ChevronDown className={`size-3 transition-transform duration-200 ${txOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <TxAccordion open={txOpen}>
                    <div className="w-full divide-y">
                      {transactions.map((tx) => (
                        <TxRow key={tx.txid} tx={tx} btcPrice={btcPrice} />
                      ))}
                    </div>
                  </TxAccordion>
                </>
              )}
            </TabsContent>

            <TabsContent value="cashu">
              {cashuWallet.seedLoading ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="size-5 animate-spin" />
                    <p className="font-medium text-foreground">Sign in to wallet</p>
                    <p className="text-xs text-muted-foreground/80 max-w-xs">
                      Your signer may have opened a prompt in the background. Approve it to generate or unlock your Cashu seed.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Retry after signing
                  </Button>
                </div>
              ) : cashuWallet.seedError ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-destructive">{cashuWallet.seedError}</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    If your signer did not respond, unlock it and try again. You can also reset and create a new seed (this will erase any stored Cashu data for this account).
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                      <RefreshCw className="size-3.5 mr-1.5" />
                      Retry
                    </Button>
                    <Button variant="destructive" size="sm" onClick={cashuWallet.regenerateSeed}>
                      Reset &amp; regenerate
                    </Button>
                  </div>
                </div>
              ) : !user.signer?.nip44 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Your signer does not support NIP-44, which is required for Cashu backup encryption.
                </div>
              ) : cashuWallet.seedAvailable && cashuWallet.seedPhrase ? (
                <CashuWalletTab />
              ) : (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Cashu wallet could not be initialized.
                  </p>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Try again
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="bao-demo">
              {cashuWallet.seedLoading ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="size-5 animate-spin" />
                    <p className="font-medium text-foreground">Sign in to wallet</p>
                    <p className="text-xs text-muted-foreground/80 max-w-xs">
                      Your signer may have opened a prompt in the background. Approve it to unlock your BAO demo wallet.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Retry after signing
                  </Button>
                </div>
              ) : cashuWallet.seedError ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-destructive">{cashuWallet.seedError}</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    If your signer did not respond, unlock it and try again.
                  </p>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              ) : !user.signer?.nip44 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Your signer does not support NIP-44, which is required for the BAO demo wallet.
                </div>
              ) : cashuWallet.seedAvailable && cashuWallet.seedPhrase ? (
                <BaoWalletTab
                  seedPhrase={cashuWallet.seedPhrase}
                  user={user}
                  relayUrls={relayUrls}
                />
              ) : (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    BAO demo wallet could not be initialized.
                  </p>
                  <Button variant="outline" size="sm" onClick={cashuWallet.retrySeed}>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Try again
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </main>
  );
}

/** Accordion wrapper using grid-template-rows for smooth height animation. */
function TxAccordion({ open, children }: { open: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="w-full grid transition-[grid-template-rows] duration-300 ease-in-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div ref={contentRef} className="overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** Format a unix timestamp as a relative or absolute date. */
function formatTxDate(timestamp?: number): string {
  if (!timestamp) return 'Pending';

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Single transaction row. */
function TxRow({ tx, btcPrice }: { tx: Transaction; btcPrice?: number }) {
  const isReceive = tx.type === 'receive';

  return (
    <Link
      to={`/i/bitcoin:tx:${tx.txid}`}
      className="flex items-center justify-between py-3 px-1 hover:bg-muted/50 transition-colors rounded-lg -mx-1 px-2"
    >
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center size-8 rounded-full ${
          isReceive
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400'
        }`}>
          {isReceive
            ? <ArrowDownLeft className="size-4" />
            : <ArrowUpRight className="size-4" />}
        </div>
        <div>
          <p className="text-sm font-medium">{isReceive ? 'Received' : 'Sent'}</p>
          <p className="text-xs text-muted-foreground">{formatTxDate(tx.timestamp)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-medium ${
          isReceive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
        }`}>
          {isReceive ? '+' : '-'}
          {btcPrice
            ? satsToUSD(tx.amount, btcPrice)
            : `${formatBTC(tx.amount)} BTC`}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBTC(tx.amount)} BTC
        </p>
      </div>
    </Link>
  );
}
