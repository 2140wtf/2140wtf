import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';

import { decodeGeohashCenter } from '@/lib/geohash';
import { formatCalendarEventWhen, type CalendarEvent } from '@/lib/nip29';

interface EventsMapProps {
  events: CalendarEvent[];
  /** Map height class; defaults to a tall panel. */
  className?: string;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * Leaflet map of NIP-52 events pinned with a `g` geohash tag (what plektos
 * writes). One marker per located event; the popup links to the event's
 * detail page. Events without a geohash are listed nowhere here — the list
 * view remains the complete index.
 */
export function EventsMap({ events, className }: EventsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [25, 0],
      zoom: 2,
      attributionControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Rebuild markers when the event set changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const bounds: L.LatLngTuple[] = [];
    for (const event of events) {
      if (!event.geohash) continue;
      const center = decodeGeohashCenter(event.geohash);
      if (!center) continue;
      const latlng: [number, number] = [center.lat, center.lon];
      bounds.push(latlng);

      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.event.pubkey,
        identifier: event.identifier,
      });
      const marker = L.marker(latlng);
      const popupEl = document.createElement('div');
      popupEl.className = 'space-y-1';
      popupEl.innerHTML = `
        <div style="font-weight:600;line-height:1.3">${escapeHtml(event.title)}</div>
        <div style="font-size:12px;opacity:0.75">${escapeHtml(formatCalendarEventWhen(event))}</div>
        ${event.location ? `<div style="font-size:12px;opacity:0.75">📍 ${escapeHtml(event.location)}</div>` : ''}
      `;
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = 'View event →';
      link.style.cssText = 'font-size:12px;font-weight:600;color:var(--primary,#f7931a);cursor:pointer;background:none;border:none;padding:4px 0 0';
      link.addEventListener('click', () => navigateRef.current(`/${naddr}`));
      popupEl.appendChild(link);
      marker.bindPopup(popupEl);
      marker.addTo(layer);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 12 });
    }

    // Leaflet needs a size recheck when the container was hidden/resized.
    setTimeout(() => map.invalidateSize(), 50);
  }, [events]);

  return (
    <div
      ref={containerRef}
      className={className ?? 'h-[60vh] min-h-80 w-full rounded-lg overflow-hidden border'}
    />
  );
}
