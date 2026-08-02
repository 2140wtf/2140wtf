import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { CashuMint } from '@cashu/cashu-ts';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useFollows } from '@/hooks/useFollows';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import {
  CASHU_MINT_ANNOUNCEMENT_KIND,
  CASHU_MINT_RECOMMENDATION_KIND,
  parseMintAnnouncement,
  parseMintRecommendation,
  groupRecommendationsByUrl,
  buildMintRecommendationEvent,
  type CashuMintAnnouncement,
  type CashuMintRecommendation,
  type MintRecommendationInput,
} from '@/lib/cashu/nip87';
import { createMintFetch } from '@/lib/cashu/cashuFetch';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';

export interface MintDiscoveryOptions {
  /** When true, search all relays without filtering by follows. Default false. */
  global?: boolean;
  /** Limit for each event kind. Default 5000 to match Cashu.me discovery. */
  limit?: number;
}

export interface SmartMintOption {
  /** Normalized mint URL. */
  url: string;
  /** Announcement, if one was found. */
  announcement: CashuMintAnnouncement | undefined;
  /** Recommendations for this URL. */
  recommendations: CashuMintRecommendation[];
  /** Whether the current user already has a balance at this mint. */
  hasBalance: boolean;
  /** Computed selection score (higher is better). */
  score: number;
}

const DEFAULT_LIMIT = 5000;

