import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { Globe } from 'lucide-react';
import type { RoadstrReport } from '@/lib/roadstr';
import { ROADSTR_EVENT_TYPES } from '@/components/roadstr/roadstrTypes';
import { timeAgo } from '@/lib/timeAgo';

// Defensive Leaflet patches for React unmount edge cases (mirrors ShopMap).
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

interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface RoadstrMapProps {
  reports: RoadstrReport[];
  selectedReportId?: string | null;
  onSelectReport?: (id: string) => void;
  onMapClick?: () => void;
  userLocation?: { lat: number; lon: number } | null;
  onBoundsChange?: (bounds: BBox) => void;
  theme?: 'dark' | 'light';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getRadius(zoom: number): number {
  if (zoom <= 5) return 5;
  if (zoom <= 9) return 6;
  if (zoom <= 13) return 8;
  return 10;
}

function getTileConfig(theme: 'dark' | 'light') {
  const isDark = theme === 'dark';
  if (isDark) {
    // Use CartoDB's native dark tiles to avoid the performance/flicker issues
    // caused by applying a CSS filter to the live tile layer.
    return {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      className: 'roadstr-carto-dark',
      fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      fallbackClassName: 'roadstr-osm-dark',
    };
  }
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    className: 'roadstr-osm-light',
    fallbackUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    fallbackClassName: 'roadstr-carto-light',
  };
}

