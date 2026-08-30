import { useMemo, useState } from 'react';
import { Gavel, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCashuWalletContext } from '@/hooks/useCashuWalletContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { validateBidAmount, type AuctionBid, type AuctionListing, auctionAddress } from '@/lib/cashu/auction';
import { savePendingBidDeposit } from '@/lib/cashu/auctionSettlement';
import { MULTISIG_REFUND_PERIOD_SECONDS } from '@/lib/cashu/escrowMultisig';
import { formatSats } from '@/lib/bitcoin';

interface AuctionBidDialogProps {
  auction: AuctionListing;
  /** Seller pubkey (the auction author). */
  sellerPubkey: string;
  currentHighest: AuctionBid | null;
  minNextBid: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBidPlaced?: () => void;
}

/**
 * Bidder dialog for a Cashu auction.
 *
 * Places a kind-30401 bid event and locks the bid amount as a 2-of-3
 * multisig escrow token ({bidder, seller, operator}) from the bidder's
 * wallet. The token is retained locally (refund path) while the bid event
 * carries only the amount and the bidder's P2PK key — never the proofs.
 */
export function AuctionBidDialog({
  auction,
  sellerPubkey,
  currentHighest,
  minNextBid,
  open,
  onOpenChange,
  onBidPlaced,
}: AuctionBidDialogProps) {
  const { user } = useCurrentUser();
  const wallet = useCashuWalletContext();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const [amount, setAmount] = useState(String(minNextBid));
  const [isBidding, setIsBidding] = useState(false);
  const [error, setError] = useState('');

  const numericAmount = useMemo(
    () => Number(amount.replace(/,/g, '')),
    [amount],
  );

  const bidError = useMemo(
    () =>
      Number.isFinite(numericAmount)
        ? validateBidAmount(numericAmount, auction, currentHighest)
        : 'Enter a valid bid amount.',
    [numericAmount, auction, currentHighest],
  );

  const balance = wallet.totalBalance;
  const insufficient = Number.isFinite(numericAmount) && numericAmount > balance;

  const canBid =
    !!user &&
    !!wallet.getWalletP2pkPubkey() &&
    Number.isFinite(numericAmount) &&
    !bidError &&
    !insufficient &&
    !isBidding;

  const handleBid = async () => {
    if (!canBid || !user) return;
    setIsBidding(true);
    setError('');
    try {
      const bidderP2pk = wallet.getWalletP2pkPubkey()!;
      const now = Math.floor(Date.now() / 1000);
      const locktime = now + MULTISIG_REFUND_PERIOD_SECONDS;

      // Lock the bid amount with the 2-of-3 escrow primitive. The lock is
      // validated BEFORE the wallet is debited; the returned token is the
      // bidder's only handle on the locked funds — journal it for the refund
      // path before anything can go wrong on the wire.
      const token = await wallet.sendMultisigLockedToken(
        numericAmount,
        {
          partyAPubkey: bidderP2pk,
          partyBPubkey: sellerPubkey,
          operatorPubkey: sellerPubkey,
          refundPubkey: bidderP2pk,
          locktime,
        },
        `Auction bid ${auction.dTag}`,
      );
      if (!token) {
        throw new Error(wallet.error || 'Wallet could not lock the bid amount.');
      }
      savePendingBidDeposit({
        auctionAddress: auctionAddress(auction.pubkey, auction.dTag),
        token,
        amountSats: numericAmount,
        locktime,
      });

      // Publish the bid event (amount + P2PK key only — no proofs on relay).
      await publishEvent({
        kind: 30401,
        content: '',
        tags: [
          ['d', `bid-${auction.pubkey.slice(0, 8)}-${auction.dTag}`],
          ['a', `30402:${auction.pubkey}:${auction.dTag}`],
          ['amount', String(numericAmount), 'sats'],
          ['p2pk', bidderP2pk],
          ['alt', `Bid ${formatSats(numericAmount)} sats on ${auction.title}`],
        ],
      });

      toast({
        title: 'Bid placed!',
        description: `${formatSats(numericAmount)} sats locked in escrow. You'll be auto-refunded if outbid.`,
      });
      onOpenChange(false);
      onBidPlaced?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bid failed.');
    } finally {
      setIsBidding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Gavel className="size-4" />
            Place bid
          </DialogTitle>
          <DialogDescription>
            {auction.title} — closing {new Date(auction.closesAt * 1000).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bid-amount">Your bid (sats)</Label>
            <Input
              id="bid-amount"
              type="number"
              min={minNextBid}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {currentHighest
                ? `Current highest: ${formatSats(currentHighest.amountSats)} sats`
                : `Starting bid: ${formatSats(auction.startingSats)} sats`}
              {' · '}
              Minimum: {formatSats(minNextBid)} sats
            </p>
          </div>

          <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Your bid locks {Number.isFinite(numericAmount) ? formatSats(numericAmount) : '—'} sats
            in Cashu escrow (2-of-3: you, seller, operator). Outbid or losing bids refund
            automatically after the 24h locktime.
            {insufficient && (
              <p className="mt-1 text-destructive">
                Wallet balance too low ({formatSats(balance)} sats available).
              </p>
            )}
            {bidError && <p className="mt-1 text-destructive">{bidError}</p>}
            {error && <p className="mt-1 text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBidding}>
            Cancel
          </Button>
          <Button disabled={!canBid} onClick={handleBid}>
            {isBidding ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Locking escrow…
              </>
            ) : (
              'Lock bid in escrow'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
