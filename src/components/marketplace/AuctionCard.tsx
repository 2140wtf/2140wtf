import { useEffect, useMemo, useState } from 'react';
import { Gavel, HandCoins, Loader2, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SafeImage } from '@/components/SafeImage';
import { AuctionBidDialog } from '@/components/marketplace/AuctionBidDialog';
import LoginDialog from '@/components/auth/LoginDialog';
import { useAuctionBids } from '@/hooks/useAuctions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { isAuctionClosed, type AuctionListing } from '@/lib/cashu/auction';
import {
  buildAuctionSettleTags,
  clearPendingBidDeposit,
  loadPendingBidDeposits,
  refundUnlocked,
  requestAuctionRefund,
  requestAuctionRelease,
  type PendingAuctionBidDeposit,
} from '@/lib/cashu/auctionSettlement';
import { formatSats } from '@/lib/bitcoin';

/** Time remaining label for an auction, e.g. "2d 4h" or "Closed". */
function timeRemaining(closesAt: number, nowSeconds: number): string {
  const secs = closesAt - nowSeconds;
  if (secs <= 0) return 'Closed';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

/** Exact close time incl. seconds and timezone, e.g. "Aug 30, 2026, 08:31:42 PM CET". */
const EXACT_CLOSE_FMT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

function exactClose(closesAt: number): string {
  return EXACT_CLOSE_FMT.format(new Date(closesAt * 1000));
}

/**
 * Card view of one Cashu auction: image, title, current highest bid, time
 * remaining, a bid button (escrow-locked), seller settlement controls
 * (close now → settle with winner), and the bidder's refund reclaim.
 */
export function AuctionCard({ auction }: { auction: AuctionListing }): React.JSX.Element {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { config } = useAppContext();
  const { startSignup } = useOnboarding();
  const { bidState, isLoading: bidsLoading, refetch: refetchBids } = useAuctionBids(auction);
  const { mutateAsync: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();

  const [bidOpen, setBidOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  const [refunding, setRefunding] = useState(false);

  // Ticks every second under 1h to close (seconds matter at auction end),
  // otherwise every 30s so the countdown stays fresh without churn.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const nearEnd = auction.closesAt - now <= 3600;
    const intervalMs = nearEnd ? 1_000 : 30_000;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [auction.closesAt, now]);

  const closed = isAuctionClosed(auction, now);
  const isSeller = user?.pubkey === auction.pubkey;
  const highest = bidState.highest;
  const iAmHighest = !!highest && user?.pubkey === highest.pubkey;

  // The user's own journaled deposit for THIS auction (refund reclaim UI).
  const myDeposit: PendingAuctionBidDeposit | undefined = useMemo(() => {
    if (!user) return undefined;
    const addr = `${auction.event.kind}:${auction.pubkey}:${auction.dTag}`;
    return loadPendingBidDeposits().find((d) => d.auctionAddress === addr);
  }, [user, auction.pubkey, auction.dTag, auction.event.kind]);

  const canReclaimRefund =
    !!myDeposit && !iAmHighest && !!highest && highest.pubkey !== user?.pubkey;

  const handleBidClick = () => {
    if (!user) {
      toast({ title: 'Log in required', description: 'You need to log in to bid.' });
      setLoginOpen(true);
      return;
    }
    setBidOpen(true);
  };

  /** Seller: close the auction now (publishes status=sold). */
  const handleCloseNow = async () => {
    setSettling(true);
    try {
      await publishEvent({
        kind: auction.event.kind,
        content: auction.event.content,
        tags: buildAuctionSettleTags(auction),
        prev: auction.event,
      });
      queryClient.invalidateQueries({ queryKey: ['cashu-auctions'] });
      toast({ title: 'Auction closed', description: 'The highest bid at close wins.' });
    } catch (err) {
      toast({
        title: 'Failed to close auction',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSettling(false);
    }
  };

  /** Seller: ask the operator to release the winning bid's escrow to me. */
  const handleSettle = async () => {
    if (!highest) return;
    setSettling(true);
    try {
      const serviceUrl = config.petsBattleEscrowServiceUrl;
      if (!serviceUrl) throw new Error('Escrow service is not configured.');
      // The winning bid's deposit token was delivered out-of-band (NIP-17 DM
      // from the bidder). For now the seller pastes it — the DM inbox flow
      // can prefill this later.
      const token = window.prompt("Paste the winning bidder's escrow deposit token (from their DM):");
      if (!token) return;
      const release = await requestAuctionRelease({
        serviceUrl,
        auction,
        winningBid: highest,
        winningBidEvent: {
          ...auction.event,
          id: highest.eventId,
          pubkey: highest.pubkey,
          created_at: highest.createdAt,
          kind: 30401,
          tags: [
            ['a', highest.auctionAddress],
            ['amount', String(highest.amountSats), 'sats'],
          ],
          content: '',
          sig: '',
        } as unknown as typeof auction.event,
        depositToken: token,
        sellerPubkey: auction.pubkey,
      });
      if (release?.token) {
        toast({
          title: 'Release received!',
          description: `${formatSats(highest.amountSats)} sats released — sweep it into your wallet from the notification.`,
        });
        // Store for the seller to sweep; a full sweep UI lands with the DM flow.
        try {
          localStorage.setItem(`bao_auction_release_${auction.id}`, release.token);
        } catch { /* ignore */ }
      } else {
        toast({ title: 'Release pending', description: 'The operator has not returned a token yet — try again shortly.' });
      }
    } catch (err) {
      toast({
        title: 'Settlement failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSettling(false);
    }
  };

  /** Bidder: reclaim my losing bid via refund (operator or locktime path). */
  const handleRefund = async () => {
    if (!myDeposit) return;
    setRefunding(true);
    try {
      const serviceUrl = config.petsBattleEscrowServiceUrl;
      if (!serviceUrl) throw new Error('Escrow service is not configured.');
      if (refundUnlocked(myDeposit, now)) {
        // Standard NUT-11 refund path — no operator needed.
        toast({
          title: 'Refund unlocked',
          description: 'Your bid refund is claimable from the wallet (locked-token sweep).',
        });
      } else {
        const refund = await requestAuctionRefund({
          serviceUrl,
          auction,
          bidEvent: auction.event, // placeholder; the bidder's own event comes from the bid history
          bid: {
            eventId: myDeposit.auctionAddress,
            pubkey: user!.pubkey,
            amountSats: myDeposit.amountSats,
            auctionAddress: myDeposit.auctionAddress,
            createdAt: now,
          },
          depositToken: myDeposit.token,
        });
        if (refund?.token) {
          clearPendingBidDeposit(myDeposit.auctionAddress);
          try {
            localStorage.setItem(`bao_auction_refund_${auction.id}`, refund.token);
          } catch { /* ignore */ }
          toast({ title: 'Refund received!', description: 'Sweep the refunded token into your wallet.' });
        } else {
          toast({ title: 'Refund pending', description: 'The operator has not returned a token yet — try again shortly.' });
        }
      }
    } catch (err) {
      toast({
        title: 'Refund failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setRefunding(false);
    }
  };

  return (
    <div className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative overflow-hidden bg-muted aspect-[4/3]">
        {auction.images[0] ? (
          <SafeImage
            src={auction.images[0]}
            alt={auction.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            <Gavel className="size-4 mr-1.5" />
            No image
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge
            variant={closed ? 'secondary' : 'default'}
            className="text-[10px]"
            title={`Ends: ${exactClose(auction.closesAt)}`}
          >
            {closed ? 'Closed' : timeRemaining(auction.closesAt, now)}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm line-clamp-2 flex-1">{auction.title}</span>
          <Badge variant="outline" className="text-xs shrink-0">
            <Gavel className="size-3 mr-1" />
            Auction
          </Badge>
        </div>

        {auction.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2">{auction.summary}</p>
        )}

        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tabular-nums">
              {bidsLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : highest ? (
                `${formatSats(highest.amountSats)} sats`
              ) : (
                `${formatSats(auction.startingSats)} sats`
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {highest ? 'current bid' : 'starting bid'}
              {!bidsLoading && bidState.sorted.length > 0 && ` · ${bidState.sorted.length} bid${bidState.sorted.length > 1 ? 's' : ''}`}
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {closed ? `Ended: ${exactClose(auction.closesAt)}` : `Ends: ${exactClose(auction.closesAt)}`}
            </div>
          </div>
          {auction.buyNowSats ? (
            <span className="text-xs text-muted-foreground">
              Buy now {formatSats(auction.buyNowSats)} sats
            </span>
          ) : null}
        </div>

        {/* Bidder actions */}
        {!isSeller && !closed && (
          <Button className="w-full" onClick={handleBidClick}>
            {iAmHighest ? 'Raise bid' : 'Place bid'}
          </Button>
        )}

        {/* Bidder refund reclaim (lost/outbid). */}
        {!isSeller && closed && canReclaimRefund && myDeposit && (
          <Button variant="outline" className="w-full" onClick={handleRefund} disabled={refunding}>
            {refunding ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="size-4 mr-2" />
            )}
            Reclaim {formatSats(myDeposit.amountSats)} sats refund
          </Button>
        )}

        {/* Winner confirmation. */}
        {!isSeller && closed && iAmHighest && (
          <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <HandCoins className="size-3.5 inline mr-1" />
            You won! The seller will settle; your escrow releases to them.
          </div>
        )}

        {/* Seller settlement controls. */}
        {isSeller && !closed && (
          <Button variant="secondary" className="w-full" onClick={handleCloseNow} disabled={settling}>
            {settling ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Gavel className="size-4 mr-2" />}
            Close auction now
          </Button>
        )}
        {isSeller && closed && highest && (
          <Button className="w-full" onClick={handleSettle} disabled={settling}>
            {settling ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <HandCoins className="size-4 mr-2" />
            )}
            Settle: release {formatSats(highest.amountSats)} sats to me
          </Button>
        )}
        {isSeller && closed && !highest && (
          <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Closed with no bids — nothing to settle.
          </div>
        )}
      </div>

      <AuctionBidDialog
        auction={auction}
        sellerPubkey={auction.pubkey}
        currentHighest={highest}
        minNextBid={bidState.minNextBid}
        open={bidOpen}
        onOpenChange={setBidOpen}
        onBidPlaced={() => refetchBids()}
      />

      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={() => setLoginOpen(false)}
        onSignupClick={startSignup}
      />
    </div>
  );
}
