import type { NostrEvent } from '@nostrify/nostrify';
import { MapPin, Tag, Box, Truck, Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ImageGallery } from '@/components/ImageGallery';
import { NoteContent } from '@/components/NoteContent';
import { formatDeliveryMethod, formatNip99Price, parseNip99Listing } from '@/lib/nip99';

interface ClassifiedListingContentProps {
  event: NostrEvent;
  compact?: boolean;
  className?: string;
}

/**
 * Renders a NIP-99 classified listing (kind 30402) as an art/shop card.
 *
 * Displays the gallery of `image` tags, title/summary, price, location, stock,
 * delivery method, and status. This is used for the 2140 art/Store feed where
 * listings are additionally tagged `t: art`.
 */
export function ClassifiedListingContent({ event, compact, className }: ClassifiedListingContentProps) {
  const listing = parseNip99Listing(event);
  if (!listing) return null;

  const { title, summary, content, price, images, location, categories, status, stock, format, delivery } = listing;

  return (
    <div className={className}>
      {images.length > 0 && (
        <div className="mt-2">
          <ImageGallery images={images} maxVisible={compact ? 1 : 4} maxGridHeight="420px" />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {title && (
          <h3 className="text-lg font-semibold leading-snug break-words">{title}</h3>
        )}

        {summary ? (
          <p className="text-[15px] leading-relaxed text-muted-foreground break-words line-clamp-3">
            {summary}
          </p>
        ) : content ? (
          <div className={compact ? 'line-clamp-3' : undefined}>
            <NoteContent event={event} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {price && (
            <Badge variant="secondary" className="font-medium">
              {formatNip99Price(price)}
            </Badge>
          )}
          {typeof stock === 'number' && (
            <Badge variant="secondary" className="font-medium">
              {stock} in stock
            </Badge>
          )}
          {format && (
            <Badge variant="outline" className="capitalize">
              <Box className="w-3 h-3 mr-1" />
              {format}
            </Badge>
          )}
          {delivery && (
            <Badge variant="outline" className="capitalize">
              {delivery === 'digital' ? <Download className="w-3 h-3 mr-1" /> : <Truck className="w-3 h-3 mr-1" />}
              {formatDeliveryMethod(delivery)}
            </Badge>
          )}
          {status && status !== 'active' && (
            <Badge variant="outline" className="capitalize">
              {status}
            </Badge>
          )}
          {location && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" />
              <span className="truncate max-w-[200px]">{location}</span>
            </div>
          )}
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className="size-3.5 text-muted-foreground" />
            {categories.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs font-normal">
                #{tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
