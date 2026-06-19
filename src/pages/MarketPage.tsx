import { useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { Nip99ListingCard } from '@/components/marketplace/Nip99ListingCard';
import { ProductListingComposeDialog } from '@/components/marketplace/ProductListingComposeDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNip99Listings } from '@/hooks/useNip99Listings';

const CATEGORIES = [
  { value: 'art', label: 'Bitcoin Art' },
  { value: 'product', label: 'Products' },
  { value: 'all', label: 'All listings' },
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'photography', label: 'Photography' },
  { value: 'digitalart', label: 'Digital Art' },
  { value: 'print', label: 'Prints' },
  { value: 'merch', label: 'Merch' },
];

export function MarketPage(): React.JSX.Element {
  const { config } = useAppContext();
  useSeoMeta({
    title: `Store | ${config.appName}`,
    description: 'Bitcoin art and goods from Nostr NIP-99 classified listings.',
  });

  const { user } = useCurrentUser();
  const [category, setCategory] = useState('art');
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);

  const { listings, isLoading, error, refetch } = useNip99Listings({
    category,
    search,
    onlyActive: true,
  });

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

    if (listings.length === 0) {
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

    return listings.map((listing) => <Nip99ListingCard key={listing.id} listing={listing} />);
  }, [isLoading, listings, error, refetch]);

  return (
    <main>
      <PageHeader title="Store" icon={<ShoppingBag className="size-5" />} />

      <div className="px-4 py-4 max-w-6xl mx-auto space-y-4">
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

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
