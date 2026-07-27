import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Podcast directory — iTunes Search API
// ---------------------------------------------------------------------------
// Nostr-native podcast kinds (30054/30055) have near-zero ecosystem adoption,
// which left the Podcasts page showing the same ~3 shows forever. The iTunes
// Search API needs no key and sends CORS headers, so the directory tab can
// list the full podcast catalog straight from the browser.

export interface PodcastEntry {
  id: number;
  title: string;
  author: string;
  artwork: string;
  feedUrl?: string;
  link?: string;
  genre?: string;
}

interface ITunesPodcastResult {
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  artworkUrl600?: string;
  feedUrl?: string;
  collectionViewUrl?: string;
  primaryGenreName?: string;
}

async function searchPodcasts(term: string, signal?: AbortSignal): Promise<PodcastEntry[]> {
  const url = `https://itunes.apple.com/search?media=podcast&limit=30&term=${encodeURIComponent(term)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Podcast search failed: ${res.status}`);
  }
  const json = (await res.json()) as { results?: ITunesPodcastResult[] };

  return (json.results ?? [])
    .filter((r) => r.collectionId && r.collectionName)
    .map((r) => ({
      id: r.collectionId!,
      title: r.collectionName!,
      author: r.artistName ?? 'Unknown',
      artwork: r.artworkUrl600 ?? r.artworkUrl100 ?? '',
      feedUrl: r.feedUrl,
      link: r.collectionViewUrl,
      genre: r.primaryGenreName,
    }));
}

/** Search the podcast directory for a term. Disabled for empty terms. */
export function usePodcastSearch(term: string) {
  const normalized = term.trim();
  return useQuery({
    queryKey: ['podcast-directory', normalized.toLowerCase()],
    queryFn: ({ signal }) => searchPodcasts(normalized, signal),
    enabled: normalized.length > 0,
    staleTime: 1000 * 60 * 10, // 10 minutes
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });
}
