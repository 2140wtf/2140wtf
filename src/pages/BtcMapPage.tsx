/**
 * Full-page BTC Map view.
 *
 * Renders a Leaflet map of Bitcoin-accepting merchants, filter controls,
 * and a detail popup for the selected shop. Loads a static JSON dataset on
 * mount and fetches fresh Overpass data when the viewport changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useSeoMeta } from '@unhead/react';

import { PageHeader } from '@/components/PageHeader';
import ShopMap from '@/components/btcmap/ShopMap';
import ShopMapPopup from '@/components/btcmap/ShopMapPopup';
import { BtcMapFilters, type BtcMapFiltersState } from '@/components/btcmap/BtcMapFilters';
import { useBtcShops, type ShopWithMeta } from '@/hooks/useBtcShops';
import { useLayoutOptions } from '@/contexts/LayoutContext';
import { useAppContext } from '@/hooks/useAppContext';
import { getBackgroundThemeMode } from '@/lib/colorUtils';
import type { BBox, BtcShop } from '@/lib/btcmap/btcmap';
import { fetchShopDetails, getCountryBbox } from '@/lib/btcmap/btcmap';

const DEFAULT_FILTERS: BtcMapFiltersState = {
  country: 'all',
  type: 'all',
  lightning: false,
  onchain: false,
  search: '',
};

export function BtcMapPage(): React.JSX.Element {
  const { config } = useAppContext();
  useSeoMeta({
    title: `BTC Map | ${config.appName}`,
    description: 'Map of Bitcoin-accepting merchants worldwide.',
  });

  // Make the center column fill the available width with no overscroll padding.
  useLayoutOptions({ noMaxWidth: true, noOverscroll: true, rightSidebar: null });

  const { allShops, loading, error, getShops, loadBBox } = useBtcShops();
  const [filters, setFilters] = useState<BtcMapFiltersState>(DEFAULT_FILTERS);
  const [viewportBbox, setViewportBbox] = useState<BBox | undefined>();
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [selectedShop, setSelectedShop] = useState<ShopWithMeta | null>(null);
  const [enriched, setEnriched] = useState<Partial<BtcShop> | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const theme: 'dark' | 'light' = useMemo(() => {
    return getBackgroundThemeMode();
  }, []);

  const visibleShops = useMemo(
    () => getShops(filters.country, filters.type, filters.lightning, filters.onchain, filters.search, viewportBbox),
    [getShops, filters, viewportBbox]
  );

  // Update selected shop details when id or shop list changes
  useEffect(() => {
    if (!selectedShopId) {
      setSelectedShop(null);
      setEnriched(null);
      return;
    }
    const shop = visibleShops.find((s) => s.id === selectedShopId) ?? allShops.find((s) => s.id === selectedShopId) ?? null;
    if (shop && 'distance' in shop) {
      setSelectedShop(shop as ShopWithMeta);
    } else if (shop) {
      setSelectedShop({ ...shop, distance: '', open: true, rating: 0, reviews: 0 });
    } else {
      setSelectedShop(null);
    }
  }, [selectedShopId, visibleShops, allShops]);

  // Enrich selected shop from BTC Map API
  useEffect(() => {
    if (!selectedShopId) {
      setEnriched(null);
      return;
    }
    let cancelled = false;
    fetchShopDetails(selectedShopId)
      .then((data) => {
        if (!cancelled) setEnriched(data);
      })
      .catch(() => {
        if (!cancelled) setEnriched(null);
      });
    return () => { cancelled = true; };
  }, [selectedShopId]);

  const handleFilterChange = useCallback((next: BtcMapFiltersState) => {
    setFilters(next);
    if (next.country !== filters.country) {
      // Prime the viewport filter so shops in the newly selected country
      // render immediately while the map animates to the country bounds.
      setViewportBbox(next.country === 'all' ? undefined : getCountryBbox(next.country));
      setSelectedShopId(null);
    }
  }, [filters.country]);

  const handleBoundsChange = useCallback((bounds: BBox) => {
    setViewportBbox(bounds);
    loadBBox(bounds);
  }, [loadBBox]);

  const handleSelectShop = useCallback((id: string) => {
    setSelectedShopId(id);
  }, []);

  const handleClosePopup = useCallback(() => {
    setSelectedShopId(null);
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserLocation(loc);
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }, []);

  return (
    <main className="flex flex-col h-[calc(100vh-var(--top-bar-height,0px)-var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] sidebar:h-[calc(100vh)]">
      <PageHeader title="BTC MAP" icon={<MapPin className="size-5" />} />
      <BtcMapFilters
        filters={filters}
        onChange={handleFilterChange}
        onLocate={handleLocate}
        locating={locating}
      />

      {loading && visibleShops.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading merchants…
        </div>
      )}

      {error && visibleShops.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-primary underline"
          >
            Reload
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <ShopMap
          shops={visibleShops}
          selectedShopId={selectedShopId}
          onSelectShop={handleSelectShop}
          onMapClick={handleClosePopup}
          userLocation={userLocation}
          onBoundsChange={handleBoundsChange}
          theme={theme}
          countryFilter={filters.country}
        />
        <ShopMapPopup
          shop={selectedShop}
          enriched={enriched}
          onClose={handleClosePopup}
          theme={theme}
        />
      </div>
    </main>
  );
}

export default BtcMapPage;
