/**
 * Topic tabs for the main feed.
 *
 * Modeled on bao.markets' global-chat topic bar. Each topic maps to a set of
 * lowercase `#t` tags that relays can index. The tabs are shown on the home
 * feed alongside Follows / Global / etc.
 */

import {
  BITCOIN_TOPIC_AUTHORS,
  NOSTR_TOPIC_AUTHORS,
  FINANCE_TOPIC_AUTHORS,
  TECH_TOPIC_AUTHORS,
  WORLD_TOPIC_AUTHORS,
  POLITICS_TOPIC_AUTHORS,
  SPORTS_TOPIC_AUTHORS,
} from './feedTopicAuthors';

export type FeedTopicId =
  | 'bitcoin'
  | 'nostr'
  | 'tech'
  | 'finance'
  | 'politics'
  | 'world'
  | 'sports'
  | 'bao'
  | 'trending'
  | 'popular-follows'
  | 'follows-replies'
  | 'trending-24h'
  | 'trending-7d'
  | 'bitcoin-reads'
  | 'podcasts-reads'
  | 'art-reads';

export interface FeedTopic {
  id: FeedTopicId;
  label: string;
  /** Human-readable description shown in curation menus. */
  description?: string;
  /** Single emoji icon (kept lightweight; no icon library dependency). */
  icon: string;
  /** Optional image URL to use instead of an emoji icon. */
  iconSrc?: string;
  /** Optional hex pubkeys whose posts make up this topic feed. When present,
   *  the feed is filtered by authors instead of `#t` tags. */
  authors?: string[];
  /** `#t` values to filter on. All values are queried together (OR). */
  tags: string[];
  /** Override the event kinds for this topic (e.g. long-form reads). */
  kinds?: number[];
  /** NIP-50 search string (e.g. `sort:hot`). */
  search?: string;
  /** Only return notes from the past N hours. */
  sinceHours?: number;
}

