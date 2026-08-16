import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useAppContext } from '@/hooks/useAppContext';
import { templateUrl } from '@/lib/faviconUrl';
import { sanitizeUrl } from '@/lib/sanitizeUrl';

/** Zod schema for OEmbed responses from the link preview endpoint. */
const OEmbedSchema = z.object({
  type: z.enum(['link', 'photo', 'video', 'rich']),
  version: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  author_name: z.string().optional(),
  author_url: z.url().optional(),
  provider_name: z.string().optional(),
  provider_url: z.url().optional(),
  thumbnail_url: z.url().optional().transform(sanitizeUrl),
  thumbnail_width: z.number().optional(),
  thumbnail_height: z.number().optional(),
  url: z.url().optional(),
  html: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

/** OEmbed response from the link preview endpoint. */
export type OEmbedData = z.infer<typeof OEmbedSchema>;

/**
 * Try to fetch OEmbed data directly from a known provider's native endpoint.
 * Returns null if the URL doesn't match a known provider or the fetch fails.
 *
 * Known providers:
 * - YouTube (youtube.com, youtu.be)
 * - Spotify (open.spotify.com)
 * - Reddit (reddit.com)
 * - Archive.org (archive.org) — uses the metadata API, transformed to OEmbed shape
 */
async function tryNativeOEmbed(url: string, signal?: AbortSignal): Promise<OEmbedData | null> {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');

    // YouTube
    if (host === 'youtube.com' || host === 'youtu.be') {
      return await tryFetchOEmbed(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        signal,
      );
    }

    // Spotify
    if (host === 'open.spotify.com') {
      return await tryFetchOEmbed(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
        signal,
      );
    }

    // Reddit
    if (host === 'reddit.com' || host === 'old.reddit.com' || host === 'new.reddit.com') {
      return await tryFetchOEmbed(
        `https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`,
        signal,
      );
    }

    // Archive.org — no OEmbed, but the metadata API has title/creator.
    if (host === 'archive.org') {
      const match = u.pathname.match(/^\/(details|embed)\/([^/?#]+)/);
      if (match) {
        return await fetchArchiveOrgPreview(match[2], signal);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Fetch archive.org metadata and transform it into OEmbed-compatible shape. */
async function fetchArchiveOrgPreview(identifier: string, signal?: AbortSignal): Promise<OEmbedData | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`, { signal });
    if (!res.ok) return null;

    const json: {
      metadata?: { title?: string; creator?: string; description?: string; mediatype?: string };
    } = await res.json();

    const meta = json.metadata;
    if (!meta) return null;

    return {
      type: 'link',
      title: meta.title || undefined,
      author_name: meta.creator || undefined,
      provider_name: 'Internet Archive',
      thumbnail_url: `https://archive.org/services/img/${identifier}`,
    };
  } catch {
    return null;
  }
}

/** Try to parse an OEmbed response from a standard endpoint, returning null on failure. */
async function tryFetchOEmbed(endpoint: string, signal?: AbortSignal): Promise<OEmbedData | null> {
  try {
    const response = await fetch(endpoint, {
      signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    const parsed = OEmbedSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a generic link preview from the Microlink API (client-side, CORS-enabled),
 * normalized into OEmbed shape.
 *
 * Works for any URL without an API key — returns title, description, publisher,
 * and an OG thumbnail when the page has one. This is the built-in fallback that
 * powers link cards for sites without a native oEmbed endpoint (GitHub, blogs,
 * news sites, …). Returns null on failure so cards degrade to a bare domain row.
 */
async function fetchMicrolinkPreview(url: string, signal?: AbortSignal): Promise<OEmbedData | null> {
  try {
    const endpoint = new URL('https://api.microlink.io/');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('video', 'false');
    endpoint.searchParams.set('audio', 'false');
    endpoint.searchParams.set('pdf', 'false');

    const response = await fetch(endpoint.toString(), {
      signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;

    const json = (await response.json()) as {
      status?: string;
      data?: Record<string, unknown>;
    };
    if (json.status !== 'success' || !json.data || typeof json.data !== 'object') return null;

    const { data } = json;
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
    const description =
      typeof data.description === 'string' && data.description.trim() ? data.description.trim() : undefined;
    const publisher =
      typeof data.publisher === 'string' && data.publisher.trim() ? data.publisher.trim() : undefined;

    const image = data.image as { url?: unknown } | undefined;
    const logo = data.logo as { url?: unknown } | undefined;
    const imageUrl =
      typeof image?.url === 'string' ? image.url : typeof logo?.url === 'string' ? logo.url : undefined;

    return {
      type: 'link',
      // Fall back to a clipped description when the page has no og:title.
      title: title ?? description?.slice(0, 120),
      description,
      provider_name: publisher,
      thumbnail_url: imageUrl ? (sanitizeUrl(imageUrl) ?? undefined) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch OEmbed data for a URL.
 * For known providers (YouTube, Spotify, Reddit, Archive.org), queries their
 * native endpoints directly. For all other URLs, uses the configured link preview
 * proxy if one is set, then falls back to the built-in Microlink lookup so every
 * link card gets a title/description/thumbnail.
 */
async function fetchLinkPreview(
  url: string,
  linkPreviewTemplate: string,
  signal?: AbortSignal,
): Promise<OEmbedData | null> {
  // Try native OEmbed endpoint first for known providers.
  const native = await tryNativeOEmbed(url, signal);
  if (native) return native;

  // Fall back to the configured link preview proxy, if any.
  if (linkPreviewTemplate) {
    const endpoint = templateUrl({ template: linkPreviewTemplate, url });
    const proxied = await tryFetchOEmbed(endpoint, signal);
    if (proxied) return proxied;
  }

  // Last resort: built-in generic preview (no config required).
  return fetchMicrolinkPreview(url, signal);
}

/** Hook to fetch OEmbed link preview data for a URL. */
export function useLinkPreview(url: string | null) {
  const { config } = useAppContext();
  return useQuery({
    queryKey: ['link-preview', url, config.linkPreviewUrl],
    queryFn: ({ signal }) => fetchLinkPreview(url!, config.linkPreviewUrl, signal),
    enabled: !!url,
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    retry: false,
  });
}
