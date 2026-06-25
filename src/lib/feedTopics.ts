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
    icon: '🟣',
    authors: NOSTR_TOPIC_AUTHORS,
    tags: ['nostr', 'nostrprotocol', 'nostrdev', 'nip', 'relay', 'relays', 'zap', 'npub',
      'primal', 'damus', 'amethyst', 'coracle', 'snort', 'nostrudel', 'njump', 'ndk',
      'nwc', 'lnurl', 'cashu', 'ecash'],
  },
  {
    id: 'tech',
    label: 'Tech / AI',
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
    icon: '📈',
    authors: FINANCE_TOPIC_AUTHORS,
    tags: ['finance', 'markets', 'macro', 'inflation', 'stocks', 'trading', 'economy',
      'bonds', 'yield', 'treasury', 'wallstreet', 'nasdaq', 'sp500', 'dow', 'cpi', 'gdp',
      'recession', 'liquidity', 'sovereigndebt', 'fed', 'federalreserve', 'fomc', 'rates'],
  },
  {
    id: 'politics',
    label: 'Politics',
    icon: '🗳️',
    authors: POLITICS_TOPIC_AUTHORS,
    tags: ['politics', 'election', 'geopolitics', 'government', 'policy', 'regulation',
      'legislation', 'sanctions', 'democracy', 'senate', 'parliament', 'vote', 'referendum',
      'campaign', 'diplomat', 'tariff', 'executiveorder', 'supremecourt', 'immigration'],
  },
  {
    id: 'world',
    label: 'World',
    icon: '🌍',
    authors: WORLD_TOPIC_AUTHORS,
    tags: ['news', 'worldnews', 'world', 'international', 'geopolitics', 'breaking',
      'diplomacy', 'nato', 'un', 'conflict', 'crisis', 'war', 'peace', 'summit', 'treaty',
      'refugee', 'humanitarian', 'climate', 'journalist', 'ukraine', 'gaza'],
  },
  {
    id: 'sports',
    label: 'Sports',
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
