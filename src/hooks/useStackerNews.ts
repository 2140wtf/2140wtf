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

const STACKER_NEWS_API = '/api/stacker-news';

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

async function fetchHotItems(signal?: AbortSignal): Promise<StackerNewsItem[]> {
  const res = await fetch(STACKER_NEWS_API, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: HOT_ITEMS_QUERY,
      variables: { sort: 'hot', limit: 5 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Stacker News request failed: ${res.status}`);
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