export function RoadstrMap({
  reports,
  selectedReportId,
  onSelectReport,
  onMapClick,
  userLocation,
  onBoundsChange,
  theme = 'dark',
}: RoadstrMapProps): React.JSX.Element {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const onSelectReportRef = useRef(onSelectReport);
  const onMapClickRef = useRef(onMapClick);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const reportsRef = useRef<RoadstrReport[]>(reports);
  const prevThemeRef = useRef(theme);

  useEffect(() => { reportsRef.current = reports; }, [reports]);

  useEffect(() => { onSelectReportRef.current = onSelectReport; }, [onSelectReport]);
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

    const tileConfig = getTileConfig(theme);
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: 19,
      subdomains: 'abc',
      className: tileConfig.className,
    }).addTo(map);

    let fallbackTriggered = false;
    const tileErrorHandler = () => {
      if (!fallbackTriggered && tileLayerRef.current) {
        fallbackTriggered = true;
        tileLayerRef.current.setUrl(tileConfig.fallbackUrl);
        tileLayerRef.current.options.className = tileConfig.fallbackClassName;
        tileLayerRef.current.redraw();
      }
    };
    tileLayer.on('tileerror', tileErrorHandler);
    tileLayerRef.current = tileLayer;

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const resizeTimer = setTimeout(() => map.invalidateSize(), 100);

    const resizeObs = new ResizeObserver(() => map.invalidateSize());
    resizeObs.observe(containerRef.current);

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
      initialTimeout = setTimeout(reportBoundsHandler, 200);
    }

    const clickHandler = () => onMapClickRef.current?.();
    if (onMapClickRef.current) {
      map.on('click', clickHandler as L.LeafletEventHandlerFn);
    }

    const updateRadii = () => {
      const z = map.getZoom();
      const r = getRadius(z);
      markersRef.current.forEach((marker, key) => {
        marker.setStyle({ radius: key === '__user__' ? r + 2 : r });
      });
    };
    map.on('zoomend', updateRadii);

    mapRef.current = map;

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      if (initialTimeout) clearTimeout(initialTimeout);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObs.disconnect();
      if (reportBoundsHandler) map.off('moveend zoomend', reportBoundsHandler);
      map.off('zoomend', updateRadii);
      if (onMapClickRef.current) map.off('click', clickHandler);
      tileLayer.off('tileerror', tileErrorHandler);
      markers.clear();
      try { map.stop(); } catch { /* ignore */ }
      mapRef.current = null;
      try { map.remove(); } catch { /* ignore */ }
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const tileLayer = tileLayerRef.current;
    if (!map || !tileLayer) return;
    if (prevThemeRef.current === theme) return;
    prevThemeRef.current = theme;

    const tileConfig = getTileConfig(theme);
    tileLayer.setUrl(tileConfig.url);
    tileLayer.options.className = tileConfig.className;
    const container = map.getContainer();
    container.classList.remove('roadstr-osm-light', 'roadstr-osm-dark', 'roadstr-carto-light', 'roadstr-carto-dark');
    container.classList.add(tileConfig.className);
    tileLayer.redraw();
  }, [theme]);

  const handleReset = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([20, 0], 2, { animate: true, duration: 0.6 });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const zoom = map.getZoom();
    const radius = getRadius(zoom);
    const popupBg = theme === 'light' ? '#ffffff' : '#0f172a';
    const popupText = theme === 'light' ? '#111827' : '#e5e7eb';
    const popupSub = theme === 'light' ? '#6b7280' : '#9ca3af';

    // Remove markers whose reports are no longer in the list.
    markersRef.current.forEach((marker, key) => {
      if (key === '__user__') return;
      if (!reports.find((r) => r.id === key)) {
        map.removeLayer(marker);
        markersRef.current.delete(key);
      }
    });

    for (const report of reports) {
      const cfg = ROADSTR_EVENT_TYPES[report.type];
      let marker = markersRef.current.get(report.id);
      if (!marker) {
        marker = L.circleMarker([report.lat, report.lon], {
          radius,
          fillColor: cfg.color,
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.85,
        }).addTo(map);

        const popup = L.popup({
          closeButton: false,
          className: theme === 'light' ? 'roadstr-popup-light' : 'roadstr-popup-dark',
          offset: [0, -6],
        }).setContent(`
          <div style="
            font-family: system-ui, sans-serif;
            font-size: 13px;
            color: ${popupText};
            min-width: 150px;
            background: ${popupBg};
            padding: 8px 12px;
            border-radius: 10px;
          ">
            <div style="font-weight: 700; margin-bottom: 2px;">${escapeHtml(cfg.label)}</div>
            <div style="font-size: 11px; color: ${popupSub};">
              ${escapeHtml(report.lat.toFixed(5))}, ${escapeHtml(report.lon.toFixed(5))}
            </div>
            <div style="font-size: 11px; color: ${popupSub}; margin-top: 4px;">
              ${escapeHtml(timeAgo(report.createdAt))}
            </div>
          </div>
        `);

        marker.bindPopup(popup);
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectReportRef.current?.(report.id);
        });
        markersRef.current.set(report.id, marker);
      } else {
        marker.setStyle({ radius, fillColor: cfg.color });
        const latLng = marker.getLatLng();
        if (latLng && (latLng.lat !== report.lat || latLng.lng !== report.lon)) {
          marker.setLatLng([report.lat, report.lon]);
        }
      }
    }

    if (userLocation) {
      let userMarker = markersRef.current.get('__user__');
      if (!userMarker) {
        userMarker = L.circleMarker([userLocation.lat, userLocation.lon], {
          radius: radius + 2,
          fillColor: '#3b82f6',
          color: '#2563eb',
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
      const userMarker = markersRef.current.get('__user__');
      if (userMarker) {
        map.removeLayer(userMarker);
        markersRef.current.delete('__user__');
      }
    }
  }, [reports, userLocation, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedReportId) return;
    const report = reports.find((r) => r.id === selectedReportId);
    if (!report) return;
    map.setView([report.lat, report.lon], 15, { animate: true, duration: 0.4 });
    const marker = markersRef.current.get(report.id);
    marker?.openPopup();
  }, [selectedReportId, reports]);

  const prevUserLocationRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;
    const prev = prevUserLocationRef.current;
    if (prev && prev.lat === userLocation.lat && prev.lon === userLocation.lon) return;
    prevUserLocationRef.current = userLocation;
    map.setView([userLocation.lat, userLocation.lon], 15, { animate: true, duration: 0.4 });
  }, [userLocation]);

  return (
    <>
      <style>{`
        /* OSM tiles are light, so a filter is needed in dark mode. We only use
           OSM as a fallback in dark mode; the primary dark provider is CartoDB
           dark matter, which needs no filter and avoids tile-layer flicker. */
        .roadstr-osm-dark {
          filter: brightness(0.7) contrast(1.1) saturate(0.75);
        }
        .roadstr-carto-dark {
          /* CartoDB dark matter is already dark; no filter keeps the tile layer
             free of the compositing flicker caused by CSS filters. */
        }
        /* Keep tile animations on the GPU to reduce residual flicker. */
        .leaflet-tile-pane {
          will-change: transform;
        }
        .leaflet-tile {
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .roadstr-popup-dark .leaflet-popup-content-wrapper {
          background: #0f172a !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
          padding: 0 !important;
        }
        .roadstr-popup-dark .leaflet-popup-tip {
          background: #0f172a !important;
        }
        .roadstr-popup-light .leaflet-popup-content-wrapper {
          background: #ffffff !important;
          border-radius: 10px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
          padding: 0 !important;
          border: 1px solid rgba(0,0,0,0.08);
        }
        .roadstr-popup-light .leaflet-popup-tip {
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
        <div ref={containerRef} className="w-full h-full" style={{ borderRadius: 0, overflow: 'hidden' }} />
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
