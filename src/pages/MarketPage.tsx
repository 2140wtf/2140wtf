import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, ShoppingBag, LayoutGrid, ArrowUpDown } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { Nip99ListingCard } from '@/components/marketplace/Nip99ListingCard';
import { ProductListingComposeDialog } from '@/components/marketplace/ProductListingComposeDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppContext } from '@/hooks/useAppContext';
import { useAuthors, type AuthorData } from '@/hooks/useAuthors';
import { useBtcPrice } from '@/hooks/useBtcPrice';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNip99Listings } from '@/hooks/useNip99Listings';
import { PRODUCT_CATEGORIES, type ListingCategoryValue, type Nip99Listing } from '@/lib/nip99';
import { cn } from '@/lib/utils';

const FILTER_CATEGORIES = [
  { value: 'all', label: 'All listings' },
  ...PRODUCT_CATEGORIES,
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price-low', label: 'Price: lowest' },
  { value: 'price-high', label: 'Price: highest' },
  { value: 'merchant', label: 'Merchant' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

/** Convert a NIP-99 price into sats for cross-currency sorting. */
function priceInSats(price: Nip99Listing['price'], btcPrice?: number): number | undefined {
  if (!price) return undefined;

  const currency = price.currency.trim().toLowerCase();

  if (currency === 'sats' || currency === 'sat') {
    return price.value;
  }
  if (currency === 'msats' || currency === 'msat') {
    return price.value / 1000;
  }
  if (currency === 'btc') {
    return price.value * 1e8;
  }
  if (currency === 'usd' && btcPrice && btcPrice > 0) {
    return (price.value / btcPrice) * 1e8;
  }

  return undefined;
}

/** Get a display name for a merchant, falling back to their pubkey. */
function merchantName(pubkey: string, authors?: Map<string, AuthorData>): string {
  const data = authors?.get(pubkey);
  const metadata = data?.metadata;
  return (
    metadata?.display_name?.trim() ||
    metadata?.name?.trim() ||
    pubkey
  );
}

export function MarketPage(): React.JSX.Element {
  const { config } = useAppContext();
  useSeoMeta({
    title: `Merchants | ${config.appName}`,
    description: 'Bitcoin art and goods from Nostr NIP-99 classified listings.',
  });

  const { user } = useCurrentUser();
  const [category, setCategory] = useState<ListingCategoryValue | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortValue>('newest');
  const [columns, setColumns] = useState<1 | 2 | 3 | 4>(2);
  const [composeOpen, setComposeOpen] = useState(false);

  const { btcPrice } = useBtcPrice();

  const { listings, isLoading, error, refetch } = useNip99Listings({
    category,
    search,
    onlyActive: true,
  });

  const { data: authors } = useAuthors(
    sort === 'merchant' ? listings.map((listing) => listing.pubkey) : [],
  );

  const sortedListings = useMemo(() => {
    const items = [...listings];

    switch (sort) {
      case 'newest':
        break;
      case 'oldest':
        items.reverse();
        break;
      case 'price-low':
      case 'price-high': {
        const ascending = sort === 'price-low';
        items.sort((a, b) => {
          const aSats = priceInSats(a.price, btcPrice);
          const bSats = priceInSats(b.price, btcPrice);

          if (aSats === undefined && bSats === undefined) {
            return b.createdAt - a.createdAt;
          }
          if (aSats === undefined) return 1;
          if (bSats === undefined) return -1;

          const diff = ascending ? aSats - bSats : bSats - aSats;
          return diff || b.createdAt - a.createdAt;
        });
        break;
      }
      case 'merchant': {
        items.sort((a, b) => {
          const aName = merchantName(a.pubkey, authors);
          const bName = merchantName(b.pubkey, authors);
          return (
            aName.localeCompare(bName, undefined, { sensitivity: 'base' }) ||
            b.createdAt - a.createdAt
          );
        });
        break;
      }
    }

    // Listings with images first; Array.sort is stable, so the chosen
    // ordering is preserved within each group.
    items.sort((a, b) => Number(b.images.length > 0) - Number(a.images.length > 0));

    return items;
  }, [listings, sort, btcPrice, authors]);

  const gridItems = useMemo(() => {
    if (isLoading) {
      return Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
          <Skeleton className="aspect-[4/3] w-full" />
          <div className="p-4 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ));
    }

    if (sortedListings.length === 0) {
      return (
        <div className="col-span-full py-20 text-center text-sm text-muted-foreground">
          {error ? (
            <div className="space-y-3">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : (
            <p>No active listings found. Try a different category or search.</p>
          )}
        </div>
      );
    }

    return sortedListings.map((listing) => <Nip99ListingCard key={listing.id} listing={listing} />);
  }, [isLoading, sortedListings, error, refetch]);

  return (
    <main>
      <PageHeader title="Merchants" icon={<ShoppingBag className="size-5" />} />

      <div className="px-[11px] py-4 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search listings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={sort} onValueChange={(value) => setSort(value as SortValue)}>
            <SelectTrigger
              className="w-full sm:w-10 px-0 justify-center [&>[data-radix-select-trigger-icon]]:hidden"
              aria-label={`Sort by ${SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Sort'}`}
            >
              <ArrowUpDown className="size-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">
                {SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Sort'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={(value) => setCategory(value as ListingCategoryValue | 'all')}>
            <SelectTrigger className="w-full sm:w-28 justify-between" aria-label="Filter by type">
              <span>Type</span>
            </SelectTrigger>
            <SelectContent>
              {FILTER_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => setColumns((c) => ((c % 4) + 1) as 1 | 2 | 3 | 4)}
            aria-label={`${columns} columns`}
          >
            <LayoutGrid className="size-4" />
            {columns}
          </Button>

          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          {user && (
            <Button onClick={() => setComposeOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              List product
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Showing NIP-99 classified listings published by Nostr users. Artwork and products are sold by the artists, not by {config.appName}.
        </p>

        <div
          className={cn(
            'grid gap-4',
            columns === 1 && 'grid-cols-1',
            columns === 2 && 'grid-cols-2',
            columns === 3 && 'grid-cols-3',
            columns === 4 && 'grid-cols-4',
          )}
        >
          {gridItems}
        </div>
      </div>

      <ProductListingComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSuccess={() => refetch()}
      />
    </main>
  );
}

export default MarketPage;
