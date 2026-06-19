/**
 * Interactive map showing Bitcoin-accepting shops worldwide.
 * Uses Leaflet with Canvas renderer for high-performance rendering
 * of thousands of markers.
 */

import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { Globe } from 'lucide-react';

import { getCountryBbox } from '@/lib/btcmap/btcmap';

// Defensive patches for Leaflet rAF callbacks that can fire after the map
// container is removed from the DOM during React tab switches.
// See: https://github.com/PaulLeCam/react-leaflet/issues/1136
interface CanvasPatch {
  _clear?(): void;
  _draw?(): void;
  _container?: HTMLCanvasElement | null;
  _ctx?: CanvasRenderingContext2D | null;
}
const canvasProto = L.Canvas?.prototype as unknown as CanvasPatch | undefined;
if (canvasProto) {
  if (typeof canvasProto._clear === 'function') {
    const originalClear = canvasProto._clear;
    canvasProto._clear = function (this: CanvasPatch) {
      if (!this._container || !this._ctx) return;
      return originalClear.call(this);
    };
  }
  if (typeof canvasProto._draw === 'function') {
    const originalDraw = canvasProto._draw;
    canvasProto._draw = function (this: CanvasPatch) {
      if (!this._container || !this._ctx) return;
      return originalDraw.call(this);
    };
  }
}
const originalGetPosition = L.DomUtil.getPosition;
L.DomUtil.getPosition = function (el) {
  if (!el) return new L.Point(0, 0);
  return originalGetPosition(el);
} as typeof L.DomUtil.getPosition;

// Guard internal map-pane reads that can fire after React unmounts the container.
interface LeafletMapInternals extends L.Map {
  _mapPane?: HTMLElement | null;
  _container?: HTMLElement | null;
}
interface MapPanePatch {
  _getMapPanePos?: () => L.Point;
  _onZoomTransitionEnd?: () => void;
}
const mapProto = L.Map?.prototype as unknown as MapPanePatch | undefined;
if (mapProto) {
  if (typeof mapProto._getMapPanePos === 'function') {
    const originalGetMapPanePos = mapProto._getMapPanePos;
    mapProto._getMapPanePos = function (this: L.Map) {
      if (!(this as LeafletMapInternals)._mapPane) return new L.Point(0, 0);
      return originalGetMapPanePos.call(this);
    };
  }
  if (typeof mapProto._onZoomTransitionEnd === 'function') {
    const originalOnZoomTransitionEnd = mapProto._onZoomTransitionEnd;
    mapProto._onZoomTransitionEnd = function (this: L.Map) {
      const internals = this as LeafletMapInternals;
      if (!internals._mapPane || !internals._container) return;
      return originalOnZoomTransitionEnd.call(this);
    };
  }
}

interface Shop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  country?: string;
  verified: boolean;
  addressKnown?: boolean;
}

interface ShopMapProps {
  shops: Shop[];
  selectedShopId: string | null;
  onSelectShop: (id: string) => void;
  onMapClick?: () => void;
  userLocation: { lat: number; lon: number } | null;
  onBoundsChange?: (bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number }) => void;
  theme?: 'dark' | 'light';
  countryFilter?: string;
}

const VERIFIED_COLOR = '#10b981';
const VERIFIED_STROKE = '#059669';
const UNVERIFIED_COLOR = '#a855f7';
const UNVERIFIED_STROKE = '#7c3aed';
const UNKNOWN_ADDR_COLOR = '#6b7280';
const UNKNOWN_ADDR_STROKE = '#4b5563';
const USER_COLOR = '#3b82f6';
const USER_STROKE = '#2563eb';

function getMarkerColors(shop: Shop) {
  if (shop.addressKnown === false) {
    return { fill: UNKNOWN_ADDR_COLOR, stroke: UNKNOWN_ADDR_STROKE };
  }
  if (shop.verified) {
    return { fill: VERIFIED_COLOR, stroke: VERIFIED_STROKE };
  }
  return { fill: UNVERIFIED_COLOR, stroke: UNVERIFIED_STROKE };
}

function getRadius(zoom: number): number {
  if (zoom <= 3) return 4;
  if (zoom <= 6) return 5;
  if (zoom <= 10) return 6;
  return 7;
}

