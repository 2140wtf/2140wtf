import { useState } from 'react';
import { MapPin, ShoppingCart, Tag, User, Box, Truck, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMarkListingSold } from '@/hooks/useMarkListingSold';
import { useProfileUrl } from '@/hooks/useProfileUrl';
import { useToast } from '@/hooks/useToast';
import { MarketplaceBuyDialog } from '@/components/marketplace/MarketplaceBuyDialog';
import { formatDeliveryMethod, formatNip99Price, type Nip99Listing } from '@/lib/nip99';

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

const SUPPORTED_BUY_CURRENCIES = new Set(['sats', 'sat', 'btc', 'usd']);

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
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      <div className="group rounded-2xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="block w-full text-left"
        >
          <div className="aspect-[4/3] bg-muted relative overflow-hidden">
            {firstImage ? (
              <img
                src={firstImage}
                alt={listing.title}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
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
            <h3 className="font-semibold text-sm line-clamp-2 flex-1">{listing.title}</h3>
            {listing.price && (
              <Badge variant="outline" className="shrink-0 text-xs">
                {formatNip99Price(listing.price)}
              </Badge>
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
              <div className="text-2xl font-bold">
                {formatNip99Price(listing.price)}
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
        <MarketplaceBuyDialog
          listing={listing}
          open={buyOpen}
          onOpenChange={setBuyOpen}
        />
      )}

      <LoginDialog
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLogin={() => setLoginOpen(false)}
      />
    </>
  );
}
