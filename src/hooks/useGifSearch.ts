import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

const RESULTS_LIMIT = 30;

type GifProvider = 'giphy' | 'tenor';

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY ?? '';
const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY ?? '';
const GIF_PROVIDER = (import.meta.env.VITE_GIF_PROVIDER as GifProvider | undefined) ??
  (GIPHY_API_KEY ? 'giphy' : TENOR_API_KEY ? 'tenor' : undefined);

export interface GifResult {
  id: string;
  title: string;
  /** URL for the full-size GIF */
  url: string;
  /** URL for a smaller preview thumbnail */
  previewUrl: string;
  /** Width of the preview */
  width: number;
  /** Height of the preview */
  height: number;
}

// ─── Tenor (legacy) ───────────────────────────────────────────────────────────

interface TenorMediaFormat {
  url: string;
  dims: [number, number];
  duration: number;
  size: number;
}

interface TenorResult {
  id: string;
  title: string;
  media_formats: {
    gif?: TenorMediaFormat;
    tinygif?: TenorMediaFormat;
    nanogif?: TenorMediaFormat;
    mediumgif?: TenorMediaFormat;
    gifpreview?: TenorMediaFormat;
    tinygifpreview?: TenorMediaFormat;
  };
  content_description: string;
  created: number;
  url: string;
}

interface TenorResponse {
  results: TenorResult[];
  next: string;
}

function mapTenorResult(result: TenorResult): GifResult {
  const gif = result.media_formats.gif ?? result.media_formats.mediumgif;
  const preview = result.media_formats.tinygif ?? result.media_formats.nanogif;

  return {
    id: result.id,
    title: result.content_description || result.title,
    url: gif?.url ?? preview?.url ?? '',
    previewUrl: preview?.url ?? gif?.url ?? '',
    width: preview?.dims[0] ?? gif?.dims[0] ?? 220,
    height: preview?.dims[1] ?? gif?.dims[1] ?? 160,
  };
}

async function fetchTenorSearch(query: string, pos?: string): Promise<{ results: GifResult[]; next: string }> {
  if (!TENOR_API_KEY) {
    throw new Error('Tenor API key is not configured (VITE_TENOR_API_KEY)');
  }

  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    q: query,
    limit: String(RESULTS_LIMIT),
    media_filter: 'gif,tinygif',
    contentfilter: 'medium',
    client_key: '2140_nostr',
  });
  if (pos) params.set('pos', pos);

  const res = await fetch(`https://tenor.googleapis.com/v2/search?${params}`);
  if (!res.ok) throw new Error(`Tenor search failed: ${res.status}`);

  const data: TenorResponse = await res.json();
  return {
    results: data.results.map(mapTenorResult).filter((g) => g.url),
    next: data.next,
  };
}

async function fetchTenorTrending(pos?: string): Promise<{ results: GifResult[]; next: string }> {
  if (!TENOR_API_KEY) {
    throw new Error('Tenor API key is not configured (VITE_TENOR_API_KEY)');
  }

  const params = new URLSearchParams({
    key: TENOR_API_KEY,
    limit: String(RESULTS_LIMIT),
    media_filter: 'gif,tinygif',
    contentfilter: 'medium',
    client_key: '2140_nostr',
  });
  if (pos) params.set('pos', pos);

  const res = await fetch(`https://tenor.googleapis.com/v2/featured?${params}`);
  if (!res.ok) throw new Error(`Tenor featured failed: ${res.status}`);

  const data: TenorResponse = await res.json();
  return {
    results: data.results.map(mapTenorResult).filter((g) => g.url),
    next: data.next,
  };
}

// ─── GIPHY ────────────────────────────────────────────────────────────────────

interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

interface GiphyImages {
  fixed_width: GiphyImage;
  fixed_width_still?: GiphyImage;
  downsized?: GiphyImage;
  original?: GiphyImage;
}

interface GiphyResult {
  id: string;
  title: string;
  images: GiphyImages;
}

