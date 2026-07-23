import { useMemo, useState } from 'react';
import { Loader2, ShoppingCart } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useGammaOrderActions } from '@/hooks/useGammaOrderActions';
import { useSellerShippingOptions } from '@/hooks/useShippingOptions';
import { useToast } from '@/hooks/useToast';
import { formatSats } from '@/lib/bitcoin';
import { buildListingAddress } from '@/lib/gammaMarkets';
import { getListingPriceState } from '@/lib/marketplace';
import { shippingOptionAddress } from '@/lib/shippingOption';
import type { Nip99Listing } from '@/lib/nip99';

interface CreateOrderDialogProps {
  listing: Nip99Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (orderId: string) => void;
}

/**
 * Buyer-facing order creation dialog for Gamma Markets listings.
 *
 * Builds a kind 16 type 1 order message and sends it to the merchant over
 * NIP-17 gift-wrapped DMs. The seller can then reply with a payment request.
 */
export function CreateOrderDialog({
  listing,
  open,
  onOpenChange,
  onCreated,
}: CreateOrderDialogProps) {
  const { btcPrice } = useBtcPrice(open && !!listing.price);
  const priceState = useMemo(
    () => getListingPriceState(listing, btcPrice),
    [listing, btcPrice],
  );
  const { data: sellerShippingOptions } = useSellerShippingOptions(
    open ? listing.pubkey : undefined,
  );
  const { createOrder, isPending } = useGammaOrderActions();
  const { toast } = useToast();

  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [selectedShipping, setSelectedShipping] = useState('');

  const requiresShipping =
    listing.format !== 'digital' && listing.delivery !== 'digital';

  const availableShipping = useMemo(() => {
    if (!sellerShippingOptions) return [];
    const refs = new Set(listing.shippingOptionRefs.map((r) => r.address));
    if (refs.size === 0) return sellerShippingOptions;
    return sellerShippingOptions.filter((option) =>
      refs.has(shippingOptionAddress(option.pubkey, option.dTag)),
    );
  }, [sellerShippingOptions, listing.shippingOptionRefs]);

  const unitSats = priceState.kind === 'ready' ? priceState.amountSats : 0;
  const totalSats = unitSats * quantity;

  const resetForm = () => {
    setQuantity(1);
    setNote('');
    setShippingAddress('');
    setSelectedShipping('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (priceState.kind !== 'ready' || quantity < 1) return;

    try {
      const { orderId } = await createOrder({
        merchantPubkey: listing.pubkey,
        amountSats: totalSats,
        items: [
          {
            listingAddress: buildListingAddress(listing.pubkey, listing.dTag),
            quantity,
          },
        ],
        shippingOptionAddress: selectedShipping || undefined,
        shippingAddress: requiresShipping ? shippingAddress || undefined : undefined,
        note: note || undefined,
      });

      toast({ title: 'Order created', description: `Order ${orderId} sent to the seller.` });
      onCreated?.(orderId);
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast({
        title: 'Order failed',
        description: error instanceof Error ? error.message : 'Could not create order',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="size-5" />
            Order {listing.title}
          </DialogTitle>
          <DialogDescription>
            Send a structured order request to the seller. Payment happens after
            they confirm and request it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {priceState.kind === 'ready' ? (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-lg font-semibold">{formatSats(totalSats)} sats</p>
                {quantity > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {formatSats(unitSats)} sats each
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="qty" className="sr-only">
                  Quantity
                </Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                  className="w-20"
                />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border p-3 text-sm text-muted-foreground">
              {priceState.kind === 'loading'
                ? 'Loading price…'
                : 'This listing cannot be ordered automatically.'}
            </div>
          )}

          {requiresShipping && availableShipping.length > 0 && (
            <div className="space-y-2">
              <Label>Shipping option</Label>
              <Select value={selectedShipping} onValueChange={setSelectedShipping}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose shipping" />
                </SelectTrigger>
                <SelectContent>
                  {availableShipping.map((option) => (
                    <SelectItem
                      key={`${option.pubkey}:${option.dTag}`}
                      value={shippingOptionAddress(option.pubkey, option.dTag)}
                    >
                      {option.title}
                      {option.price
                        ? ` — ${option.price.value} ${option.price.currency}`
                        : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {requiresShipping && (
            <div className="space-y-2">
              <Label htmlFor="address">Shipping address</Label>
              <Textarea
                id="address"
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                placeholder="Enter the address where you want the item shipped"
                rows={3}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="note">Note to seller</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional details such as size, color, or delivery instructions"
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={priceState.kind !== 'ready' || isPending || quantity < 1}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <ShoppingCart className="size-4 mr-2" />
              )}
              Create order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