export const FEED_TOPICS: FeedTopic[] = [
  {
    id: 'bitcoin',
    label: 'Bitcoin',
    description: 'Bitcoin, Lightning, mining, and on-chain news',
    icon: '₿',
    authors: BITCOIN_TOPIC_AUTHORS,
    tags: ['bitcoin', 'btc', 'sats', 'satoshi', 'lightning', 'ln', 'mining', 'hashrate',
      'difficulty', 'halving', 'mempool', 'onchain', 'segwit', 'taproot', 'ordinals',
      'inscriptions', 'runes', 'layer2', 'l2', 'sidechain', 'coldcard', 'hardwarewallet',
      'hodl', 'bitcoindev', 'bitcoinnews', 'bitcoineconomics', 'macro', 'etf', 'blackrock',
      'fidelity', 'microstrategy', 'saylor', 'fedimint', 'cashu', 'ecash', 'ark', 'vtxo',
      'rgb', 'dlc', 'bitvm', 'stratum', 'asic', 'miner', 'foundry', 'mara', 'riots'],
  },
  {
    id: 'nostr',
    label: 'Nostr',
    description: 'Nostr protocol, clients, zaps, and development',
    icon: '🟣',
    authors: NOSTR_TOPIC_AUTHORS,
    tags: ['nostr', 'nostrprotocol', 'nostrdev', 'nip', 'relay', 'relays', 'zap', 'npub',
      'primal', 'damus', 'amethyst', 'coracle', 'snort', 'nostrudel', 'njump', 'ndk',
      'nwc', 'lnurl'],
  },
  {
    id: 'tech',
    label: 'Tech / AI',
    description: 'Technology, AI, coding, privacy, and cybersecurity',
    icon: '🤖',
    authors: TECH_TOPIC_AUTHORS,
    tags: ['tech', 'technology', 'ai', 'llm', 'machinelearning', 'deeplearning', 'opensource',
      'coding', 'programming', 'developer', 'privacy', 'infosec', 'cybersecurity',
      'openai', 'anthropic', 'gpt', 'claude', 'gemini', 'llama', 'hardware', 'robotics',
      'quantum', 'semiconductor'],
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Markets, macro, stocks, and central-bank policy',
    icon: '📈',
    authors: FINANCE_TOPIC_AUTHORS,
    tags: ['finance', 'markets', 'macro', 'inflation', 'stocks', 'trading', 'economy',
      'bonds', 'yield', 'treasury', 'wallstreet', 'nasdaq', 'sp500', 'dow', 'cpi', 'gdp',
      'recession', 'liquidity', 'sovereigndebt', 'fed', 'federalreserve', 'fomc', 'rates'],
  },
  {
    id: 'politics',
    label: 'Politics',
    description: 'Elections, policy, regulation, and government',
    icon: '🗳️',
    authors: POLITICS_TOPIC_AUTHORS,
    tags: ['politics', 'election', 'geopolitics', 'government', 'policy', 'regulation',
      'legislation', 'sanctions', 'democracy', 'senate', 'parliament', 'vote', 'referendum',
      'campaign', 'diplomat', 'tariff', 'executiveorder', 'supremecourt', 'immigration'],
  },
  {
    id: 'world',
    label: 'World',
    description: 'International news, conflicts, diplomacy, and climate',
    icon: '🌍',
    authors: WORLD_TOPIC_AUTHORS,
    tags: ['news', 'worldnews', 'world', 'international', 'geopolitics', 'breaking',
      'diplomacy', 'nato', 'un', 'conflict', 'crisis', 'war', 'peace', 'summit', 'treaty',
      'refugee', 'humanitarian', 'climate', 'journalist', 'ukraine', 'gaza'],
  },
  {
    id: 'sports',
    label: 'Sports',
    description: 'Soccer, basketball, football, MMA, and more',
    icon: '🏆',
    authors: SPORTS_TOPIC_AUTHORS,
    tags: ['sports', 'soccer', 'football', 'nba', 'nfl', 'tennis', 'olympics',
      'mma', 'ufc', 'baseball', 'mlb', 'nhl', 'hockey', 'boxing', 'esports', 'cricket',
      'rugby', 'golf', 'pga', 'nascar', 'racing', 'motorsport', 'worldcup',
      'premierleague', 'laliga', 'championsleague'],
  },
  {
    id: 'bao',
    label: 'BAO',
    description: 'Posts from the BAO network',
    icon: '⚡',
    iconSrc: '/bao-icon.png',
    authors: ['606f05b0696f8d561a5470ead20d74b08ecd6243a6907acdc450a4849c9c0bc6'],
    tags: [],
  },
  {
    id: 'trending',
    label: 'Trending',
    description: 'Notes tagged trending, viral, or popular',
    icon: '🔥',
    tags: ['trending', 'viral', 'popular'],
  },

  // Curated feed options inspired by Primal's home-feed menu.
  {
    id: 'popular-follows',
    label: 'Popular from follows',
    description: 'Notes currently popular from people you follow',
    icon: '⭐',
    tags: [],
    search: 'sort:hot protocol:nostr',
  },
  {
    id: 'follows-replies',
    label: 'Latest with Replies',
    description: 'Latest notes and replies by your follows',
    icon: '💬',
    tags: [],
  },
  {
    id: 'trending-24h',
    label: 'Trending 24h',
    description: 'Global trending notes in the past 24 hours',
    icon: '🔥',
    tags: [],
    search: 'sort:hot protocol:nostr',
    sinceHours: 24,
  },
  {
    id: 'trending-7d',
    label: 'Trending 7d',
    description: 'Global trending notes in the past 7 days',
    icon: '📅',
    tags: [],
    search: 'sort:hot protocol:nostr',
    sinceHours: 168,
  },
  {
    id: 'bitcoin-reads',
    label: 'Bitcoin Reads',
    description: 'Bitcoin-related long-form notes',
    icon: '📰',
    kinds: [30023],
    tags: ['bitcoin', 'btc', 'sats', 'lightning'],
  },
  {
    id: 'podcasts-reads',
    label: 'Podcasts Reads',
    description: 'Podcasts-related long-form notes',
    icon: '🎙️',
    kinds: [30023],
    tags: ['podcast', 'podcasts'],
  },
  {
    id: 'art-reads',
    label: 'Art Reads',
    description: 'Art-related long-form notes',
    icon: '🎨',
    kinds: [30023],
    tags: ['art', 'bitcoinart', 'digitalart', 'photography'],
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