interface GiphyResponse {
  data: GiphyResult[];
  pagination: { total_count: number; count: number; offset: number };
}

function mapGiphyResult(result: GiphyResult): GifResult {
  const gif = result.images.fixed_width;
  const preview = result.images.fixed_width_still ?? result.images.downsized ?? gif;

  return {
    id: result.id,
    title: result.title || 'GIF',
    url: gif.url,
    previewUrl: preview.url,
    width: Number.parseInt(gif.width, 10) || 220,
    height: Number.parseInt(gif.height, 10) || 160,
  };
}

async function fetchGiphySearch(query: string, offset = 0): Promise<{ results: GifResult[]; next: string }> {
  if (!GIPHY_API_KEY) {
    throw new Error('GIPHY API key is not configured (VITE_GIPHY_API_KEY)');
  }

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    q: query,
    limit: String(RESULTS_LIMIT),
    offset: String(offset),
    rating: 'pg',
  });

  const res = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`);
  if (!res.ok) throw new Error(`GIPHY search failed: ${res.status}`);

  const data: GiphyResponse = await res.json();
  return {
    results: data.data.map(mapGiphyResult).filter((g) => g.url),
    next: String(data.pagination.offset + data.pagination.count),
  };
}

async function fetchGiphyTrending(offset = 0): Promise<{ results: GifResult[]; next: string }> {
  if (!GIPHY_API_KEY) {
    throw new Error('GIPHY API key is not configured (VITE_GIPHY_API_KEY)');
  }

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: String(RESULTS_LIMIT),
    offset: String(offset),
    rating: 'pg',
  });

  const res = await fetch(`https://api.giphy.com/v1/gifs/trending?${params}`);
  if (!res.ok) throw new Error(`GIPHY trending failed: ${res.status}`);

  const data: GiphyResponse = await res.json();
  return {
    results: data.data.map(mapGiphyResult).filter((g) => g.url),
    next: String(data.pagination.offset + data.pagination.count),
  };
}

// ─── Provider dispatch ────────────────────────────────────────────────────────

function getProvider(): { id: GifProvider; label: string; fetchSearch: (q: string) => Promise<{ results: GifResult[]; next: string }>; fetchTrending: () => Promise<{ results: GifResult[]; next: string }> } {
  switch (GIF_PROVIDER) {
    case 'giphy':
      return {
        id: 'giphy',
        label: 'GIPHY',
        fetchSearch: (q: string) => fetchGiphySearch(q),
        fetchTrending: () => fetchGiphyTrending(),
      };
    case 'tenor':
      return {
        id: 'tenor',
        label: 'Tenor',
        fetchSearch: (q: string) => fetchTenorSearch(q),
        fetchTrending: () => fetchTenorTrending(),
      };
    default:
      throw new Error('No GIF provider configured. Set VITE_GIPHY_API_KEY or VITE_TENOR_API_KEY in your environment.');
  }
}

export function useGifSearch() {
  const provider = useMemo(() => getProvider(), []);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
    }, 300);
  }, []);

  const clearQuery = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    clearTimeout(debounceRef.current);
  }, []);

  const isSearching = debouncedQuery.length > 0;

  const trendingQuery = useQuery({
    queryKey: ['gif-search', provider.id, 'trending'],
    queryFn: () => provider.fetchTrending(),
    staleTime: 5 * 60 * 1000,
    enabled: !isSearching,
  });

  const searchQuery = useQuery({
    queryKey: ['gif-search', provider.id, 'search', debouncedQuery],
    queryFn: () => provider.fetchSearch(debouncedQuery),
    staleTime: 2 * 60 * 1000,
    enabled: isSearching,
  });

  const activeQuery = isSearching ? searchQuery : trendingQuery;

  return {
    query,
    setQuery: handleQueryChange,
    clearQuery,
    results: activeQuery.data?.results ?? [],
    isLoading: activeQuery.isLoading,
    isError: activeQuery.isError,
    isSearching,
    providerLabel: provider.label,
    configError: !GIF_PROVIDER,
  };
}
