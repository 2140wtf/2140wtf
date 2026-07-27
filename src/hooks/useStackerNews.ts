import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StackerNewsUser {
  name: string;
}

export interface StackerNewsItem {
  id: string;
  title: string | null;
  url: string | null;
  sats: number;
  ncomments: number;
  user: StackerNewsUser;
}

export interface StackerNewsItemsResponse {
  items: StackerNewsItem[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

/**
 * Same-origin proxy path — exists in vite dev/preview and on production hosts
 * with a rewrite rule. GitHub Pages (2140.wtf) has no server, so this 404s
 * there and we fall back to SN_PROXY_URL.
 */
const STACKER_NEWS_API = '/api/stacker-news';

/** Origin of the bao-sn-proxy Cloudflare Worker (CORS proxy for the Stacker
 * News GraphQL API — stacker.news sends no CORS headers of its own).
 * Override with VITE_SN_PROXY_URL (e.g. for a locally running wrangler dev). */
export const SN_PROXY_URL: string =
  (import.meta.env.VITE_SN_PROXY_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://bao-sn-proxy.hello-cbd.workers.dev';

const HOT_ITEMS_QUERY = `
  query GetHotItems($sort: String!, $limit: Limit!) {
    items(sort: $sort, limit: $limit) {
      items {
        id
        title
        url
        sats
        ncomments
        user {
          name
        }
      }
    }
  }
`;

const QUERY_BODY = JSON.stringify({
  query: HOT_ITEMS_QUERY,
  variables: { sort: 'hot', limit: 5 },
});

/** POST the hot-items query to one endpoint; throws on non-OK/invalid JSON. */
async function postQuery(endpoint: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: QUERY_BODY,
  });

  if (!res.ok) {
    throw new Error(`Stacker News request failed: ${res.status}`);
  }

  // A static host (GitHub Pages) answers unknown POST paths with an HTML 404
  // page — treat non-JSON bodies as a miss so the worker fallback kicks in.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Stacker News endpoint did not return JSON');
  }

  return res;
}

async function fetchHotItems(signal?: AbortSignal): Promise<StackerNewsItem[]> {
  // Same-origin proxy first (dev/preview, or a host with a rewrite rule)…
  let res: Response;
  try {
    res = await postQuery(STACKER_NEWS_API, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    // …then the CORS worker (what the deployed static site uses).
    res = await postQuery(SN_PROXY_URL, signal);
  }

  const json = (await res.json()) as {
    data?: { items?: { items?: StackerNewsItem[] } };
    errors?: { message: string }[];
  };

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message);
  }

  const items = json.data?.items?.items;
  if (!items) {
    throw new Error('Stacker News returned an empty feed');
  }

  return items;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches the current "hot" items from Stacker News.
 */
export function useStackerNews() {
  return useQuery({
    queryKey: ['stacker-news', 'hot'],
    queryFn: ({ signal }) => fetchHotItems(signal),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    retry: 2,
  });
}
