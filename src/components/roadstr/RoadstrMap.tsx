import { useEffect, useRef, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Globe } from 'lucide-react';

import type { RoadstrConfirmation, RoadstrReport } from '@/lib/roadstr';
import { ROADSTR_EVENT_TYPES, type MapStyle } from '@/components/roadstr/roadstrTypes';
import { RoadstrPopupContent } from '@/components/roadstr/RoadstrPopupContent';

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

type EffectiveMapStyle = 'light' | 'dark' | 'satellite';

interface RoadstrMapProps {
  reports: RoadstrReport[];
  confirmations?: RoadstrConfirmation[];
  selectedReportId?: string | null;
  onSelectReport?: (id: string) => void;
  onMapClick?: () => void;
  userLocation?: { lat: number; lon: number; accuracy?: number } | null;
  onBoundsChange?: (bounds: BBox) => void;
  theme?: 'dark' | 'light';
  mapStyle?: MapStyle;
  searchTarget?: { lat: number; lon: number; zoom?: number } | null;
  onConfirmReport?: (reportId: string, status: 'still_there' | 'no_longer_there') => void;
}

function getRadius(zoom: number): number {
  if (zoom <= 5) return 6;
  if (zoom <= 9) return 8;
  if (zoom <= 13) return 10;
  return 12;
}

function getEffectiveMapStyle(mapStyle: MapStyle, theme: 'dark' | 'light'): EffectiveMapStyle {
  if (mapStyle !== 'auto') return mapStyle;
  return theme;
}

interface TileConfig {
  url: string;
  className: string;
  fallbackUrl: string;
  fallbackClassName: string;
  attribution: string;
}

function getTileConfig(style: EffectiveMapStyle): TileConfig {
  const osmAttribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  switch (style) {
    case 'dark':
      return {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        className: 'roadstr-carto-dark',
        fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        fallbackClassName: 'roadstr-osm-dark',
        attribution: `&copy; <a href="https://carto.com/attributions">CartoDB</a>, ${osmAttribution}`,
      };
    case 'satellite':
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        className: 'roadstr-satellite',
        fallbackUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        fallbackClassName: 'roadstr-osm-light',
        attribution:
          '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      };
    case 'light':
    default:
      return {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        className: 'roadstr-osm-light',
        fallbackUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        fallbackClassName: 'roadstr-carto-light',
        attribution: osmAttribution,
      };
  }
}

