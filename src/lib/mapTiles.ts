/**
 * Shared basemap tiles for the Leaflet maps (BTC Map, Events, Roadstr).
 *
 * Why the app no longer hits `*.tile.openstreetmap.org`:
 *
 * OSM's tile servers are volunteer-run and enforce a strict tile usage policy.
 * A client that trips it gets an HTTP 403 whose *body is an "Access blocked"
 * error image*. Browsers paint that image like any other tile, and Leaflet
 * never emits `tileerror` for it — the response is a perfectly decodable PNG —
 * so the map fills with 403 tiles and the per-map fallback cannot rescue it.
 * Worse, the old BTC Map fallback pointed back at the same OSM URL, so light
 * mode had no second chance at all (the /btcmap "403 Access blocked" wall).
 *
 * Everything therefore uses Esri's keyless ArcGIS Online basemaps:
 *   - `World_Street_Map` — street detail (good past z18), used by both themes.
 *     Dark mode is a CSS treatment on the tile images (`.basemap-tiles-dark`
 *     in `index.css`), which keeps one provider at every zoom level.
 *   - `World_Topo_Map` — fallback if the street service errors.
 *   - `World_Imagery` — satellite view (Roadstr's satellite style).
 *
 * No API key, no per-app registration, and attribution is included (Esri and
 * the OSM contributors it derives from require it — do not disable it).
 */

export type BasemapTheme = 'light' | 'dark';
export type BasemapKind = 'street' | 'satellite';

export interface BasemapTiles {
  /** Leaflet tile URL template. */
  url: string;
  /** Second no-key provider, applied once if the primary tiles error. */
  fallbackUrl: string;
  /** HTML attribution for the tile layer. */
  attribution: string;
  /** Class on every tile <img>; carries the per-theme treatment. */
  className: string;
  /** Deepest zoom the map UI may reach. */
  maxZoom: number;
}

const ESRI_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services';

const STREET_URL = `${ESRI_BASE}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;
const TOPO_URL = `${ESRI_BASE}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`;
const IMAGERY_URL = `${ESRI_BASE}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;

export const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/" rel="noopener noreferrer">Esri</a> ' +
  '&mdash; Esri, HERE, Garmin, &copy; ' +
  '<a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export function getBasemapTiles(
  theme: BasemapTheme,
  kind: BasemapKind = 'street',
): BasemapTiles {
  if (kind === 'satellite') {
    return {
      url: IMAGERY_URL,
      fallbackUrl: STREET_URL,
      attribution: ESRI_ATTRIBUTION,
      className: 'basemap-tiles',
      maxZoom: 19,
    };
  }

  return {
    url: STREET_URL,
    fallbackUrl: TOPO_URL,
    attribution: ESRI_ATTRIBUTION,
    className: theme === 'dark' ? 'basemap-tiles basemap-tiles-dark' : 'basemap-tiles',
    maxZoom: 19,
  };
}