/** Escape HTML entities to prevent XSS in popup content */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function ShopMap({ shops, selectedShopId, onSelectShop, onMapClick, userLocation, onBoundsChange, theme = 'dark', countryFilter = 'all' }: ShopMapProps): React.JSX.Element {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const prevShopCount = useRef(0);
  const prevSelected = useRef<string | null>(null);
  const prevRadius = useRef<number | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tileErrorHandlerRef = useRef<(() => void) | null>(null);
  const onSelectShopRef = useRef(onSelectShop);
  const onMapClickRef = useRef(onMapClick);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const prevCountryFilter = useRef<string>(countryFilter);

  useEffect(() => { onSelectShopRef.current = onSelectShop; }, [onSelectShop]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const markers = markersRef.current;
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const tileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: 'abcd',
      className: theme === 'dark' ? 'leaflet-bright-dark' : 'leaflet-light',
    }).addTo(map);
    // Fallback tile layer if CartoDB fails
    let fallbackTriggered = false;
    const tileErrorHandler = () => {
      if (!fallbackTriggered && tileLayerRef.current) {
        fallbackTriggered = true;
        tileLayerRef.current.setUrl('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      }
    };
    tileLayer.on('tileerror', tileErrorHandler);
    tileErrorHandlerRef.current = tileErrorHandler;
    tileLayerRef.current = tileLayer;

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Force resize after container is fully laid out — fixes blank map in flex containers.
    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 400);
    const resizeTimer2 = setTimeout(() => {
      map.invalidateSize();
    }, 800);

    // ResizeObserver catches any later container size changes (tab switches, accordion open, etc.)
    const resizeObs = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObs.observe(containerRef.current);

    // Report bounds on interaction AND immediately after first render
    let moveTimeout: ReturnType<typeof setTimeout> | null = null;
    let initialTimeout: ReturnType<typeof setTimeout> | null = null;
    let reportBoundsHandler: (() => void) | null = null;
    if (onBoundsChangeRef.current) {
      reportBoundsHandler = () => {
        if (moveTimeout) clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
          const b = map.getBounds();
          onBoundsChangeRef.current?.({
            minLat: b.getSouth(),
            minLon: b.getWest(),
            maxLat: b.getNorth(),
            maxLon: b.getEast(),
          });
        }, 150);
      };
      map.on('moveend zoomend', reportBoundsHandler);
      // Fire initial bounds after tiles start loading
      initialTimeout = setTimeout(reportBoundsHandler, 200);
    }
    // Close popup when clicking on empty map area
    const clickHandler = () => onMapClickRef.current?.();
    if (onMapClickRef.current) {
      map.on('click', clickHandler as L.LeafletEventHandlerFn);
    }

    mapRef.current = map;

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      if (initialTimeout) clearTimeout(initialTimeout);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (resizeTimer2) clearTimeout(resizeTimer2);
      resizeObs.disconnect();
      if (reportBoundsHandler) {
        map.off('moveend zoomend', reportBoundsHandler);
      }
      if (onMapClickRef.current) {
        map.off('click', clickHandler);
      }
      if (tileErrorHandlerRef.current) {
        tileLayerRef.current?.off('tileerror', tileErrorHandlerRef.current);
        tileErrorHandlerRef.current = null;
      }
      // Clear all marker references before removing map
      markers.clear();
      // Stop any in-flight animations/tile loads to avoid Leaflet accessing
      // removed container properties (_leaflet_pos) during unmount.
      try {
        map.stop();
      } catch {
        // ignore
      }
      mapRef.current = null;
      try {
        map.remove();
      } catch {
        // ignore
      }
    };
  }, [theme]);

  // Update tile layer when theme changes without rebuilding the whole map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileLayerRef.current) return;

    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    tileLayerRef.current.setUrl(tileUrl);
    tileLayerRef.current.options.className = theme === 'dark' ? 'leaflet-bright-dark' : 'leaflet-light';

    const container = map.getContainer();
    container.classList.remove('leaflet-bright-dark', 'leaflet-light');
    container.classList.add(theme === 'dark' ? 'leaflet-bright-dark' : 'leaflet-light');

    // Force tile refresh
    tileLayerRef.current.redraw();
  }, [theme]);

  const handleReset = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([20, 0], 2, { animate: true, duration: 0.6 });
  }, []);

  // Pan / zoom the map when the country filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || countryFilter === prevCountryFilter.current) return;
    prevCountryFilter.current = countryFilter;

    if (countryFilter === 'all') {
      map.setView([20, 0], 2, { animate: true, duration: 0.6 });
      return;
    }

    const bbox = getCountryBbox(countryFilter);
    if (!bbox) return;

    const bounds = L.latLngBounds([
      [bbox.minLat, bbox.minLon],
      [bbox.maxLat, bbox.maxLon],
    ]);
    map.flyToBounds(bounds.pad(0.1), { animate: true, duration: 0.8 });
  }, [countryFilter]);

  // Update markers when shops or user location changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const zoom = map.getZoom();
    const radius = getRadius(zoom);

    // Remove markers no longer in the filtered list
    markersRef.current.forEach((marker, key) => {
      if (key === '__user__') return; // handled separately
      if (!shops.find(s => s.id === key)) {
        map.removeLayer(marker);
        markersRef.current.delete(key);
      }
    });

    // Add/update circle markers for current shops
    const radiusChanged = prevRadius.current !== radius;
    prevRadius.current = radius;
    shops.forEach((shop) => {
      let marker = markersRef.current.get(shop.id);
      if (!marker) {
        const colors = getMarkerColors(shop);
        marker = L.circleMarker([shop.lat, shop.lon], {
          radius,
          fillColor: colors.fill,
          color: colors.stroke,
          weight: 1,
          opacity: 0.9,
          fillOpacity: shop.addressKnown === false ? 0.5 : 0.85,
        }).addTo(map);

        const popupBg = theme === 'light' ? '#ffffff' : '#0f172a';
        const popupText = theme === 'light' ? '#111827' : '#e5e7eb';
        const popupSub = theme === 'light' ? '#6b7280' : '#9ca3af';
        const popup = L.popup({
          closeButton: false,
          className: theme === 'light' ? 'shop-popup-light' : 'shop-popup-dark',
          offset: [0, -6],
        }).setContent(`
          <div style="
            font-family: system-ui, sans-serif;
            font-size: 13px;
            color: ${popupText};
            min-width: 140px;
            background: ${popupBg};
            padding: 8px 12px;
            border-radius: 10px;
          ">
            <div style="font-weight: 700; margin-bottom: 2px;">${escapeHtml(shop.name)}</div>
            <div style="font-size: 11px; color: ${popupSub};">${escapeHtml(shop.country ?? '')}</div>
          </div>
        `);

        marker.bindPopup(popup);
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectShopRef.current(shop.id);
        });
        markersRef.current.set(shop.id, marker);
      } else {
        // Update radius on zoom change, and position if shop moved
        if (radiusChanged) marker.setStyle({ radius });
        const latLng = marker.getLatLng();
        if (latLng && (latLng.lat !== shop.lat || latLng.lng !== shop.lon)) {
          marker.setLatLng([shop.lat, shop.lon]);
        }
      }
    });

    // Add user location marker
    if (userLocation) {
      let userMarker = markersRef.current.get('__user__');
      if (!userMarker) {
        userMarker = L.circleMarker([userLocation.lat, userLocation.lon], {
          radius: radius + 2,
          fillColor: USER_COLOR,
          color: USER_STROKE,
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        }).addTo(map);
        markersRef.current.set('__user__', userMarker);
      } else {
        userMarker.setStyle({ radius: radius + 2 });
        const latLng = userMarker.getLatLng();
        if (latLng && (latLng.lat !== userLocation.lat || latLng.lng !== userLocation.lon)) {
          userMarker.setLatLng([userLocation.lat, userLocation.lon]);
        }
      }
    } else {
      // Remove user marker if location is lost
      const userMarker = markersRef.current.get('__user__');
      if (userMarker) {
        map.removeLayer(userMarker);
        markersRef.current.delete('__user__');
      }
    }

    // Fit bounds when filter changes (shop count changes significantly).
    // Skip when a country is selected — the country effect handles zooming.
    if (countryFilter === 'all' && shops.length > 0 && Math.abs(shops.length - prevShopCount.current) > 5) {
      const bounds = L.latLngBounds(shops.map(s => [s.lat, s.lon]));
      map.fitBounds(bounds.pad(0.15), { animate: true, duration: 0.6 });
    }
    prevShopCount.current = shops.length;
  }, [shops, userLocation, theme, countryFilter]);

  // Pan + zoom when a specific shop is selected from the list
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedShopId) {
      prevSelected.current = null;
      return;
    }
    if (selectedShopId === prevSelected.current) return;
    prevSelected.current = selectedShopId;

    const shop = shops.find(s => s.id === selectedShopId);
    if (!shop) return;

    map.setView([shop.lat, shop.lon], 15, { animate: true, duration: 0.5 });
    const marker = markersRef.current.get(shop.id);
    marker?.openPopup();
  }, [selectedShopId, shops]);

  return (
    <>
      <style>{`
        .leaflet-bright-dark {
          filter: brightness(1.35) contrast(1.05) saturate(1.1);
        }
        .shop-popup-dark .leaflet-popup-content-wrapper {
          background: #0f172a !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
          padding: 0 !important;
        }
        .shop-popup-dark .leaflet-popup-tip {
          background: #0f172a !important;
        }
        .shop-popup-light .leaflet-popup-content-wrapper {
          background: #ffffff !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
          padding: 0 !important;
          border: 1px solid rgba(0,0,0,0.08);
        }
        .shop-popup-light .leaflet-popup-tip {
          background: #ffffff !important;
        }
        .leaflet-popup-content {
          margin: 0 !important;
          line-height: 1.4 !important;
        }
        .leaflet-container {
          background: ${theme === 'dark' ? '#0c0a09' : '#fafaf9'} !important;
        }
      `}</style>
      <div className="relative w-full h-full">
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{
            borderRadius: 0,
            overflow: 'hidden',
          }}
        />
        <button
          type="button"
          onClick={handleReset}
          className="absolute top-3 right-3 z-[400] flex items-center gap-1.5 px-3 py-2 rounded-lg bg-background/90 text-foreground border border-border shadow-sm hover:bg-accent hover:text-accent-foreground transition-all backdrop-blur-sm text-xs font-medium"
          title="Reset map view"
          aria-label="Reset map view"
        >
          <Globe className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>
    </>
  );
}
