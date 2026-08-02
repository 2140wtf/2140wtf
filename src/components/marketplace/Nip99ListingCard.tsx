import { useMemo, useState } from 'react';
import { MapPin, ShoppingCart, Tag, User, Box, Truck, Download, ImageOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import LoginDialog from '@/components/auth/LoginDialog';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageGallery } from '@/components/ImageGallery';
import { SafeImage } from '@/components/SafeImage';
import { useAuthor } from '@/hooks/useAuthor';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMarkListingSold } from '@/hooks/useMarkListingSold';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { useToast } from '@/hooks/useToast';
import { CreateOrderDialog } from '@/components/CreateOrderDialog';
import { formatDeliveryMethod, formatNip99Price, formatNip99PaymentMethod, type Nip99Listing } from '@/lib/nip99';
import { cn } from '@/lib/utils';

interface Nip99ListingCardProps {
  listing: Nip99Listing;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const SUPPORTED_BUY_CURRENCIES = new Set([
  'sats', 'sat', 'btc', 'usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'ars', 'brl', 'mxn',
]);

function canCheckout(listing: Nip99Listing): boolean {
  if (listing.status !== 'active') return false;
  if (!listing.price) return false;
  return SUPPORTED_BUY_CURRENCIES.has(listing.price.currency.trim().toLowerCase());
}

function DeliveryBadge({ delivery }: { delivery?: Nip99Listing['delivery'] }) {
  if (!delivery) return null;
  return (
    <Badge variant="outline" className="text-[10px] capitalize">
      {delivery === 'digital' ? <Download className="w-2.5 h-2.5 mr-0.5" /> : <Truck className="w-2.5 h-2.5 mr-0.5" />}
      {formatDeliveryMethod(delivery)}
    </Badge>
  );
}

export function Nip99ListingCard({ listing }: Nip99ListingCardProps): React.JSX.Element {
  const { user } = useCurrentUser();
  const { data: author } = useAuthor(listing.pubkey);
  const navigate = useNavigate();
  const markSold = useMarkListingSold();
  const { toast } = useToast();
  const [detailOpen, setDetailOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  const metadata = author?.metadata;
  const displayName = metadata?.display_name || metadata?.name || `${listing.pubkey.slice(0, 8)}…`;
  const profileUrl = useProfileUrl(listing.pubkey, metadata);
  const sellerImage = metadata?.picture;
  const firstImage = listing.images[0];

  const isSeller = user?.pubkey === listing.pubkey;
  const canBuy = canCheckout(listing) && !isSeller;
  const merchantNpub = useMemo(() => nip19.npubEncode(listing.pubkey), [listing.pubkey]);
  const handleCreated = () => {
    navigate(`/messages/${merchantNpub}`);
  };
  const { startSignup } = useOnboarding();
  const [loginOpen, setLoginOpen] = useState(false);

  const { btcPrice } = useBtcPrice(!!listing.price, listing.price?.currency ?? 'usd');

  const priceDisplay = useMemo(() => {
    const price = listing.price;
    if (!price) return { kind: 'no-price' as const };
    if (!Number.isFinite(price.value) || price.value <= 0) return { kind: 'unsupported' as const };

    const currency = price.currency.trim().toLowerCase();
    const hasBtcPrice = btcPrice && Number.isFinite(btcPrice) && btcPrice > 0;

    if (currency === 'sats' || currency === 'sat') {
      const amountSats = Math.round(price.value);
      const usdAmount = hasBtcPrice ? (amountSats / 100_000_000) * btcPrice : undefined;
      return { kind: 'sats' as const, amountSats, usdAmount };
    }

    if (currency === 'btc') {
      const amountSats = Math.round(price.value * 100_000_000);
      if (amountSats <= 0) return { kind: 'unsupported' as const };
      const usdAmount = hasBtcPrice ? price.value * btcPrice : undefined;
      return { kind: 'sats' as const, amountSats, usdAmount };
    }

    if (['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'ars', 'brl', 'mxn'].includes(currency)) {
      if (!hasBtcPrice) {
        return { kind: 'loading' as const };
      }
      const amountSats = Math.round((price.value / btcPrice) * 100_000_000);
      if (amountSats <= 0) return { kind: 'unsupported' as const };
      return { kind: 'sats' as const, amountSats, usdAmount: price.value };
    }

    return { kind: 'unsupported' as const };
  }, [listing.price, btcPrice]);

  const priceLabel = useMemo(() => {
    if (priceDisplay.kind === 'no-price') return 'Price on request';
    if (priceDisplay.kind === 'loading') return 'Converting…';
    if (priceDisplay.kind === 'unsupported') return formatNip99Price(listing.price);
    return `${priceDisplay.amountSats.toLocaleString()} sats`;
  }, [priceDisplay, listing.price]);

  return (
    <>
      <div className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="block w-full text-left"
        >
          <div className={cn('relative overflow-hidden bg-muted', firstImage ? 'aspect-[4/3]' : 'h-10')}>
            {firstImage ? (
              <SafeImage
                src={firstImage}
                alt={listing.title}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center gap-1.5 text-muted-foreground text-xs border-b border-dashed border-border">
                <ImageOff className="size-3.5" />
                No image
              </div>
            )}
            {listing.status !== 'active' && (
              <div className="absolute top-2 left-2">
                <Badge variant={listing.status === 'sold' ? 'destructive' : 'secondary'}>
                  {listing.status}
                </Badge>
              </div>
            )}
          </div>
        </button>

        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="font-semibold text-sm line-clamp-2 flex-1 text-left"
            >
              {listing.title}
            </button>
            {listing.price && (
              <div className="flex flex-col items-end shrink-0">
                <Badge variant="outline" className="text-xs">
                  {priceLabel}
                </Badge>
                {listing.price && !['sats', 'sat', 'btc'].includes(listing.price.currency.trim().toLowerCase()) && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatNip99Price(listing.price)} reference
                  </span>
                )}
              </div>
            )}
          </div>

          {listing.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2">{listing.summary}</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {typeof listing.stock === 'number' && (
              <Badge variant="secondary" className="text-[10px]">
                {listing.stock} in stock
              </Badge>
            )}
            {listing.format && (
              <Badge variant="outline" className="text-[10px] capitalize">
                <Box className="w-2.5 h-2.5 mr-0.5" />
                {listing.format}
              </Badge>
            )}
            <DeliveryBadge delivery={listing.delivery} />
            {listing.paymentMethods.slice(0, 3).map((method) => (
              <Badge key={method} variant="secondary" className="text-[10px]">
                {formatNip99PaymentMethod(method)}
              </Badge>
            ))}
            {listing.categories.slice(0, 3).map((cat) => (
              <Badge key={cat} variant="secondary" className="text-[10px] capitalize">
                <Tag className="w-2.5 h-2.5 mr-0.5" />
                {cat}
              </Badge>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="size-6">
                <AvatarImage src={sellerImage} alt={displayName} />
                <AvatarFallback className="text-[10px]">{getInitials(displayName)}</AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground truncate">{displayName}</span>
            </div>
            {listing.location && (
              <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                <MapPin className="w-3 h-3" />
                <span className="truncate max-w-[80px]">{listing.location}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{listing.title}</DialogTitle>
          </DialogHeader>

          {listing.images.length > 0 && (
            <div className="rounded-xl overflow-hidden bg-muted">
              <ImageGallery images={listing.images} maxVisible={4} maxGridHeight="360px" />
            </div>
          )}

          <div className="space-y-4">
            {listing.price && (
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-2xl font-bold">{priceLabel}</div>
                  {priceDisplay.kind === 'sats' && !['sats', 'sat', 'btc'].includes(listing.price.currency.trim().toLowerCase()) && (
                    <div className="text-sm text-muted-foreground">
                      {formatNip99Price(listing.price)} reference · rate estimate
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {typeof listing.stock === 'number' && (
                <Badge variant="secondary">{listing.stock} in stock</Badge>
              )}
              {listing.format && (
                <Badge variant="outline" className="capitalize">
                  <Box className="w-3 h-3 mr-1" />
                  {listing.format}
                </Badge>
              )}
              <DeliveryBadge delivery={listing.delivery} />
            </div>

            <div className="flex items-center gap-2">
              <Avatar className="size-7">
                <AvatarImage src={sellerImage} alt={displayName} />
                <AvatarFallback className="text-xs">{getInitials(displayName)}</AvatarFallback>
              </Avatar>
              <div className="text-sm min-w-0 flex-1">
                <span className="font-medium">{displayName}</span>
                <span className="text-muted-foreground text-xs ml-2">{listing.pubkey.slice(0, 12)}…</span>
              </div>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => navigate(profileUrl)}
              >
                <User className="w-3.5 h-3.5 mr-1" />
                Visit profile
              </Button>
            </div>

            {listing.summary && (
              <p className="text-sm text-muted-foreground">{listing.summary}</p>
            )}

            {listing.content && (
              <div className="text-sm whitespace-pre-line text-card-foreground">
                {listing.content}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {listing.paymentMethods.map((method) => (
                <Badge key={method} variant="outline" className="text-xs">
                  {formatNip99PaymentMethod(method)}
                </Badge>
              ))}
              {listing.categories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-xs capitalize">
                  {cat}
                </Badge>
              ))}
            </div>

            {listing.location && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4" />
                {listing.location}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              {!isSeller ? (
                <Button
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!canBuy}
                  onClick={() => {
                    if (!user) {
                      toast({ title: 'Log in required', description: 'You need to log in to buy this item.' });
                      setLoginOpen(true);
                      return;
                    }
                    if (canBuy) setBuyOpen(true);
                  }}
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  {listing.status === 'sold' ? 'Sold' : 'Buy'}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={listing.status !== 'active' || markSold.isPending}
                  onClick={() => markSold.mutate(listing)}
                >
                  {markSold.isPending ? 'Updating…' : 'Mark as sold'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {canBuy && (
        <CreateOrderDialog
          listing={listing}
          open={buyOpen}
          onOpenChange={setBuyOpen}
          onCreated={handleCreated}
        />
      )}

      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={() => setLoginOpen(false)}
        onSignupClick={startSignup}
      />
    </>
  );
}