type NostrQuery = (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => Promise<NostrEvent[]>;

function useDiscoveryFilterAuthors(global?: boolean): { authors: string[] | undefined; isLoading: boolean } {
  const follows = useFollows();

  if (global) {
    return { authors: undefined, isLoading: false };
  }

  return {
    authors: follows.data,
    isLoading: follows.isLoading,
  };
}

function buildDiscoveryFilters(authors: string[] | undefined, limit: number): NostrFilter[] {
  const filters: NostrFilter[] = [
    { kinds: [CASHU_MINT_ANNOUNCEMENT_KIND], limit },
    { kinds: [CASHU_MINT_RECOMMENDATION_KIND], '#k': [String(CASHU_MINT_ANNOUNCEMENT_KIND)], limit },
  ];

  if (authors && authors.length > 0) {
    for (const f of filters) {
      f.authors = authors;
    }
  }

  return filters;
}

/**
 * Query NIP-87 Cashu mint announcements and recommendations.
 *
 * In follow-only mode (default) only recommendations/announcements from the
 * current user's follows are returned. Pass `{ global: true }` for unfiltered
 * discovery.
 */
export function useMintDiscovery(options: MintDiscoveryOptions = {}) {
  const { global, limit = DEFAULT_LIMIT } = options;
  const { nostr } = useNostr();
  const { authors, isLoading: authorsLoading } = useDiscoveryFilterAuthors(global);

  return useQuery({
    queryKey: ['cashu-mint-discovery', global ? 'global' : 'follows', authors],
    queryFn: async ({ signal }) => {
      const filters = buildDiscoveryFilters(authors, limit);
      const events = await (nostr.query as NostrQuery)(filters, { signal });

      const announcements: CashuMintAnnouncement[] = [];
      const recommendations: CashuMintRecommendation[] = [];
      const seenAnnouncements = new Set<string>();
      const seenRecommendations = new Set<string>();

      for (const event of events) {
        if (event.kind === CASHU_MINT_ANNOUNCEMENT_KIND) {
          if (seenAnnouncements.has(event.id)) continue;
          const parsed = parseMintAnnouncement(event);
          if (parsed) {
            seenAnnouncements.add(event.id);
            announcements.push(parsed);
          }
        } else if (event.kind === CASHU_MINT_RECOMMENDATION_KIND) {
          if (seenRecommendations.has(event.id)) continue;
          const parsed = parseMintRecommendation(event);
          if (parsed) {
            seenRecommendations.add(event.id);
            recommendations.push(parsed);
          }
        }
      }

      return { announcements, recommendations };
    },
    enabled: !authorsLoading,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch `/v1/info` for a Cashu mint URL.
 *
 * Uses the project's hardened `createMintFetch` so that only the requested
 * mint's origin is allowed in redirects.
 */
export function useMintInfo(url: string | undefined) {
  return useQuery({
    queryKey: ['cashu-mint-info', url],
    queryFn: async () => {
      if (!url) throw new Error('Mint URL is required');
      const allowedUrls = [url];
      const mint = new CashuMint(url, createMintFetch(allowedUrls) as ConstructorParameters<typeof CashuMint>[1]);
      return mint.getInfo();
    },
    enabled: !!url,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}

function supportsNut(announcement: CashuMintAnnouncement | undefined, nut: number): boolean {
  return announcement ? announcement.nuts.includes(nut) : false;
}

function averageRating(recommendations: CashuMintRecommendation[]): number | undefined {
  const ratings = recommendations.map((r) => r.rating).filter((r): r is number => r !== undefined);
  if (ratings.length === 0) return undefined;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

/**
 * Publish (or update) a kind 38000 Cashu mint recommendation/review.
 *
 * This is an addressable event identified by the user's pubkey + kind 38000 +
 * the mint's d-tag, so each user can have exactly one review per mint. The
 * previous version is fetched and passed as `prev` to preserve `published_at`.
 */
export function usePublishMintRecommendation() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync, isPending, error } = useNostrPublish();

  const publishReview = useCallback(
    async (input: MintRecommendationInput) => {
      if (!user) throw new Error('You must be logged in to publish a review');

      const template = buildMintRecommendationEvent(input);
      const prev = await fetchFreshEvent(nostr, {
        kinds: [CASHU_MINT_RECOMMENDATION_KIND],
        authors: [user.pubkey],
        '#d': [input.mintId.trim()],
      });

      return mutateAsync({
        ...template,
        prev: prev ?? undefined,
      });
    },
    [nostr, user, mutateAsync],
  );

  return {
    publishReview,
    isPending,
    error,
  };
}

/**
 * Rank discovered mints for the current user.
 *
 * Mints the user already holds balances in are boosted, followed by mints with
 * recommendations from follows and strong NUT support.
 */
export function useSmartMintSelection(
  discovery: { announcements: CashuMintAnnouncement[]; recommendations: CashuMintRecommendation[] } | undefined,
  userMintUrls: string[],
): SmartMintOption[] {
  return useMemo(() => {
    if (!discovery) return [];

    const userMintSet = new Set(userMintUrls.map((u) => u.toLowerCase()));
    const grouped = groupRecommendationsByUrl(discovery.recommendations);

    const urls = new Set<string>([
      ...discovery.announcements.map((a) => a.mintUrl),
      ...Object.keys(grouped),
      ...userMintUrls,
    ]);

    const urlToAnnouncement = new Map<string, CashuMintAnnouncement>();
    for (const a of discovery.announcements) {
      const existing = urlToAnnouncement.get(a.mintUrl);
      if (!existing || a.event.created_at > existing.event.created_at) {
        urlToAnnouncement.set(a.mintUrl, a);
      }
    }

    const options: SmartMintOption[] = [];

    for (const url of urls) {
      const announcement = urlToAnnouncement.get(url);
      const recommendations = grouped[url] ?? [];
      const hasBalance = userMintSet.has(url.toLowerCase());

      let score = 0;

      if (hasBalance) score += 5;
      if (announcement) {
        if (announcement.network === 'mainnet') score += 1;
        if (supportsNut(announcement, 4)) score += 1; // mint
        if (supportsNut(announcement, 5)) score += 1; // melt
        if (supportsNut(announcement, 7)) score += 0.5; // token state
        if (supportsNut(announcement, 17)) score += 0.5; // webhooks
      }
      const recCount = recommendations.length;
      if (recCount > 0) {
        score += Math.min(recCount, 5) * 0.5;
        const avg = averageRating(recommendations);
        if (avg !== undefined) {
          score += (avg / 5) * 1.5;
        }
      }

      options.push({ url, announcement, recommendations, hasBalance, score });
    }

    return options.sort((a, b) => b.score - a.score);
  }, [discovery, userMintUrls]);
}
