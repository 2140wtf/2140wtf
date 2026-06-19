/**
 * Hook for loading Bitcoin shop data from the full BTC Map dataset.
 * Loads ~25,000 real businesses from a static JSON file on startup,
 * then filters client-side by country, type, search, and viewport.
 * Overpass API is used as a fallback for deep-zoom real-time updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BtcShop, BBox } from '@/lib/btcmap/btcmap';
import { fetchShopsForBBox, getCountryCode, isBBoxTooLarge } from '@/lib/btcmap/btcmap';

export interface ShopWithMeta extends BtcShop {
  distance: string;
  open: boolean;
  rating: number;
  reviews: number;
}

async function loadStaticData(): Promise<BtcShop[]> {
  const response = await fetch('/btcmap-data.json', { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Failed to load BTC Map data: ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Invalid BTC Map data format');
  return data as BtcShop[];
}

export function useBtcShops(): {
  allShops: BtcShop[];
  loading: boolean;
  error: string | null;
  getShops: (filterCountry: string, filterType: string, filterLightning: boolean, filterOnchain: boolean, searchQuery: string, viewportBbox?: BBox) => ShopWithMeta[];
  loadBBox: (bbox: BBox) => void;
} {
  const [allShops, setAllShops] = useState<BtcShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const bboxGenRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Load the full static dataset on mount
  useEffect(() => {
    let cancelled = false;
    loadStaticData()
      .then((data) => {
        if (cancelled) return;
        // Backfill fields for legacy static JSON that lacks them
        const patched = data.map((b) => ({
          ...b,
          addressKnown: b.addressKnown ?? !(b.address === 'Address unknown' || /^[A-Z]{2}$/.test(b.address)),
          canStamp: b.canStamp ?? (b.addressKnown ?? !(b.address === 'Address unknown' || /^[A-Z]{2}$/.test(b.address))),
          phone: b.phone ?? null,
          website: b.website ?? null,
          email: b.email ?? null,
          hours: b.hours ?? null,
          instagram: b.instagram ?? null,
          facebook: b.facebook ?? null,
          twitter: b.twitter ?? null,
        }));
        setAllShops((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]));
          for (const s of patched) byId.set(s.id, s);
          return Array.from(byId.values());
        });
        setLoading(false);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load map data');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Filter + decorate shops based on criteria
  const getShops = useCallback((
    filterCountry: string,
    filterType: string,
    filterLightning: boolean,
    filterOnchain: boolean,
    searchQuery: string,
    viewportBbox?: BBox,
  ): ShopWithMeta[] => {
    let results = allShops;

    // Country filter (static data uses ISO codes, UI uses display names)
    if (filterCountry !== 'all') {
      const filterCode = getCountryCode(filterCountry);
      results = results.filter(
        (s) => s.country === filterCountry || s.country === filterCode
      );
    }

    // Type filter
    if (filterType !== 'all') {
      results = results.filter((s) => s.type === filterType);
    }

    // Payment filters
    if (filterLightning) {
      results = results.filter((s) => s.lightning);
    }
    if (filterOnchain) {
      results = results.filter((s) => s.onchain);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q) ||
          (s.city ?? '').toLowerCase().includes(q) ||
          (s.phone ?? '').toLowerCase().includes(q) ||
          (s.hours ?? '').toLowerCase().includes(q)
      );
    }

    // Viewport filter (only render shops in view)
    if (viewportBbox) {
      results = results.filter(
        (s) =>
          s.lat >= viewportBbox.minLat &&
          s.lat <= viewportBbox.maxLat &&
          s.lon >= viewportBbox.minLon &&
          s.lon <= viewportBbox.maxLon
      );
    }

    return results.map((b) => ({
      ...b,
      distance: '', // computed client-side from GPS
      open: true,
      rating: 0,
      reviews: 0,
    }));
  }, [allShops]);

  // Fetch live updates for a deep-zoom bbox (Overpass fallback)
  const loadBBox = useCallback((bbox: BBox) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const gen = ++bboxGenRef.current;
    debounceRef.current = setTimeout(async () => {
      // Skip huge bboxes — Overpass rejects them and static data already covers world view
      if (isBBoxTooLarge(bbox)) return;
      try {
        const fresh = await fetchShopsForBBox(bbox);
        if (!mountedRef.current || gen !== bboxGenRef.current) return;
        if (fresh.length > 0) {
          setAllShops((prev) => {
            const byId = new Map(prev.map((s) => [s.id, s]));
            for (const s of fresh) byId.set(s.id, s);
            return Array.from(byId.values());
          });
        }
      } catch (err) {
        // Overpass failures are expected for offline/unreachable states — warn, don't error
        console.warn('Overpass fetch skipped or failed:', err instanceof Error ? err.message : err);
      }
    }, 1000);
  }, []);

  // Clean up debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    allShops,
    loading,
    error,
    getShops,
    loadBBox,
  };
}
