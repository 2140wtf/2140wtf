import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { THEME_KIND } from '@/lib/themeTypes';

/** Validate a theme event. Returns the event if valid, null otherwise. */
function validateTheme(event: NostrEvent): NostrEvent | null {
  if (event.kind !== THEME_KIND) return null;
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const title = event.tags.find(([name]) => name === 'title')?.[1];
  if (!dTag || !title) return null;
  return event;
}

/** Fetch a page of themes for stationery infinite scroll */
export function useThemesPage(limit = 24, until?: number, authors?: string[]) {
  const { nostr } = useNostr();
  return useQuery({
    queryKey: ['themes-page', limit, until, authors ?? null],
    queryFn: async () => {
      const filter = {
        kinds: [THEME_KIND],
        limit,
        ...(until ? { until } : {}),
        ...(authors && authors.length > 0 ? { authors } : {}),
      };
      const events = await nostr.query([filter]);
      return events
        .filter((e): e is NostrEvent => validateTheme(e) !== null)
        .sort((a, b) => b.created_at - a.created_at);
    },
  });
}
