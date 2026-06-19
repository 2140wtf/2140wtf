import { useEffect, useState } from 'react';

export interface GeocodeResult {
  /** Display name for the result. */
  name: string;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lon: number;
}

interface PhotonFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

interface PhotonResponse {
  features: PhotonFeature[];
}

/**
 * Simple debounced geocoder backed by the public Photon API.
 * Photon is CORS-friendly and allows autocomplete-style queries, unlike
 * Nominatim's stricter usage policy.
 */
export function useGeocode(debounceMs = 350) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL('https://photon.komoot.io/api/');
        url.searchParams.set('q', query.trim());
        url.searchParams.set('limit', '5');

        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Geocoding failed: ${response.status} ${response.statusText}`);
        }
        const data = (await response.json()) as PhotonResponse;
        const mapped = data.features.map((feature) => ({
          name: formatPhotonName(feature.properties),
          lat: feature.geometry.coordinates[1],
          lon: feature.geometry.coordinates[0],
        }));
        setResults(mapped);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err : new Error('Geocoding failed'));
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, debounceMs]);

  return { query, setQuery, results, isLoading, error };
}

function formatPhotonName(props: PhotonFeature['properties']): string {
  const parts = [props.name, props.city, props.state, props.country].filter(Boolean);
  return parts.join(', ') || 'Unknown location';
}
