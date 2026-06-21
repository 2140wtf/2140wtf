/**
 * Topic tabs for the main feed.
 *
 * Modeled on bao.markets' global-chat topic bar. Each topic maps to a set of
 * lowercase `#t` tags that relays can index. The tabs are shown on the home
 * feed alongside Follows / Global / etc.
 */

export type FeedTopicId =
  | 'bitcoin'
  | 'nostr'
  | 'tech'
  | 'finance'
  | 'politics'
  | 'world'
  | 'sports'
  | 'bao'
  | 'trending';

export interface FeedTopic {
  id: FeedTopicId;
  label: string;
  /** Single emoji icon (kept lightweight; no icon library dependency). */
  icon: string;
  /** Optional image URL to use instead of an emoji icon. */
  iconSrc?: string;
  /** Optional hex pubkeys whose posts make up this topic feed. When present,
   *  the feed is filtered by authors instead of `#t` tags. */
  authors?: string[];
  /** `#t` values to filter on. All values are queried together (OR). */
  tags: string[];
}

export const FEED_TOPICS: FeedTopic[] = [
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    icon: '₿',
    tags: ['bitcoin', 'btc', 'lightning', 'mining', 'halving', 'satoshi', 'bitcoi'],
  },
  {
    id: 'nostr',
    label: 'Nostr',
    icon: '🟣',
    tags: ['nostr', 'nostrprotocol', 'nostrdev', 'nip', 'relays', 'npub'],
  },
  {
    id: 'tech',
    label: 'Tech / AI',
    icon: '🤖',
    tags: ['tech', 'technology', 'ai', 'llm', 'machinelearning', 'opensource', 'coding'],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: '📈',
    tags: ['finance', 'markets', 'macro', 'inflation', 'stocks', 'trading', 'economy'],
  },
  {
    id: 'politics',
    label: 'Politics',
    icon: '🗳️',
    tags: ['politics', 'election', 'geopolitics', 'government', 'policy'],
  },
  {
    id: 'world',
    label: 'World',
    icon: '🌍',
    tags: ['news', 'worldnews', 'world', 'international', 'geopolitics'],
  },
  {
    id: 'sports',
    label: 'Sports',
    icon: '🏆',
    tags: ['sports', 'soccer', 'football', 'nba', 'nfl', 'tennis', 'olympics'],
  },
  {
    id: 'bao',
    label: 'BAO',
    icon: '⚡',
    iconSrc: '/bao-icon.png',
    authors: ['606f05b0696f8d561a5470ead20d74b08ecd6243a6907acdc450a4849c9c0bc6'],
    tags: [],
  },
  {
    id: 'trending',
    label: 'Trending',
    icon: '🔥',
    tags: ['trending', 'viral', 'popular'],
  },
];

const TOPIC_BY_ID = new Map(FEED_TOPICS.map((t) => [t.id, t]));

export function isFeedTopicId(value: string): value is FeedTopicId {
  return TOPIC_BY_ID.has(value as FeedTopicId);
}

export function getFeedTopic(id: FeedTopicId | string): FeedTopic | undefined {
  return TOPIC_BY_ID.get(id as FeedTopicId);
}

/** Build a tag filter for useFeed from the active topic. */
export function getTopicTagFilter(topic: FeedTopic): Record<string, string[]> {
  return { '#t': topic.tags.map((t) => t.toLowerCase()) };
}