function getClusterIcon(count: number, theme: 'dark' | 'light'): L.DivIcon {
  const size = count < 10 ? 24 : count < 100 ? 30 : 36;
  const bg = theme === 'dark' ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)';
  const color = theme === 'dark' ? '#e5e7eb' : '#111827';
  const border = theme === 'dark' ? 'rgba(148, 163, 184, 0.4)' : 'rgba(0, 0, 0, 0.15)';
  return L.divIcon({
    className: 'roadstr-cluster',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};color:${color};border:1px solid ${border};
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.25);
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function getReportIcon(type: string, radius: number, theme: 'dark' | 'light'): L.DivIcon {
  const size = radius * 2;
  const cfg = ROADSTR_EVENT_TYPES[type as keyof typeof ROADSTR_EVENT_TYPES];
  const color = cfg?.color ?? '#9E9E9E';
  const border = theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)';
  return L.divIcon({
    className: 'roadstr-marker',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:2px solid ${border};
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function RoadstrMap({
  reports,
  confirmations = [],
  selectedReportId,
  onSelectReport,
  onMapClick,
  userLocation,
  onBoundsChange,
  theme = 'dark',
  mapStyle = 'auto',
  searchTarget,
  onConfirmReport,
}: RoadstrMapProps): React.JSX.Element {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tileConfigRef = useRef<TileConfig | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const reportMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const popupRootsRef = useRef<Map<string, { element: HTMLDivElement; root: Root }>>(new Map());
  const userMarkerRef = useRef<{ dot: L.Marker; accuracy: L.Circle } | null>(null);

  const onSelectReportRef = useRef(onSelectReport);
  const onMapClickRef = useRef(onMapClick);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onConfirmReportRef = useRef(onConfirmReport);
  const reportsRef = useRef(reports);
  const confirmationsRef = useRef(confirmations);

  useEffect(() => { reportsRef.current = reports; }, [reports]);
  useEffect(() => { confirmationsRef.current = confirmations; }, [confirmations]);
  useEffect(() => { onSelectReportRef.current = onSelectReport; }, [onSelectReport]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);
  useEffect(() => { onConfirmReportRef.current = onConfirmReport; }, [onConfirmReport]);

  const effectiveStyle = getEffectiveMapStyle(mapStyle, theme);

  const renderPopup = useCallback(
    (report: RoadstrReport, marker: L.Marker) => {
      let entry = popupRootsRef.current.get(report.id);
      if (!entry) {
        const element = document.createElement('div');
        entry = { element, root: createRoot(element) };
        popupRootsRef.current.set(report.id, entry);
      }
      const stillThere = confirmationsRef.current.filter(
        (c) => c.reportId === report.id && c.status === 'still_there',
      ).length;
      const noLongerThere = confirmationsRef.current.filter(
        (c) => c.reportId === report.id && c.status === 'no_longer_there',
      ).length;
      entry.root.render(
        <RoadstrPopupContent
          report={report}
          stillThere={stillThere}
          noLongerThere={noLongerThere}
          onConfirm={(status) => {
            onConfirmReportRef.current?.(report.id, status);
            marker.closePopup();
          }}
          onViewDetails={() => {
            onSelectReportRef.current?.(report.id);
            marker.closePopup();
          }}
        />,
      );
      return entry.element;
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: false,
    });

    const tileConfig = getTileConfig(effectiveStyle);
    tileConfigRef.current = tileConfig;
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: 19,
      subdomains: 'abc',
      className: tileConfig.className,
      attribution: tileConfig.attribution,
      crossOrigin: true,
    }).addTo(map);

    L.control.attribution({ position: 'bottomleft' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    let fallbackTriggered = false;
    const tileErrorHandler = () => {
      const current = tileConfigRef.current;
      const layer = tileLayerRef.current;
      if (!fallbackTriggered && layer && current) {
        fallbackTriggered = true;
        layer.setUrl(current.fallbackUrl);
        layer.options.className = current.fallbackClassName;
        layer.redraw();
      }
    };
    tileLayer.on('tileerror', tileErrorHandler);
    tileLayerRef.current = tileLayer;

    const clusterGroup = L.markerClusterGroup({
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 60,
      iconCreateFunction: (cluster) => getClusterIcon(cluster.getChildCount(), theme),
    }).addTo(map);
    clusterGroupRef.current = clusterGroup;

    const resizeTimer = setTimeout(() => map.invalidateSize(), 100);

    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    const resizeObs = new ResizeObserver(() => {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => map.invalidateSize(), 100);
    });
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

    const updateIcons = () => {
      const z = map.getZoom();
      const r = getRadius(z);
      reportMarkersRef.current.forEach((marker, key) => {
        const report = reportsRef.current.find((rpt) => rpt.id === key);
        if (report) {
          marker.setIcon(getReportIcon(report.type, r, theme));
        }
      });
      if (userMarkerRef.current) {
        userMarkerRef.current.dot.setIcon(getUserIcon(r + 2));
      }
    };
    map.on('zoomend', updateIcons);

    mapRef.current = map;

    const popupRoots = popupRootsRef.current;
    const reportMarkers = reportMarkersRef.current;

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      if (initialTimeout) clearTimeout(initialTimeout);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeObs.disconnect();
      if (reportBoundsHandler) map.off('moveend zoomend', reportBoundsHandler);
      map.off('zoomend', updateIcons);
      if (onMapClickRef.current) map.off('click', clickHandler);
      tileLayer.off('tileerror', tileErrorHandler);
      popupRoots.forEach(({ root }) => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      popupRoots.clear();
      reportMarkers.clear();
      try { map.stop(); } catch { /* ignore */ }
      mapRef.current = null;
      try { map.remove(); } catch { /* ignore */ }
    };
  }, [effectiveStyle, theme]);

  // Keep the tile config ref in sync when the effective style changes without
  // a full re-mount (the init effect already set it up for the initial style).
  useEffect(() => {
    tileConfigRef.current = getTileConfig(effectiveStyle);
  }, [effectiveStyle]);

  useEffect(() => {
    const map = mapRef.current;
    const tileLayer = tileLayerRef.current;
    const clusterGroup = clusterGroupRef.current;
    if (!map || !tileLayer || !clusterGroup) return;

    const zoom = map.getZoom();
    const radius = getRadius(zoom);

    // Remove markers for reports that are no longer present.
    reportMarkersRef.current.forEach((marker, key) => {
      if (!reports.find((r) => r.id === key)) {
        const popup = popupRootsRef.current.get(key);
        if (popup) {
          try { popup.root.unmount(); } catch { /* ignore */ }
          popupRootsRef.current.delete(key);
        }
        clusterGroup.removeLayer(marker);
        reportMarkersRef.current.delete(key);
      }
    });

    for (const report of reports) {
      let marker = reportMarkersRef.current.get(report.id);
      if (!marker) {
        marker = L.marker([report.lat, report.lon], {
          icon: getReportIcon(report.type, radius, theme),
        });

        const popup = L.popup({
          closeButton: false,
          className: theme === 'light' ? 'roadstr-popup-light' : 'roadstr-popup-dark',
          offset: [0, -6],
        }).setContent(renderPopup(report, marker));
        marker.bindPopup(popup);
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onSelectReportRef.current?.(report.id);
        });

        clusterGroup.addLayer(marker);
        reportMarkersRef.current.set(report.id, marker);
      } else {
        marker.setIcon(getReportIcon(report.type, radius, theme));
        const latLng = marker.getLatLng();
        if (latLng && (latLng.lat !== report.lat || latLng.lng !== report.lon)) {
          marker.setLatLng([report.lat, report.lon]);
        }
        // Update popup content with latest confirmation counts.
        const popup = marker.getPopup();
        if (popup) {
          popup.setContent(renderPopup(report, marker));
        }
      }
    }
  }, [reports, confirmations, theme, renderPopup]);

  useEffect(() => {
    const map = mapRef.current;
    const clusterGroup = clusterGroupRef.current;
    if (!map || !clusterGroup) return;

    if (userLocation) {
      const radius = getRadius(map.getZoom()) + 2;
      if (!userMarkerRef.current) {
        const dot = L.marker([userLocation.lat, userLocation.lon], {
          icon: getUserIcon(radius),
          zIndexOffset: 1000,
        }).addTo(map);
        const accuracy = L.circle([userLocation.lat, userLocation.lon], {
          radius: userLocation.accuracy ?? 100,
          fillColor: '#3b82f6',
          color: '#2563eb',
          weight: 1,
          opacity: 0.4,
          fillOpacity: 0.15,
        }).addTo(map);
        userMarkerRef.current = { dot, accuracy };
      } else {
        userMarkerRef.current.dot.setLatLng([userLocation.lat, userLocation.lon]);
        userMarkerRef.current.accuracy.setLatLng([userLocation.lat, userLocation.lon]);
        userMarkerRef.current.accuracy.setRadius(userLocation.accuracy ?? 100);
        userMarkerRef.current.dot.setIcon(getUserIcon(radius));
      }
    } else {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current.dot);
        map.removeLayer(userMarkerRef.current.accuracy);
        userMarkerRef.current = null;
      }
    }
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedReportId) return;
    const report = reports.find((r) => r.id === selectedReportId);
    if (!report) return;
    map.setView([report.lat, report.lon], 15, { animate: true, duration: 0.4 });
    const marker = reportMarkersRef.current.get(report.id);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !searchTarget) return;
    map.setView(
      [searchTarget.lat, searchTarget.lon],
      searchTarget.zoom ?? 13,
      { animate: true, duration: 0.5 },
    );
  }, [searchTarget]);

  const handleReset = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([20, 0], 2, { animate: true, duration: 0.6 });
  }, []);

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
        .roadstr-satellite img {
          /* Satellite imagery already has strong contrast; keep it unfiltered. */
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
          padding: 0 !important;
        }
        .roadstr-marker {
          background: transparent !important;
        }
        .roadstr-user-marker {
          background: transparent !important;
        }
        .roadstr-user-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #3b82f6;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
          animation: roadstr-pulse 1.5s infinite;
        }
        @keyframes roadstr-pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
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

function getUserIcon(radius: number): L.DivIcon {
  const size = Math.max(20, radius * 2);
  return L.divIcon({
    className: 'roadstr-user-marker',
    html: '<div class="roadstr-user-dot"></div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
