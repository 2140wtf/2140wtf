import { useMemo, useState } from 'react';
import { Gavel, Loader2, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/useToast';
import { buildAuctionEvent, DEFAULT_AUCTION_DURATION_HOURS } from '@/lib/cashu/auction';
import { cn } from '@/lib/utils';

interface CreateAuctionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the title from an existing product listing (auction entry point). */
  initialTitle?: string;
  initialSummary?: string;
  initialContent?: string;
  initialImages?: string[];
  initialCategories?: string[];
  onSuccess?: () => void;
}

const DURATION_OPTIONS = [
  { value: 24, label: '1 day' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
];

/**
 * Seller-facing "Design auction" dialog.
 *
 * Publishes a kind-30402 NIP-99 listing tagged as an auction (`auction` tag +
 * `close` timestamp + optional `buy_now`). Bidders later lock Cashu tokens
 * with the 2-of-3 escrow primitive, so the seller should accept Cashu.
 */
export function CreateAuctionDialog({
  open,
  onOpenChange,
  initialTitle,
  initialSummary,
  initialContent,
  initialImages,
  initialCategories,
  onSuccess,
}: CreateAuctionDialogProps) {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent, isPending: isPublishing } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [startingSats, setStartingSats] = useState('');
  const [buyNowSats, setBuyNowSats] = useState('');
  const [durationHours, setDurationHours] = useState<number>(DEFAULT_AUCTION_DURATION_HOURS);

  // Re-apply prefill each time the dialog opens (deep-link/entry-point support).
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setTitle(initialTitle ?? '');
    setSummary(initialSummary ?? '');
    setContent(initialContent ?? '');
    setStartingSats('');
    setBuyNowSats('');
    setDurationHours(DEFAULT_AUCTION_DURATION_HOURS);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const starting = Number(startingSats.replace(/,/g, ''));
  const buyNow = buyNowSats ? Number(buyNowSats.replace(/,/g, '')) : NaN;
  const formValid =
    title.trim().length > 0 &&
    Number.isSafeInteger(starting) &&
    starting >= 0 &&
    (buyNowSats === '' || (Number.isSafeInteger(buyNow) && buyNow > starting));

  const canPublish = !!user && formValid && !isPublishing;

  const handleSubmit = async () => {
    if (!canPublish) return;
    try {
      const event = buildAuctionEvent({
        sellerPubkey: user!.pubkey,
        dTag: `auction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title.trim(),
        summary: summary.trim(),
        content: content.trim(),
        images: initialImages ?? [],
        categories: [...(initialCategories ?? []), 'auction'],
        startingSats: starting,
        buyNowSats: Number.isSafeInteger(buyNow) ? buyNow : undefined,
        durationHours,
        now: Math.floor(Date.now() / 1000),
      });

      await createEvent({
        kind: event.kind,
        content: event.content,
        tags: event.tags,
      });

      queryClient.invalidateQueries({ queryKey: ['cashu-auctions'] });
      queryClient.invalidateQueries({ queryKey: ['nip99-listings'] });
      toast({
        title: 'Auction published!',
        description: 'Bidders will lock Cashu tokens in escrow with each bid.',
      });
      setTitle('');
      setSummary('');
      setContent('');
      setStartingSats('');
      setBuyNowSats('');
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ title: 'Error', description: 'Failed to publish the auction.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Gavel className="size-4" />
            Design auction
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="auction-title">Title</Label>
            <Input
              id="auction-title"
              placeholder={initialTitle ? initialTitle : 'e.g. Signed Bitcoin poster'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auction-summary">Summary</Label>
            <Textarea
              id="auction-summary"
              rows={2}
              placeholder="Short description for the auction card"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="auction-start">Starting bid (sats)</Label>
              <Input
                id="auction-start"
                type="number"
                min={0}
                placeholder="1000"
                value={startingSats}
                onChange={(e) => setStartingSats(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auction-buynow">Buy-now (sats, optional)</Label>
              <Input
                id="auction-buynow"
                type="number"
                min={0}
                placeholder="50000"
                value={buyNowSats}
                onChange={(e) => setBuyNowSats(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Duration</Label>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  variant={durationHours === opt.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDurationHours(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Bids lock real Cashu tokens with 2-of-3 escrow ({'{'}bidder, seller, operator{'}'}).
            The winner's tokens release to you at close; losing bids auto-refund. No Lightning,
            no on-chain transactions.
          </p>

          <Button
            className={cn('w-full')}
            disabled={!canPublish}
            onClick={handleSubmit}
          >
            {isPublishing ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Publishing…
              </>
            ) : (
              'Publish auction'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
