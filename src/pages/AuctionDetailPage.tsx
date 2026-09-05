import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Gavel, Lock, ShieldCheck, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AuctionBidDialog } from '@/components/marketplace/AuctionBidDialog';
import { AuctionCard } from '@/components/marketplace/AuctionCard';
import { useAuctionBids } from '@/hooks/useAuctions';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  isAuctionClosed,
  type AuctionListing,
} from '@/lib/cashu/auction';
import {
  EXTENSION_WINDOW_SECONDS,
  effectiveCloseTime,
} from '@/lib/cashu/auctionRules';
import { formatSats } from '@/lib/bitcoin';

function secondsLeftLabel(target: number, nowSec: number): string {
  const secs = Math.max(0, target - nowSec);
  if (secs === 0) return 'ended';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Dedicated auction room: everything an eBay-grade auction page shows —
 * live countdown (soft-close aware), full public raise history, standing
 * price, and the bid / Buy-It-Now actions — without the market grid noise.
 */
export default function AuctionDetailPage() {
  // Route: /market/auction/<sellerPubkey>/<dTag>
  const { sellerPubkey, dTag } = useParams<{ sellerPubkey: string; dTag: string }>();
  const { user } = useCurrentUser();
  const { toast } = useToast();

  const [auction, setAuction] = useState<AuctionListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [buyNowMode, setBuyNowMode] = useState(false);
  const [proxyMode, setProxyMode] = useState(true);

  // Live clock: 1s under an hour to close, 15s otherwise.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const { bidState, isLoading: bidsLoading } = useAuctionBids(auction);

  // Soft-close-aware effective close, recomputed from the public history.
  const effectiveClose = useMemo(
    () =>
      auction
        ? effectiveCloseTime({
            listedClosesAt: auction.closesAt,
            bids: bidState.sorted.map((b) => ({ amountSats: b.amountSats, createdAt: b.createdAt })),
          })
        : 0,
    [auction, bidState.sorted],
  );

  const inExtensionWindow =
    !!auction && !bidsLoading && effectiveClose > auction.closesAt;

  useEffect(() => {
    if (!auction) return;
    const nearEnd = effectiveClose - now <= 3600;
    const intervalMs = nearEnd ? 1_000 : 15_000;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [auction, effectiveClose, now]);

  // Resolve the auction from the market grid's cached query context: the
  // grid page already holds every auction; a deep link falls back to a
  // lookup via the AuctionCard's own query chain. Simplest correct source:
  // sessionStorage handoff from the grid + refetch on focus.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      try {
        const raw = sessionStorage.getItem('bao_auction_registry');
        const list = raw ? (JSON.parse(raw) as AuctionListing[]) : [];
        const found = list.find((a) => a.pubkey === sellerPubkey && a.dTag === dTag) ?? null;
        if (cancelled) return;
        setAuction(found);
        setNotFound(!found);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [sellerPubkey, dTag]);

  // Keep the registry fresh while the grid is mounted elsewhere.
  useEffect(() => {
    if (auction) {
      try {
        const raw = sessionStorage.getItem('bao_auction_registry');
        const list = raw ? (JSON.parse(raw) as AuctionListing[]) : [];
        const i = list.findIndex((a) => a.pubkey === auction.pubkey && a.dTag === auction.dTag);
        if (i >= 0) list[i] = auction;
        else list.push(auction);
        sessionStorage.setItem('bao_auction_registry', JSON.stringify(list));
      } catch {
        // best-effort
      }
    }
  }, [auction]);

  const closed = auction ? isAuctionClosed(auction, now) || effectiveClose <= now : false;
  const standing = bidState.highest;
  const iAmStanding = !!standing && user?.pubkey === standing.pubkey;

  if (loading || (!auction && !notFound)) {
    return (
      <main className="flex-1 min-w-0 p-4 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="aspect-[16/9] w-full max-w-2xl rounded-2xl" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  if (!auction) {
    return (
      <main className="flex-1 min-w-0 p-8 text-center text-sm text-muted-foreground">
        <p>Auction not found.</p>
        <Button variant="outline" size="sm" asChild className="mt-3">
          <Link to="/market">
            <ArrowLeft className="size-3.5 mr-1.5" />
            Back to market
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 p-4 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/market">
            <ArrowLeft className="size-4 mr-1.5" />
            Market
          </Link>
        </Button>
        <h1 className="text-base font-semibold truncate flex-1">{auction.title}</h1>
        {auction.status === 'sold' && <Badge variant="destructive">sold</Badge>}
      </div>

      {/* Status strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gavel className="size-3.5" />
            {standing ? 'Current bid' : 'Starting bid'}
          </div>
          <div className="text-2xl font-bold tabular-nums mt-1">
            {bidsLoading ? '…' : formatSats(standing?.amountSats ?? auction.startingSats)}
            <span className="text-sm font-normal text-muted-foreground"> sats</span>
          </div>
          {standing && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              next bid ≥ {formatSats(bidState.minNextBid)} sats
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5" />
            {closed ? 'Ended' : 'Time remaining'}
          </div>
          <div className={`text-2xl font-bold tabular-nums mt-1 ${inExtensionWindow && !closed ? 'text-amber-500' : ''}`}>
            {closed ? '—' : secondsLeftLabel(effectiveClose, now)}
          </div>
          {inExtensionWindow && !closed && (
            <div className="text-[11px] text-amber-500 mt-0.5">
              extended — late bids push the close out
            </div>
          )}
          {!closed && effectiveClose - now <= EXTENSION_WINDOW_SECONDS && !inExtensionWindow && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              final minutes — new bids extend the close
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Protections
          </div>
          <div className="mt-1.5 space-y-1 text-xs">
            {auction.minWot ? (
              <div className="flex items-center gap-1.5">
                <Lock className="size-3 shrink-0" />
                WoT ≥ {auction.minWot} required
              </div>
            ) : null}
            {auction.buyNowSats ? (
              <div className="text-muted-foreground">Buy now: {formatSats(auction.buyNowSats)} sats</div>
            ) : null}
            <div className="text-muted-foreground">
              Sealed proxy max · 5-min soft close · escrow refund on loss
            </div>
          </div>
        </div>
      </div>

      {/* Bid actions */}
      {!closed && !isSellerOf(auction, user?.pubkey) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              if (!user) {
                toast({ title: 'Log in required', description: 'You need to log in to bid.' });
                return;
              }
              setBuyNowMode(false);
              setProxyMode(true);
              setBidOpen(true);
            }}
          >
            <Gavel className="size-4 mr-2" />
            Place sealed proxy bid
          </Button>
          {auction.buyNowSats && !standing && (
            <Button
              variant="outline"
              onClick={() => {
                if (!user) {
                  toast({ title: 'Log in required', description: 'You need to log in to use Buy It Now.' });
                  return;
                }
                setBuyNowMode(true);
                setProxyMode(false);
                setBidOpen(true);
              }}
            >
              Buy now — {formatSats(auction.buyNowSats)} sats
            </Button>
          )}
          {iAmStanding && (
            <Badge variant="secondary" className="text-xs">
              You hold the high bid
            </Badge>
          )}
        </div>
      )}

      {/* Full raise history */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">Bid history</h2>
          <span className="text-xs text-muted-foreground">
            {bidState.sorted.length} bid{bidState.sorted.length === 1 ? '' : 's'}
          </span>
        </div>
        {bidsLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : bidState.sorted.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No bids yet — be the first.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {bidState.sorted.map((bid, i) => (
              <li key={bid.eventId} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="w-6 text-xs text-muted-foreground tabular-nums">#{bidState.sorted.length - i}</span>
                <span className="font-mono text-xs truncate flex-1">
                  {bid.pubkey.slice(0, 10)}…{bid.pubkey.slice(-4)}
                </span>
                <span className="tabular-nums font-semibold">{formatSats(bid.amountSats)} sats</span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {new Date(bid.createdAt * 1000).toLocaleString()}
                </span>
                {standing?.eventId === bid.eventId && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    standing
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Reuse the market card for settlement/refund controls the seller and
          bidders already know (close now, reclaim refund, mark sold). */}
      <div className="max-w-2xl">
        <AuctionCard auction={auction} />
      </div>

      <AuctionBidDialog
        auction={auction}
        sellerPubkey={auction.pubkey}
        currentHighest={standing}
        minNextBid={bidState.minNextBid}
        open={bidOpen}
        onOpenChange={(open) => {
          setBidOpen(open);
          if (!open) setBuyNowMode(false);
        }}
        buyNowMode={buyNowMode}
        proxyMode={proxyMode}
      />
    </main>
  );
}

function isSellerOf(auction: AuctionListing, pubkey: string | undefined): boolean {
  return !!pubkey && pubkey === auction.pubkey;
}
