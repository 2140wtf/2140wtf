import { useEffect, useMemo, useState } from 'react';
import { Gavel, Loader2 } from 'lucide-react';

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
import { isAuctionClosed, type AuctionListing } from '@/lib/cashu/auction';
import { formatSats } from '@/lib/bitcoin';

/** Time remaining label for an auction, e.g. "2d 4h" or "Closed". */
function timeRemaining(closesAt: number, nowSeconds: number): string {
  const secs = closesAt - nowSeconds;
  if (secs <= 0) return 'Closed';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

/**
 * Card view of one Cashu auction: image, title, current highest bid, time
 * remaining, and a bid button that opens the escrow-locked bid dialog.
 */
export function AuctionCard({ auction }: { auction: AuctionListing }): React.JSX.Element {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { startSignup } = useOnboarding();
  const { bidState, isLoading: bidsLoading, refetch: refetchBids } = useAuctionBids(auction);

  const [bidOpen, setBidOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // Ticks every 30s so the countdown stays fresh without per-second renders.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);

  const closed = isAuctionClosed(auction, now);
  const isSeller = user?.pubkey === auction.pubkey;
  const highest = bidState.highest;
  const iAmHighest = !!highest && user?.pubkey === highest.pubkey;

  const handleBidClick = () => {
    if (!user) {
      toast({ title: 'Log in required', description: 'You need to log in to bid.' });
      setLoginOpen(true);
      return;
    }
    setBidOpen(true);
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
          <Badge variant={closed ? 'secondary' : 'default'} className="text-[10px]">
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
          </div>
          {auction.buyNowSats ? (
            <span className="text-xs text-muted-foreground">
              Buy now {formatSats(auction.buyNowSats)} sats
            </span>
          ) : null}
        </div>

        {!isSeller && !closed && (
          <Button className="w-full" onClick={handleBidClick}>
            {iAmHighest ? 'Raise bid' : 'Place bid'}
          </Button>
        )}
        {isSeller && (
          <Button variant="secondary" className="w-full" disabled>
            Your auction
          </Button>
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
